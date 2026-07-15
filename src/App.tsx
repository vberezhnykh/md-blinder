import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectFileKind } from './lib/fileType'
import { docxToMarkdown } from './lib/docxToMarkdown'
import { pdfToMarkdown } from './lib/pdfToMarkdown'
import { anonymizeMarkdown, type AnonymizeProgress } from './lib/anonymize'
import { runSecondPass } from './lib/anonymize/secondPass'
import { findRelatedOccurrences } from './lib/anonymize/relatedOccurrences'
import { entitiesToCsv } from './lib/anonymize/csv'
import { addEntityFromSelection, buildAnonymizedText, changeEntityType, dedupeEntityIds, acceptCandidate } from './lib/anonymize/apply'
import { hasPlaceholderCollision } from './lib/anonymize/placeholderGuard'
import { computeExportGate, type ExportGate } from './lib/anonymize/exportGate'
import type { Entity, EntityType } from './lib/anonymize/types'
import { loadAllDocs, putDoc, deleteDoc, serializeHistory, parseHistory, mergeDocs, type HistoryDoc } from './lib/history'
import ReplacementTable from './components/ReplacementTable'
import EntityEditor from './components/EntityEditor'
import EntityList from './components/EntityList'
import HistoryPanel from './components/HistoryPanel'
import './App.css'

type Progress = {
  phase: 'pdf' | 'ocr' | 'regex' | 'ner-load' | 'ner-detect'
  page?: number
  total?: number
  pct?: number
  chunk?: number
  chunks?: number
}

function toProgress(p: AnonymizeProgress): Progress {
  if (p.stage === 'regex') return { phase: 'regex' }
  if (p.stage === 'ner-load') return { phase: 'ner-load', pct: p.pct }
  return { phase: 'ner-detect', chunk: p.chunk, chunks: p.chunks }
}

function statusLabel(progress: Progress | null): string {
  if (!progress) return 'Обработка файла…'
  if (progress.phase === 'pdf') {
    return `Извлечение текста из PDF… (страница ${progress.page}/${progress.total})`
  }
  if (progress.phase === 'ocr') {
    if (progress.page === 0) {
      return `Загрузка OCR-модели… ${progress.pct ?? 0}%`
    }
    return `Распознавание скана (OCR)… страница ${progress.page}/${progress.total} — ${progress.pct ?? 0}%`
  }
  if (progress.phase === 'regex') {
    return 'Поиск структурных данных…'
  }
  if (progress.phase === 'ner-load') {
    return `Загрузка NER-модели… ${progress.pct ?? 0}%`
  }
  return `Поиск чувствительных данных… (фрагмент ${progress.chunk}/${progress.chunks})`
}

function App() {
  const [sourceText, setSourceText] = useState('')
  const [entities, setEntities] = useState<Entity[]>([])
  const [nerNotice, setNerNotice] = useState(false)
  const [hasResult, setHasResult] = useState(false)
  const [view, setView] = useState<'editor' | 'anonymized'>('editor')
  const [selectedType, setSelectedType] = useState<EntityType>('PERSON')
  const [fileName, setFileName] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [reveal, setReveal] = useState<{ from: number; to: number; nonce: number } | null>(null)
  const [secondPassRunning, setSecondPassRunning] = useState(false)
  const [secondPassInfo, setSecondPassInfo] = useState<string | null>(null)
  const [lastSecondPassAt, setLastSecondPassAt] = useState<number | null>(null)
  const [exportGate, setExportGate] = useState<(ExportGate & { passAt: number }) | null>(null)
  const gateDialogRef = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [history, setHistory] = useState<HistoryDoc[]>([])
  const [currentDocId, setCurrentDocId] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState('')
  const currentMetaRef = useRef<{ name: string; format: 'docx' | 'pdf'; createdAt: number } | null>(null)
  const justOpenedRef = useRef(false)

  const refreshHistory = useCallback(() => {
    loadAllDocs().then(setHistory).catch(() => {})
  }, [])

  useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  const anonymizedText = useMemo(
    () => buildAnonymizedText(sourceText, entities),
    [sourceText, entities],
  )

  const runAnonymization = useCallback(async (md: string, docName: string) => {
    const { result, nerFailed } = await anonymizeMarkdown(md, (p) => setProgress(toProgress(p)))
    setSourceText(md)
    setEntities(result.entities)
    setNerNotice(nerFailed)
    setView('editor')
    setStatus('idle')
    setHasResult(true)

    const id = crypto.randomUUID()
    const now = Date.now()
    const format: 'docx' | 'pdf' = /\.pdf$/i.test(docName) ? 'pdf' : 'docx'
    currentMetaRef.current = { name: docName || 'Документ', format, createdAt: now }
    setCurrentDocId(id)
    putDoc({ id, name: docName || 'Документ', format, createdAt: now, updatedAt: now, sourceText: md, entities: result.entities })
      .then(refreshHistory)
      .catch(() => {})
  }, [refreshHistory])

  useEffect(() => {
    const id = currentDocId
    const meta = currentMetaRef.current
    if (!id || !meta) return
    if (sourceText === '') return
    if (justOpenedRef.current) {
      justOpenedRef.current = false
      return
    }
    const t = setTimeout(() => {
      putDoc({ id, name: meta.name, format: meta.format, createdAt: meta.createdAt, updatedAt: Date.now(), sourceText, entities })
        .then(refreshHistory)
        .catch(() => {})
    }, 800)
    return () => clearTimeout(t)
  }, [sourceText, entities, currentDocId, refreshHistory])

  const handleOpenDoc = useCallback((doc: HistoryDoc) => {
    setSourceText(doc.sourceText)
    setEntities(dedupeEntityIds(doc.entities))
    setFileName(doc.name)
    setNerNotice(false)
    setCurrentDocId(doc.id)
    currentMetaRef.current = { name: doc.name, format: doc.format, createdAt: doc.createdAt }
    justOpenedRef.current = true
    setView('editor')
    setStatus('idle')
    setHasResult(true)
    setHistoryError('')
    setSecondPassInfo(null)
    setLastSecondPassAt(null)
  }, [])

  const handleDeleteDoc = useCallback((id: string) => {
    deleteDoc(id).then(refreshHistory).catch(() => {})
    setCurrentDocId((cur) => {
      if (cur === id) {
        return null
      }
      return cur
    })
  }, [refreshHistory])

  const handleExportHistory = useCallback(async () => {
    const docs = await loadAllDocs()
    const blob = new Blob([serializeHistory(docs)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'md-blinder-history.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleImportHistory = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const incoming = parseHistory(text)
      const existing = await loadAllDocs()
      const merged = mergeDocs(existing, incoming)
      await Promise.all(merged.map((d) => putDoc(d)))
      refreshHistory()
      setHistoryError('')
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Не удалось импортировать историю')
    }
  }, [refreshHistory])

  const processFile = useCallback(async (file: File) => {
    setError('')
    setProgress(null)
    setStatus('loading')
    setFileName(file.name)
    setEntities([])
    setSourceText('')
    setNerNotice(false)
    setView('editor')
    setHasResult(false)
    setCurrentDocId(null)
    currentMetaRef.current = null
    setSecondPassInfo(null)
    setLastSecondPassAt(null)

    try {
      const kind = await detectFileKind(file)

      if (kind === 'legacy-doc') {
        setStatus('error')
        setError(
          `Формат .doc не поддерживается. Откройте файл "${file.name}" в Word и сохраните как .docx, затем загрузите заново.`,
        )
        return
      }

      if (kind === 'unknown') {
        setStatus('error')
        setError(
          `Файл "${file.name}" не поддерживается. Поддерживаются .docx и текстовые .pdf.`,
        )
        return
      }

      if (kind === 'docx') {
        const md = await docxToMarkdown(await file.arrayBuffer())
        await runAnonymization(md, file.name)
        return
      }

      const { markdown: md } = await pdfToMarkdown(
        await file.arrayBuffer(),
        (page, total) => setProgress({ phase: 'pdf', page, total }),
        (p) => setProgress({ phase: 'ocr', page: p.page, total: p.total, pct: p.pct }),
      )
      await runAnonymization(md, file.name)
    } catch (e) {
      setStatus('error')
      setError(
        `Не удалось сконвертировать файл: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }, [runAnonymization])

  const isLoading = status === 'loading'

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && !isLoading) void processFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (isLoading) return
    const file = e.dataTransfer.files?.[0]
    if (file) void processFile(file)
  }

  const runControlPass = useCallback(async () => {
    if (!sourceText || secondPassRunning) return 0
    setSecondPassRunning(true)
    setSecondPassInfo(null)
    try {
      const found = await runSecondPass(sourceText, entities, (p) =>
        setSecondPassInfo(p.stage === 'load'
          ? `Контрольная проверка: загрузка модели… ${p.pct ?? 0}%`
          : `Контрольная проверка: поиск… фрагмент ${p.chunk ?? 0}/${p.chunks ?? 0}`),
      )
      const combined = [...entities, ...found]
      const related = findRelatedOccurrences(sourceText, combined)
      const newCandidates = [...found, ...related]
      if (newCandidates.length > 0) setEntities((prev) => [...prev, ...newCandidates])
      setLastSecondPassAt(Date.now())
      setSecondPassInfo(
        newCandidates.length > 0
          ? `Контрольный проход нашёл кандидатов: ${newCandidates.length}. Проверьте секцию «Проверьте вручную».`
          : 'Контрольный проход не нашёл пропусков.',
      )
      return newCandidates.length
    } catch {
      setSecondPassInfo('Не удалось выполнить контрольную проверку.')
      return 0
    } finally {
      setSecondPassRunning(false)
    }
  }, [sourceText, entities, secondPassRunning])

  const performMdExport = useCallback(() => {
    const blob = new Blob([anonymizedText], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = fileName.replace(/\.(docx?|pdf)$/i, '') || 'document'
    a.href = url
    a.download = `${base}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [anonymizedText, fileName])

  // B5: перед экспортом всегда прогоняем контрольную проверку — если остались
  // непросмотренные кандидаты «серой зоны», блокируем скачивание мягким подтверждением
  const handleExport = async () => {
    const found = await runControlPass()
    const gate = computeExportGate(entities)
    const unreviewed = gate.unreviewed + found
    if (unreviewed > 0) {
      setExportGate({ replaced: gate.replaced, unreviewed, needsConfirm: true, passAt: Date.now() })
      return
    }
    performMdExport()
  }

  // B5: управляем нативным <dialog> как модалкой (backdrop + Esc) через showModal/close
  useEffect(() => {
    const d = gateDialogRef.current
    if (!d) return
    if (exportGate && !d.open) d.showModal()
    if (!exportGate && d.open) d.close()
  }, [exportGate])

  const handleExportCsv = () => {
    const csv = entitiesToCsv(entities, sourceText)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = fileName.replace(/\.(docx?|pdf)$/i, '') || 'document'
    a.href = url
    a.download = `${base}-replacements.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleToggle = useCallback((id: string) => {
    setEntities((prev) => prev.map((e) => (e.id === id ? { ...e, anonymize: !e.anonymize } : e)))
  }, [])

  const handleChangeType = useCallback((id: string, newType: EntityType) => {
    setEntities((prev) => changeEntityType(prev, id, newType))
  }, [])

  const handleDelete = useCallback((id: string) => {
    setEntities((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const handleAcceptCandidate = useCallback((id: string) => {
    setEntities((prev) => acceptCandidate(prev, id))
  }, [])

  const handleRejectCandidate = useCallback((id: string) => {
    setEntities((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const handleAddEntity = useCallback(
    (from: number, to: number) => {
      setEntities((prev) => addEntityFromSelection(prev, sourceText, from, to, selectedType))
    },
    [sourceText, selectedType],
  )

  const handleEditorChange = useCallback((nextText: string, nextEntities: Entity[]) => {
    setSourceText(nextText)
    setEntities(nextEntities)
    if (currentDocId === null && nextText.trim() !== '' && currentMetaRef.current) {
      setCurrentDocId(crypto.randomUUID())
      currentMetaRef.current = { ...currentMetaRef.current, createdAt: Date.now() }
    }
  }, [currentDocId])

  const handleSelectEntity = useCallback((entity: Entity) => {
    const p = entity.positions[0]
    if (!p) return
    setReveal({ from: p.start, to: p.end, nonce: Date.now() })
  }, [])

  const showViewToggle = entities.length > 0 || anonymizedText !== sourceText
  const activeCount = entities.filter((e) => e.anonymize).length
  const placeholderCollision = useMemo(() => hasPlaceholderCollision(sourceText), [sourceText])

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.pdf"
        hidden
        onChange={handleFileInput}
      />

      {!hasResult && (
        <header className="app-header">
          <h1>MD Blinder</h1>
          <p>
            Конвертация договоров (.docx, .pdf) в Markdown — всё в браузере, без сервера.
            Сканы PDF распознаются через OCR, чувствительные данные анонимизируются.
          </p>
        </header>
      )}

      {!hasResult ? (
        <div
          className={`dropzone ${isDragging ? 'dragging' : ''} ${isLoading ? 'loading' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            if (!isLoading) setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !isLoading && fileInputRef.current?.click()}
        >
          <p>Перетащите .docx или .pdf файл сюда или нажмите, чтобы выбрать</p>
          <p className="dropzone-hint">
            Поддерживаются текстовые и сканированные PDF (распознавание через OCR)
          </p>
          {fileName && <p className="filename">Файл: {fileName}</p>}
        </div>
      ) : null}

      {!hasResult && (
        <HistoryPanel
          docs={history}
          currentId={currentDocId}
          errorText={historyError}
          onOpen={handleOpenDoc}
          onDelete={handleDeleteDoc}
          onExport={handleExportHistory}
          onImport={handleImportHistory}
        />
      )}

      {hasResult && (
        <div
          className={`compact-bar ${isDragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            if (!isLoading) setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {fileName && <span className="filename-compact" title={fileName}>{fileName}</span>}
          <button type="button" onClick={() => !isLoading && fileInputRef.current?.click()}>
            Загрузить другой файл
          </button>
          <button type="button" onClick={() => setHasResult(false)}>
            История
          </button>
        </div>
      )}

      {status === 'loading' && (
        <>
          <p className="status status-loading">
            <span className="spinner" aria-hidden="true" />
            {statusLabel(progress)}
          </p>
          {progress?.phase === 'ocr' && (
            <p className="status-hint">
              OCR медленный — распознавание может занять несколько минут.
            </p>
          )}
        </>
      )}
      {status === 'error' && <p className="status error">{error}</p>}

      {hasResult && (
        <section className="result" data-last-pass={lastSecondPassAt ?? undefined}>
          <div className="result-header">
            <h2>Результат</h2>
            <div className="result-actions">
              <button type="button" onClick={() => void runControlPass()} disabled={secondPassRunning || isLoading}>
                {secondPassRunning ? 'Проверка…' : 'Контрольная проверка'}
              </button>
              <button type="button" onClick={() => void handleExport()}>
                Экспортировать .md
              </button>
              {entities.length > 0 && (
                <button type="button" onClick={handleExportCsv}>
                  Экспортировать таблицу (.csv)
                </button>
              )}
            </div>
          </div>

          {secondPassInfo && <p className="status-hint second-pass-info">{secondPassInfo}</p>}

          {nerNotice && (
            <p className="ner-notice">
              NER-модель не загрузилась (нужен интернет при первом запуске). Показаны только
              структурные данные (регулярки).
            </p>
          )}

          {placeholderCollision && (
            <p className="collision-notice">
              Внимание: документ уже содержит текст вида [PERSON_1] — он может путаться с
              плейсхолдерами анонимизации. В экспортируемом файле такие фрагменты экранируются.
            </p>
          )}

          {showViewToggle && (
            <div className="view-toggle">
              <button
                type="button"
                className={view === 'editor' ? 'active' : ''}
                onClick={() => setView('editor')}
              >
                Редактор
              </button>
              <button
                type="button"
                className={view === 'anonymized' ? 'active' : ''}
                onClick={() => setView('anonymized')}
              >
                Анонимизированный
              </button>
            </div>
          )}

          {view === 'editor' ? (
            <div className="editor-layout">
              <EntityEditor
                value={sourceText}
                entities={entities}
                onChange={handleEditorChange}
                onAddEntity={handleAddEntity}
                selectedType={selectedType}
                onSelectedTypeChange={setSelectedType}
                reveal={reveal}
              />
              <EntityList
                entities={entities}
                sourceText={sourceText}
                onToggle={handleToggle}
                onChangeType={handleChangeType}
                onDelete={handleDelete}
                onSelect={handleSelectEntity}
                onAcceptCandidate={handleAcceptCandidate}
                onRejectCandidate={handleRejectCandidate}
              />
            </div>
          ) : (
            <pre className="markdown-preview anonymized-preview">{anonymizedText}</pre>
          )}

          {activeCount > 0 && (
            <section className="replacement-section">
              <h3>Таблица замен ({activeCount})</h3>
              <ReplacementTable entities={entities} sourceText={sourceText} />
            </section>
          )}
        </section>
      )}

      <dialog ref={gateDialogRef} className="export-gate-dialog" onClose={() => setExportGate(null)}>
        {exportGate && (
          <article>
            <h3>Проверьте полноту анонимизации</h3>
            <p>
              Остались непросмотренные кандидаты «серой зоны» — они не заменяются автоматически.
              Просмотрите их в секции «Проверьте вручную» или экспортируйте как есть.
            </p>
            <ul className="export-gate-stats">
              <li>Заменяется сущностей: <b>{exportGate.replaced}</b></li>
              <li>Кандидатов не просмотрено: <b>{exportGate.unreviewed}</b></li>
              <li>Контрольный проход: {new Date(exportGate.passAt).toLocaleString('ru-RU')}</li>
            </ul>
            <footer>
              <button type="button" className="secondary" onClick={() => setExportGate(null)}>
                Вернуться к проверке
              </button>
              <button type="button" onClick={() => { performMdExport(); setExportGate(null) }}>
                Экспортировать всё равно
              </button>
            </footer>
          </article>
        )}
      </dialog>
    </div>
  )
}

export default App
