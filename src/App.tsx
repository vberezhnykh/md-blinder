import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectFileKind } from './lib/fileType'
import { anonymizeMarkdown, type AnonymizeProgress } from './lib/anonymize'
import { runSecondPass } from './lib/anonymize/secondPass'
import { findRelatedOccurrences } from './lib/anonymize/relatedOccurrences'
import { entitiesToCsv } from './lib/anonymize/csv'
import { addEntityFromSelection, addOccurrenceToEntity, buildAnonymizedText, changeEntityType, compactPlaceholderNumbers, dedupeEntityIds, acceptCandidate, mergeEntities } from './lib/anonymize/apply'
import { hasPlaceholderCollision } from './lib/anonymize/placeholderGuard'
import { findImageRanges } from './lib/anonymize/imageSafety'
import { computeExportGate, type ExportGate } from './lib/anonymize/exportGate'
import { statusLabel, statusHint, type UiProgress } from './lib/progressLabel'
import { copyText } from './lib/clipboard'
import type { Entity, EntityType } from './lib/anonymize/types'
import { loadAllDocs, loadDoc, putDoc, deleteDoc, serializeHistory, parseHistory, mergeDocs, type HistoryDocMeta } from './lib/history'
import { useDocumentSession, type DocumentSnapshot } from './hooks/useDocumentSession'
import { useAnalysisJob } from './hooks/useAnalysisJob'
import { useHistoryStore } from './hooks/useHistoryStore'
import ReplacementTable from './components/ReplacementTable'
import EntityList from './components/EntityList'
import HistoryPanel from './components/HistoryPanel'
import './App.css'

const EntityEditor = lazy(() => import('./components/EntityEditor'))
const EMPTY_ENTITIES: Entity[] = []

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface CheckedExport extends ExportGate {
  passAt: number
  snapshot: DocumentSnapshot
  nerFailed: boolean
}

type Progress = UiProgress

// Стейджи конвейера анонимизации 1:1 ложатся на фазы индикатора — маппинг
// оставлен явным, чтобы новый стейдж нельзя было забыть показать.
function toProgress(p: AnonymizeProgress): Progress {
  if (p.stage === 'regex') return { phase: 'regex' }
  return {
    phase: p.stage,
    pct: p.pct,
    cached: p.cached,
    ep: p.ep,
    chunk: p.chunk,
    chunks: p.chunks,
    batch: p.batch,
    batches: p.batches,
    batchChunks: p.batchChunks,
  }
}

function App() {
  const historyStore = useHistoryStore()
  const { history, error: historyError, setError: setHistoryError, saving, queueSave, flush, refresh: refreshHistory } = historyStore
  const { snapshot, snapshotRef, replace, edit, setEntities, isCurrent } = useDocumentSession(queueSave)
  const { start: startJob, cancel: cancelJob } = useAnalysisJob()
  const sourceText = snapshot.doc?.sourceText ?? ''
  const entities = snapshot.doc?.entities ?? EMPTY_ENTITIES
  const currentDocId = snapshot.doc?.id ?? null
  const [nerNotice, setNerNotice] = useState(false)
  const [hasResult, setHasResult] = useState(false)
  const [view, setView] = useState<'editor' | 'anonymized'>('editor')
  const [selectedType, setSelectedType] = useState<EntityType>('PERSON')
  const [fileName, setFileName] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  // Секунды с начала обработки. Фазы NER на CPU идут по 10–40 секунд без
  // процентов — тикающий таймер единственный признак, что ничего не зависло.
  const [elapsedSec, setElapsedSec] = useState(0)
  const [reveal, setReveal] = useState<{ from: number; to: number; nonce: number } | null>(null)
  const [secondPassRunning, setSecondPassRunning] = useState(false)
  const [secondPassInfo, setSecondPassInfo] = useState<string | null>(null)
  const [lastSecondPassAt, setLastSecondPassAt] = useState<number | null>(null)
  const [exportGate, setExportGate] = useState<CheckedExport | null>(null)
  const [forceOcr, setForceOcr] = useState(false)
  const lastCheckedRevision = useRef(-1)
  const [copyResult, setCopyResult] = useState<{ text: string; state: 'copied' | 'error' } | null>(null)
  const gateDialogRef = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const cancelAnalysis = useCallback(() => {
    cancelJob()
    setSecondPassRunning(false)
    setStatus('idle')
    setProgress(null)
    setExportGate(null)
  }, [cancelJob])

  useEffect(() => {
    if (status !== 'loading') return
    const startedAt = Date.now()
    const id = setInterval(() => setElapsedSec(Math.round((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(id)
  }, [status])

  const anonymizedText = useMemo(
    () => buildAnonymizedText(sourceText, entities),
    [sourceText, entities],
  )
  const copyState = copyResult?.text === anonymizedText ? copyResult.state : 'idle'

  const handleOpenDoc = useCallback(async (meta: HistoryDocMeta) => {
    cancelAnalysis()
    const job = startJob()
    try {
      await flush()
      if (!job.isCurrent()) return
      if (snapshotRef.current.doc?.id !== meta.id) {
        const doc = await loadDoc(meta.id)
        if (!job.isCurrent()) return
        if (!doc) throw new Error('Документ не найден в истории')
        replace({ ...doc, entities: dedupeEntityIds(doc.entities) })
      }
      setFileName(meta.name)
      setNerNotice(false)
      setView('editor')
      setHasResult(true)
      setHistoryError('')
      setSecondPassInfo(null)
      setLastSecondPassAt(null)
    } catch (err) {
      if (job.isCurrent()) setHistoryError(err instanceof Error ? err.message : String(err))
    } finally {
      job.finish()
    }
  }, [cancelAnalysis, startJob, flush, snapshotRef, replace, setHistoryError])

  const handleDeleteDoc = useCallback(async (id: string) => {
    try {
      // Stop a control pass before flushing; otherwise it can requeue this doc
      // between the flush and deletion and resurrect it in the autosave timer.
      if (snapshotRef.current.doc?.id === id) cancelAnalysis()
      await flush()
      await deleteDoc(id)
      if (snapshotRef.current.doc?.id === id) {
        cancelAnalysis()
        replace(null)
        setHasResult(false)
      }
      await refreshHistory()
    } catch (err) { setHistoryError(String(err)) }
  }, [flush, snapshotRef, replace, cancelAnalysis, refreshHistory, setHistoryError])

  const handleExportHistory = useCallback(async () => {
    try {
      await flush()
      const docs = await loadAllDocs()
      downloadBlob(new Blob([serializeHistory(docs)], { type: 'application/json;charset=utf-8' }), 'md-blinder-history.json')
    } catch (err) { setHistoryError(String(err)) }
  }, [flush, setHistoryError])

  const handleImportHistory = useCallback(async (file: File) => {
    try {
      cancelAnalysis()
      await flush()
      const text = await file.text()
      const incoming = parseHistory(text)
      const existing = await loadAllDocs()
      const merged = mergeDocs(existing, incoming)
      await Promise.all(merged.map((d) => putDoc(d)))
      const current = snapshotRef.current.doc
      const replacement = current && merged.find((doc) => doc.id === current.id)
      if (replacement && current && replacement.updatedAt > current.updatedAt) {
        cancelAnalysis()
        replace({ ...replacement, entities: dedupeEntityIds(replacement.entities) })
        setFileName(replacement.name)
        setSecondPassInfo(null)
        setLastSecondPassAt(null)
      }
      await refreshHistory()
      setHistoryError('')
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Не удалось импортировать историю')
    }
  }, [flush, refreshHistory, setHistoryError, snapshotRef, cancelAnalysis, replace])

  const processFile = useCallback(async (file: File) => {
    cancelAnalysis()
    const job = startJob()
    setError('')
    setProgress(null)
    setStatus('loading')
    setElapsedSec(0)
    setFileName(file.name)
    setNerNotice(false)
    setView('editor')
    setHasResult(false)
    setSecondPassInfo(null)
    setLastSecondPassAt(null)

    try {
      await flush()
      if (!job.isCurrent()) return
      replace(null)
      const kind = await detectFileKind(file)
      job.signal.throwIfAborted()

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
          `Файл "${file.name}" не поддерживается. Поддерживаются .docx и .pdf (включая сканы).`,
        )
        return
      }

      const buffer = await file.arrayBuffer()
      job.signal.throwIfAborted()
      let md: string
      if (kind === 'docx') {
        const { docxToMarkdown } = await import('./lib/docxToMarkdown')
        md = await docxToMarkdown(buffer, { signal: job.signal })
      } else {
        const { pdfToMarkdown } = await import('./lib/pdfToMarkdown')
        const result = await pdfToMarkdown(buffer,
          (page, total) => { if (job.isCurrent()) setProgress({ phase: 'pdf', page, total }) },
          (p) => { if (job.isCurrent()) setProgress({ phase: 'ocr', page: p.page, total: p.total, pct: p.pct }) },
          { signal: job.signal, forceOcr },
        )
        md = result.markdown
      }
      job.signal.throwIfAborted()
      const { result, nerFailed } = await anonymizeMarkdown(md,
        (p) => { if (job.isCurrent()) setProgress(toProgress(p)) }, job.signal)
      if (!job.isCurrent()) return
      const now = Date.now()
      replace({ id: crypto.randomUUID(), name: file.name, format: kind, createdAt: now,
        updatedAt: now, sourceText: md, entities: result.entities }, true)
      setNerNotice(nerFailed)
      setView('editor')
      setStatus('idle')
      setHasResult(true)
    } catch (e) {
      if (!job.isCurrent() || job.signal.aborted) return
      setStatus('error')
      setError(
        `Не удалось сконвертировать файл: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      job.finish()
    }
  }, [cancelAnalysis, startJob, flush, replace, forceOcr])

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

  const runControlPass = useCallback(async (): Promise<CheckedExport | null> => {
    const before = snapshotRef.current
    if (!before.doc || secondPassRunning) return null
    const job = startJob()
    setSecondPassRunning(true)
    setSecondPassInfo(null)
    try {
      const { entities: found, nerFailed } = await runSecondPass(before.doc.sourceText, before.doc.entities, (p) => {
        if (job.isCurrent() && isCurrent(before)) setSecondPassInfo(
          `Контрольная проверка — ${statusLabel({ ...p, phase: `ner-${p.stage}` } as UiProgress)}`)
      }, job.signal,
      )
      if (!job.isCurrent()) return null
      if (!isCurrent(before)) {
        setSecondPassInfo('Документ изменён во время проверки. Запустите проверку или экспорт заново.')
        return null
      }
      const combined = [...before.doc.entities, ...found]
      const related = findRelatedOccurrences(before.doc.sourceText, combined)
      const newCandidates = [...found, ...related]
      if (newCandidates.length > 0) setEntities([...before.doc.entities, ...newCandidates])
      const checked = snapshotRef.current
      const gate = computeExportGate(checked.doc!.entities)
      const passAt = Date.now()
      lastCheckedRevision.current = checked.revision
      setLastSecondPassAt(nerFailed ? null : passAt)
      setSecondPassInfo(
        nerFailed
          ? 'Проверка неполная: NER недоступен. Выполнен только поиск по правилам. Повторите проверку перед экспортом.'
          : newCandidates.length > 0
          ? `Контрольный проход нашёл кандидатов: ${newCandidates.length}. Проверьте секцию «Проверьте вручную».`
          : 'Контрольный проход не нашёл пропусков.',
      )
      return { ...gate, needsConfirm: gate.needsConfirm || nerFailed, passAt, snapshot: checked, nerFailed }
    } catch {
      if (job.isCurrent()) setSecondPassInfo('Не удалось выполнить контрольную проверку. Повторите попытку.')
      return null
    } finally {
      if (job.isCurrent()) setSecondPassRunning(false)
      job.finish()
    }
  }, [snapshotRef, secondPassRunning, startJob, isCurrent, setEntities])

  const performMdExport = useCallback((checked: CheckedExport) => {
    if (!isCurrent(checked.snapshot) || !checked.snapshot.doc) {
      setExportGate(null)
      setSecondPassInfo('Документ изменён после проверки. Запустите экспорт заново.')
      return
    }
    const doc = checked.snapshot.doc
    const text = buildAnonymizedText(doc.sourceText, doc.entities)
    const base = doc.name.replace(/\.(docx?|pdf)$/i, '') || 'document'
    downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `${base}.md`)
  }, [isCurrent])

  // Копирование мгновенное: никакого контрольного прохода и подтверждений
  // перед ним. Это осознанный размен — B5-гейт остаётся только на экспорте .md
  // (файл уходит наружу и живёт дальше), а копирование в буфер задумано как
  // быстрое действие «взял текст и вставил». Непросмотренные кандидаты после
  // копирования показываются подсказкой, не блокируя.
  const handleCopy = useCallback(async () => {
    const ok = await copyText(anonymizedText)
    setCopyResult({ text: anonymizedText, state: ok ? 'copied' : 'error' })
  }, [anonymizedText])

  // Status is derived from the copied text, so edits invalidate it immediately.
  useEffect(() => {
    if (copyState === 'idle') return
    const id = setTimeout(() => setCopyResult(null), 2500)
    return () => clearTimeout(id)
  }, [copyState])

  // B5: перед экспортом всегда прогоняем контрольную проверку — если остались
  // непросмотренные кандидаты «серой зоны», блокируем скачивание мягким подтверждением
  const handleExport = async () => {
    const checked = await runControlPass()
    if (!checked) return
    if (checked.needsConfirm) {
      setExportGate(checked)
      return
    }
    performMdExport(checked)
  }

  useEffect(() => {
    if (lastCheckedRevision.current !== snapshot.revision) setLastSecondPassAt(null)
  }, [snapshot.revision])

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
  }, [setEntities])

  const handleChangeType = useCallback((id: string, newType: EntityType) => {
    setEntities((prev) => changeEntityType(prev, id, newType))
  }, [setEntities])

  const handleDelete = useCallback((id: string) => {
    setEntities((prev) => compactPlaceholderNumbers(prev.filter((e) => e.id !== id)))
  }, [setEntities])

  const handleMergeEntity = useCallback((sourceId: string, targetId: string) => {
    setEntities((prev) => compactPlaceholderNumbers(mergeEntities(prev, sourceId, targetId)))
  }, [setEntities])

  const handleAcceptCandidate = useCallback((id: string) => {
    setEntities((prev) => acceptCandidate(prev, id))
  }, [setEntities])

  const handleRejectCandidate = useCallback((id: string) => {
    setEntities((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, dismissed: true, candidate: false, anonymize: false } : e,
      ),
    )
  }, [setEntities])

  const handleAddEntity = useCallback(
    (from: number, to: number) => {
      setEntities((prev) => compactPlaceholderNumbers(addEntityFromSelection(prev, sourceText, from, to, selectedType)))
    },
    [sourceText, selectedType, setEntities],
  )

  const handleAttachToEntity = useCallback(
    (from: number, to: number, entityId: string) => {
      setEntities((prev) => addOccurrenceToEntity(prev, sourceText, from, to, entityId))
    },
    [sourceText, setEntities],
  )

  const handleEditorChange = useCallback((nextText: string, nextEntities: Entity[]) => {
    edit(nextText, nextEntities)
  }, [edit])

  const handleSelectEntity = useCallback((entity: Entity) => {
    const p = entity.positions[0]
    if (!p) return
    setReveal({ from: p.start, to: p.end, nonce: Date.now() })
  }, [])

  const showViewToggle = entities.length > 0 || anonymizedText !== sourceText
  const activeCount = entities.filter((e) => e.anonymize).length
  // Считается мгновенно (обычный фильтр по сущностям, без NER) — годится для
  // подсказки сразу после копирования.
  const unreviewedCount = computeExportGate(entities).unreviewed
  const placeholderCollision = useMemo(() => hasPlaceholderCollision(sourceText), [sourceText])
  const imageCount = useMemo(() => findImageRanges(sourceText).length, [sourceText])

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
          onOpen={(doc) => { void handleOpenDoc(doc) }}
          onDelete={(id) => { void handleDeleteDoc(id) }}
          onExport={() => { void handleExportHistory() }}
          onImport={(file) => { void handleImportHistory(file) }}
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
          <button type="button" onClick={() => {
            void flush().then(() => setHasResult(false)).catch(() => {})
          }}>
            История
          </button>
          <span className="status-hint" role="status">{historyError ? 'Ошибка истории' : saving ? 'Сохранение…' : 'Сохранено в браузере'}</span>
        </div>
      )}

      {!isLoading && (
        <label className="ocr-option">
          <input type="checkbox" checked={forceOcr} onChange={(event) => setForceOcr(event.target.checked)} />
          Распознать все страницы следующего PDF через OCR
        </label>
      )}

      {status === 'loading' && (
        <>
          <p className="status status-loading" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            {statusLabel(progress, elapsedSec)}
          </p>
          {statusHint(progress) && <p className="status-hint">{statusHint(progress)}</p>}
        </>
      )}
      {status === 'error' && <p className="status error">{error}</p>}
      {hasResult && historyError && <p className="status error" role="alert">
        {historyError} <button type="button" onClick={() => { void flush().catch(() => {}) }}>Повторить сохранение</button>
      </p>}
      {(isLoading || secondPassRunning) && <button type="button" onClick={() => {
        cancelAnalysis()
        setSecondPassInfo('Обработка отменена. Можно запустить её заново.')
      }}>Отменить обработку</button>}

      {snapshot.doc && (
        <section className="result" hidden={!hasResult} data-last-pass={lastSecondPassAt ?? undefined}>
          <div className="result-header">
            <h2>Результат</h2>
          </div>

          {secondPassInfo && <p className="status-hint second-pass-info">{secondPassInfo}</p>}

          {nerNotice && (
            <p className="ner-notice">
              NER-модель не загрузилась (нужен интернет при первом запуске). Показаны только
              структурные данные (регулярки).
            </p>
          )}
          {imageCount > 0 && <p className="image-notice">
            В документе есть изображения ({imageCount}). При копировании и экспорте текста они заменяются
            отметкой об удалении: данные внутри изображений автоматически не обезличиваются.
          </p>}

          {placeholderCollision && (
            <p className="collision-notice">
              Внимание: документ уже содержит текст вида [PERSON_1] — он может путаться с
              плейсхолдерами анонимизации. В экспортируемом файле такие фрагменты экранируются.
            </p>
          )}

          <div className="result-toolbar">
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
            <div className="result-actions">
              <button type="button" onClick={() => void runControlPass()} disabled={secondPassRunning || isLoading}>
                {secondPassRunning ? 'Проверка…' : 'Контрольная проверка'}
              </button>
              <button type="button" onClick={() => void handleExport()} disabled={secondPassRunning}>
                Экспортировать .md
              </button>
              <button
                type="button"
                className="copy-action"
                onClick={() => void handleCopy()}
                aria-live="polite"
              >
                {copyState === 'copied'
                  ? 'Скопировано ✓'
                  : copyState === 'error'
                    ? 'Не удалось скопировать'
                    : 'Копировать текст'}
              </button>
              {entities.length > 0 && (
                <button type="button" onClick={handleExportCsv}>
                  Экспортировать таблицу (.csv)
                </button>
              )}
            </div>
          </div>

          {/* Копирование не блокируется контрольной проверкой, поэтому о
              непросмотренных кандидатах сообщаем постфактум — подсказкой. */}
          {copyState === 'copied' && unreviewedCount > 0 && (
            <p className="status-hint">
              Текст скопирован. Непросмотренных кандидатов «серой зоны»: <b>{unreviewedCount}</b> —
              они не заменены. Проверьте секцию «Проверьте вручную» или запустите контрольную
              проверку.
            </p>
          )}

            <div className="editor-layout" hidden={view !== 'editor'}>
              <Suspense fallback={<p role="status">Загрузка редактора…</p>}>
              <EntityEditor
                key={currentDocId}
                value={sourceText}
                entities={entities}
                onChange={handleEditorChange}
                onAddEntity={handleAddEntity}
                onAttachToEntity={handleAttachToEntity}
                selectedType={selectedType}
                onSelectedTypeChange={setSelectedType}
                reveal={reveal}
                onMergeEntity={handleMergeEntity}
              />
              </Suspense>
              <EntityList
                entities={entities}
                sourceText={sourceText}
                onToggle={handleToggle}
                onChangeType={handleChangeType}
                onDelete={handleDelete}
                onSelect={handleSelectEntity}
                onAcceptCandidate={handleAcceptCandidate}
                onRejectCandidate={handleRejectCandidate}
                onMergeEntity={handleMergeEntity}
              />
            </div>
            <pre className="markdown-preview anonymized-preview" hidden={view !== 'anonymized'}>{anonymizedText}</pre>

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
              {exportGate.nerFailed
                ? 'Проверка неполная: NER недоступен. Имена, компании и адреса могли остаться в тексте. Повторите проверку или подтвердите экспорт без полной проверки.'
                : 'Остались непросмотренные кандидаты «серой зоны» — они не заменяются автоматически. Просмотрите их в секции «Проверьте вручную» или экспортируйте как есть.'}
            </p>
            <ul className="export-gate-stats">
              <li>Заменяется сущностей: <b>{exportGate.replaced}</b></li>
              <li>Кандидатов не просмотрено: <b>{exportGate.unreviewed}</b></li>
              <li>{exportGate.nerFailed ? 'Попытка проверки' : 'Контрольный проход'}: {new Date(exportGate.passAt).toLocaleString('ru-RU')}</li>
            </ul>
            <footer>
              <button type="button" className="secondary" onClick={() => setExportGate(null)}>
                Вернуться к проверке
              </button>
              <button type="button" onClick={() => { performMdExport(exportGate); setExportGate(null) }}>
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
