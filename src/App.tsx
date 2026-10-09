import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectFileKind } from './lib/fileType'
import { anonymizeMarkdown, type AnonymizeProgress } from './lib/anonymize'
import { findRelatedOccurrences } from './lib/anonymize/relatedOccurrences'
import { entitiesToCsv } from './lib/anonymize/csv'
import { addEntityFromSelection, addOccurrenceToEntity, buildAnonymizedTextWithMap, changeEntityType, compactPlaceholderNumbers, dedupeEntityIds, acceptRelatedCandidate, acceptAllRelated, restoreCandidate, pendingCandidates, mergeEntities } from './lib/anonymize/apply'
import { hasPlaceholderCollision } from './lib/anonymize/placeholderGuard'
import { findImageRanges } from './lib/anonymize/imageSafety'
import { statusLabel, statusHint, type UiProgress } from './lib/progressLabel'
import { copyText } from './lib/clipboard'
import { plural } from './lib/plural'
import type { Entity, EntityType } from './lib/anonymize/types'
import { loadAllDocs, loadDoc, putDoc, deleteDoc, serializeHistory, parseHistory, mergeDocs, type HistoryDocMeta } from './lib/history'
import { useDocumentSession } from './hooks/useDocumentSession'
import { useAnalysisJob } from './hooks/useAnalysisJob'
import { useHistoryStore } from './hooks/useHistoryStore'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useStoredFlag } from './hooks/useStoredFlag'
import EntityList, { type SideTab } from './components/EntityList'
import CandidateReview from './components/CandidateReview'
import HistoryPanel from './components/HistoryPanel'
import AnonymizedPreview from './components/AnonymizedPreview'
import Toast, { type ToastState } from './components/Toast'
import TopBar from './components/TopBar'
import { BlinderMark, DownloadIcon, ShieldIcon, UploadIcon } from './components/icons'
import StatusStrip from './components/StatusStrip'
import './App.css'

const EntityEditor = lazy(() => import('./components/EntityEditor'))
const EMPTY_ENTITIES: Entity[] = []
// Сколько секунд удаленный из истории документ можно вернуть.
const DELETE_UNDO_MS = 8000

function baseName(name: string): string {
  return name.replace(/\.(docx?|pdf)$/i, '') || 'document'
}

function shorten(s: string, n = 48): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
  const { snapshot, snapshotRef, replace, edit, setEntities } = useDocumentSession(queueSave)
  const { start: startJob, cancel: cancelJob } = useAnalysisJob()
  const sourceText = snapshot.doc?.sourceText ?? ''
  const entities = snapshot.doc?.entities ?? EMPTY_ENTITIES
  const currentDocId = snapshot.doc?.id ?? null
  const [nerNotice, setNerNotice] = useState(false)
  const [hasResult, setHasResult] = useState(false)
  // Вид в одной колонке: исходник или результат. В широком окне они стоят рядом.
  const [view, setView] = useState<'source' | 'result'>('source')
  const wideWindow = useMediaQuery('(min-width: 1280px)')
  const [preferSideBySide, setPreferSideBySide] = useStoredFlag('md-blinder:result-side-by-side', true)
  const sideBySide = wideWindow && preferSideBySide
  // Смещение в исходнике, к которому прокрутить результат: выбранное значение
  // или текущий кандидат.
  const [resultFocus, setResultFocus] = useState<{ pos: number; nonce: number } | null>(null)
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
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null)
  const [forceOcr, setForceOcr] = useState(false)
  // Вкладка боковой панели, выбранная пользователем; без выбора открыта проверка,
  // если есть непроверенные кандидаты. Сбрасывается при смене документа.
  const [sideTab, setSideTab] = useState<SideTab | null>(null)
  // Кандидат, выбранный в очереди проверки, и счетчик переходов: каждый переход
  // прокручивает редактор к кандидату.
  const [activeCandidate, setActiveCandidate] = useState<{ id: string | null; nonce: number }>({ id: null, nonce: 0 })
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastKey = useRef(0)
  // Удаление из истории откладывается, пока в уведомлении доступна «Вернуть».
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const pendingDeleteRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showToast = useCallback((next: Omit<ToastState, 'key'>) => {
    toastKey.current += 1
    setToast({ ...next, key: toastKey.current })
  }, [])
  const closeToast = useCallback(() => setToast(null), [])

  const cancelAnalysis = useCallback(() => {
    cancelJob()
    setStatus('idle')
    setProgress(null)
  }, [cancelJob])

  useEffect(() => {
    if (status !== 'loading') return
    const startedAt = Date.now()
    const id = setInterval(() => setElapsedSec(Math.round((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(id)
  }, [status])

  const anonymized = useMemo(
    () => buildAnonymizedTextWithMap(sourceText, entities),
    [sourceText, entities],
  )
  const anonymizedText = anonymized.text
  const unreviewedCount = useMemo(() => entities.filter((e) => e.candidate && !e.dismissed).length, [entities])

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
      setView('source')
      setSideTab(null)
      setActiveCandidate((prev) => ({ id: null, nonce: prev.nonce }))
      setHasResult(true)
      setHistoryError('')
    } catch (err) {
      if (job.isCurrent()) setHistoryError(err instanceof Error ? err.message : String(err))
    } finally {
      job.finish()
    }
  }, [cancelAnalysis, startJob, flush, snapshotRef, replace, setHistoryError])

  const handleDeleteDoc = useCallback(async (id: string) => {
    try {
      // Stop a running analysis before flushing; otherwise it can requeue this doc
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

  const commitPendingDelete = useCallback(() => {
    const pending = pendingDeleteRef.current
    if (!pending) return
    clearTimeout(pending.timer)
    pendingDeleteRef.current = null
    setPendingDeleteId(null)
    void handleDeleteDoc(pending.id)
  }, [handleDeleteDoc])

  const undoDelete = useCallback(() => {
    const pending = pendingDeleteRef.current
    if (!pending) return
    clearTimeout(pending.timer)
    pendingDeleteRef.current = null
    setPendingDeleteId(null)
    setToast(null)
  }, [])

  const requestDeleteDoc = useCallback((meta: HistoryDocMeta) => {
    commitPendingDelete()
    const timer = setTimeout(commitPendingDelete, DELETE_UNDO_MS)
    pendingDeleteRef.current = { id: meta.id, timer }
    setPendingDeleteId(meta.id)
    showToast({
      text: `Документ «${shorten(meta.name)}» удален.`,
      action: { label: 'Вернуть', onClick: undoDelete },
      durationMs: DELETE_UNDO_MS,
    })
  }, [commitPendingDelete, undoDelete, showToast])

  // При закрытии вкладки отложенное удаление выполняется сразу.
  useEffect(() => {
    window.addEventListener('pagehide', commitPendingDelete)
    return () => window.removeEventListener('pagehide', commitPendingDelete)
  }, [commitPendingDelete])

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
    setView('source')
    setHasResult(false)

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
      // Родственные формы найденных сущностей (падежи фамилий, инициалы, название
      // без ОПФ) ищутся правилами без NER, поэтому их можно предложить сразу.
      const related = findRelatedOccurrences(md, result.entities)
      const now = Date.now()
      replace({ id: crypto.randomUUID(), name: file.name, format: kind, createdAt: now,
        updatedAt: now, sourceText: md, entities: [...result.entities, ...related] }, true)
      setNerNotice(nerFailed)
      setView('source')
      setSideTab(null)
      setActiveCandidate((prev) => ({ id: null, nonce: prev.nonce }))
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

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    if (!isLoading) setIsDragging(true)
  }

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (isLoading) return
    const file = e.dataTransfer.files?.[0]
    if (file) void processFile(file)
  }

  const showCandidates = useCallback(() => {
    setView('source')
    setSideTab('review')
  }, [])

  // Переход в очереди закрепляет вкладку проверки: после последнего решения
  // панель показывает итог, а не перескакивает на найденные данные.
  const activateCandidate = useCallback((id: string | null) => {
    setActiveCandidate((prev) => ({ id, nonce: prev.nonce + 1 }))
    setSideTab('review')
    const pos = id ? snapshotRef.current.doc?.entities.find((e) => e.id === id)?.positions[0]?.start : undefined
    if (pos !== undefined) setResultFocus((prev) => ({ pos, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [snapshotRef])

  // Копирование и экспорт мгновенные: текст берется из текущей разметки без
  // повторного прогона NER. Непроверенные кандидаты не блокируют действие —
  // о них напоминают счетчик рядом с кнопками и уведомление после действия.
  const notifyDone = useCallback((done: string) => {
    if (unreviewedCount === 0) {
      showToast({ text: done, durationMs: 3000 })
      return
    }
    showToast({
      text: `${done} Не проверено: ${plural(unreviewedCount, ['кандидат', 'кандидата', 'кандидатов'])} — в тексте они остались без замены.`,
      tone: 'warn',
      action: { label: 'Показать', onClick: () => { setToast(null); showCandidates() } },
      durationMs: 8000,
    })
  }, [unreviewedCount, showToast, showCandidates])

  const handleCopy = useCallback(async () => {
    const ok = await copyText(anonymizedText)
    if (ok) notifyDone('Текст скопирован.')
    else showToast({ text: 'Не удалось скопировать текст. Браузер не дал доступ к буферу обмена.', tone: 'error', durationMs: 6000 })
  }, [anonymizedText, notifyDone, showToast])

  const handleExport = useCallback(() => {
    const name = `${baseName(fileName)}.md`
    downloadBlob(new Blob([anonymizedText], { type: 'text/markdown;charset=utf-8' }), name)
    notifyDone(`Файл «${shorten(name, 40)}» сохранен.`)
  }, [anonymizedText, fileName, notifyDone])

  const handleExportCsv = () => {
    const csv = entitiesToCsv(entities, sourceText)
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `${baseName(fileName)}-replacements.csv`)
  }

  const handleToggle = useCallback((id: string) => {
    setEntities((prev) => prev.map((e) => (e.id === id ? { ...e, anonymize: !e.anonymize } : e)))
  }, [setEntities])

  const handleSetAnonymize = useCallback((ids: string[], anonymize: boolean) => {
    const selected = new Set(ids)
    setEntities((prev) => prev.map((e) => (selected.has(e.id) ? { ...e, anonymize } : e)))
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
    setEntities((prev) => compactPlaceholderNumbers(acceptRelatedCandidate(prev, id)))
  }, [setEntities])

  const handleRejectCandidate = useCallback((id: string) => {
    setEntities((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, dismissed: true, candidate: false, anonymize: false } : e,
      ),
    )
  }, [setEntities])

  const handleAcceptAllRelated = useCallback((targetId: string) => {
    setEntities((prev) => compactPlaceholderNumbers(acceptAllRelated(prev, targetId)))
  }, [setEntities])

  const handleRestoreCandidate = useCallback((id: string) => {
    setEntities((prev) => restoreCandidate(prev, id))
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
    setResultFocus((prev) => ({ pos: p.start, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  const showViewToggle = entities.length > 0 || anonymizedText !== sourceText
  const sidePanelTab: SideTab = sideTab ?? (unreviewedCount > 0 ? 'review' : 'found')
  const currentCandidateId = useMemo(() => {
    const pending = pendingCandidates(entities)
    return (pending.find((e) => e.id === activeCandidate.id) ?? pending[0])?.id ?? null
  }, [entities, activeCandidate.id])
  const replaced = useMemo(() => {
    const active = entities.filter((e) => e.anonymize)
    return { values: active.length, places: active.reduce((sum, e) => sum + e.positions.length, 0) }
  }, [entities])
  const visibleHistory = useMemo(
    () => (pendingDeleteId ? history.filter((d) => d.id !== pendingDeleteId) : history),
    [history, pendingDeleteId],
  )
  const openFilePicker = () => { if (!isLoading) fileInputRef.current?.click() }
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
        <>
          <header className="app-header">
            <h1 className="app-title"><BlinderMark />MD Blinder</h1>
            <p>Конвертация договоров (.docx, .pdf) в Markdown с обезличиванием.</p>
          </header>
          <ul className="start-facts">
            <li className="start-fact is-privacy">
              <ShieldIcon size={18} />
              <span>
                <strong>Документы не покидают браузер.</strong> Конвертация, распознавание сканов и поиск
                персональных данных выполняются на этом компьютере.
              </span>
            </li>
            <li className="start-fact">
              <DownloadIcon size={18} />
              <span>
                <strong>Первый запуск дольше.</strong> Браузер скачает модель распознавания имен (около 580 МБ)
                и языковые данные для OCR. Это публичные файлы, текст документов не отправляется.
              </span>
            </li>
          </ul>
        </>
      )}

      {!hasResult && (
        <div className="upload">
          <div
            className={`dropzone ${isDragging ? 'dragging' : ''} ${isLoading ? 'loading' : ''}`}
            role="button"
            tabIndex={isLoading ? -1 : 0}
            aria-disabled={isLoading}
            onDragOver={handleDragOver}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={openFilePicker}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openFilePicker()
              }
            }}
          >
            <span className="dropzone-icon" aria-hidden="true"><UploadIcon size={22} /></span>
            <p className="dropzone-title">Перетащите .docx или .pdf сюда или нажмите, чтобы выбрать</p>
            <p className="dropzone-hint">
              Поддерживаются текстовые и сканированные PDF (распознавание через OCR)
            </p>
            {fileName && <p className="filename">Файл: {fileName}</p>}
          </div>
          {!isLoading && (
            <label className="upload-option">
              <input type="checkbox" checked={forceOcr} onChange={(event) => setForceOcr(event.target.checked)} />
              <span>
                <span className="upload-option-title">Распознать все страницы через OCR</span>
                <span className="upload-option-hint">
                  Для сканов и PDF с поврежденным текстовым слоем. Применится к следующему загруженному файлу.
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {status === 'loading' && (
        <div className="status-block">
          <p className="status status-loading" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            {statusLabel(progress, elapsedSec)}
          </p>
          {statusHint(progress) && <p className="status-hint">{statusHint(progress)}</p>}
          <button type="button" onClick={cancelAnalysis}>Отменить обработку</button>
        </div>
      )}
      {status === 'error' && <p className="status error">{error}</p>}

      {!hasResult && (
        <HistoryPanel
          docs={visibleHistory}
          currentId={currentDocId}
          errorText={historyError}
          onOpen={(doc) => { void handleOpenDoc(doc) }}
          onDelete={requestDeleteDoc}
          onExport={() => { void handleExportHistory() }}
          onImport={(file) => { void handleImportHistory(file) }}
        />
      )}

      {hasResult && (
        <TopBar
          fileName={fileName}
          saveState={historyError ? 'error' : saving ? 'saving' : 'saved'}
          isLoading={isLoading}
          isDragging={isDragging}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          forceOcr={forceOcr}
          onForceOcrChange={setForceOcr}
          onPickFile={openFilePicker}
          historyDocs={visibleHistory}
          currentDocId={currentDocId}
          onOpenDoc={(doc) => { void handleOpenDoc(doc) }}
          onShowAllDocs={() => { void flush().then(() => setHasResult(false)).catch(() => {}) }}
          onExportHistory={() => { void handleExportHistory() }}
          onImportHistory={(file) => { void handleImportHistory(file) }}
        />
      )}

      {hasResult && historyError && <p className="status error" role="alert">
        {historyError} <button type="button" onClick={() => { void flush().catch(() => {}) }}>Повторить сохранение</button>
      </p>}

      {snapshot.doc && (
        <section className="result" hidden={!hasResult} aria-label="Документ">
          <StatusStrip
            unreviewedCount={unreviewedCount}
            replacedValues={replaced.values}
            replacedPlaces={replaced.places}
            exportFileName={`${baseName(fileName)}.md`}
            onShowCandidates={showCandidates}
            onExport={handleExport}
            onCopy={() => void handleCopy()}
            onExportCsv={handleExportCsv}
          />
          {nerNotice && (
            <p className="ner-notice">
              Модель распознавания имен, компаний и адресов не загрузилась (при первом запуске нужен
              интернет). Найдены только данные, которые определяются по шаблону: телефоны, email,
              реквизиты, номера документов.
            </p>
          )}
          {imageCount > 0 && <p className="image-notice">
            В документе есть изображения ({imageCount}). При копировании и экспорте текста они заменяются
            отметкой об удалении: данные внутри изображений автоматически не обезличиваются.
          </p>}

          {placeholderCollision && (
            <p className="collision-notice">
              В документе уже есть текст вида [PERSON_1], похожий на метки замены. В итоговом тексте
              такие фрагменты экранируются, чтобы их нельзя было спутать.
            </p>
          )}

          {(wideWindow || showViewToggle) && (
            <div className="result-toolbar">
              {!sideBySide && showViewToggle && (
                <div className="view-toggle" role="group" aria-label="Вид">
                  <button
                    type="button"
                    className={view === 'source' ? 'active' : ''}
                    aria-pressed={view === 'source'}
                    onClick={() => setView('source')}
                  >
                    Исходник
                  </button>
                  <button
                    type="button"
                    className={view === 'result' ? 'active' : ''}
                    aria-pressed={view === 'result'}
                    onClick={() => setView('result')}
                  >
                    Результат
                  </button>
                </div>
              )}
              {sideBySide && <span className="result-toolbar-hint">Правки в исходнике сразу видны в результате справа</span>}
              {wideWindow && (
                <label className="side-by-side-option">
                  <input
                    type="checkbox"
                    checked={preferSideBySide}
                    onChange={(event) => setPreferSideBySide(event.target.checked)}
                  />
                  Результат рядом
                </label>
              )}
            </div>
          )}

          <div className={`editor-layout${sideBySide ? ' is-side-by-side' : ''}`}>
            <div className="workspace-docs">
            <Suspense fallback={<p role="status">Загрузка редактора…</p>}>
            <EntityEditor
              key={currentDocId}
              hidden={!sideBySide && view !== 'source'}
              value={sourceText}
              entities={entities}
              onChange={handleEditorChange}
              onAddEntity={handleAddEntity}
              onAttachToEntity={handleAttachToEntity}
              selectedType={selectedType}
              onSelectedTypeChange={setSelectedType}
              reveal={reveal}
              onMergeEntity={handleMergeEntity}
              onHoverEntity={setHoveredEntityId}
              currentCandidate={{ id: sidePanelTab === 'review' ? currentCandidateId : null, nonce: activeCandidate.nonce }}
            />
            </Suspense>
            <AnonymizedPreview
              text={anonymizedText}
              sourceText={sourceText}
              segments={anonymized.segments}
              entities={entities}
              hidden={!sideBySide && view !== 'result'}
              focus={resultFocus}
            />
            </div>
            <EntityList
              entities={entities}
              sourceText={sourceText}
              onToggle={handleToggle}
              onChangeType={handleChangeType}
              onDelete={handleDelete}
              onSelect={handleSelectEntity}
              onMergeEntity={handleMergeEntity}
              onSetAnonymize={handleSetAnonymize}
              highlightedId={hoveredEntityId}
              tab={sidePanelTab}
              onTabChange={setSideTab}
              pendingCount={unreviewedCount}
              review={(
                <CandidateReview
                  entities={entities}
                  sourceText={sourceText}
                  activeId={activeCandidate.id}
                  onActivate={activateCandidate}
                  onAccept={handleAcceptCandidate}
                  onReject={handleRejectCandidate}
                  onAcceptAllRelated={handleAcceptAllRelated}
                  onRestore={handleRestoreCandidate}
                  onChangeType={handleChangeType}
                  onExport={handleExport}
                />
              )}
            />
          </div>

        </section>
      )}

      <Toast toast={toast} onClose={closeToast} />
    </div>
  )
}

export default App
