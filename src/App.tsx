import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectFileKind } from './lib/fileType'
import { anonymizeMarkdown, type AnonymizeProgress } from './lib/anonymize'
import { findRelatedOccurrences } from './lib/anonymize/relatedOccurrences'
import { entitiesToCsv } from './lib/anonymize/csv'
import { alignBatch, reconcileBatchPlaceholders, seedFromBatch } from './lib/anonymize/batch'
import { batchEntitiesToCsv, batchToMarkdown } from './lib/anonymize/batchExport'
import { addEntityFromSelection, addOccurrenceToEntity, buildAnonymizedTextWithMap, changeEntityType, compactPlaceholderNumbers, dedupeEntityIds, acceptRelatedCandidate, acceptAllRelated, restoreCandidate, pendingCandidates, mergeEntities } from './lib/anonymize/apply'
import { hasPlaceholderCollision } from './lib/anonymize/placeholderGuard'
import { findImageRanges } from './lib/anonymize/imageSafety'
import { statusLabel, statusHint, type UiProgress } from './lib/progressLabel'
import { copyText } from './lib/clipboard'
import { plural } from './lib/plural'
import type { Entity, EntityType } from './lib/anonymize/types'
import { loadAllDocs, loadBatchDocs, loadDoc, putDoc, deleteDoc, serializeHistory, parseHistory, mergeDocs, type HistoryDoc, type HistoryDocMeta } from './lib/history'
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

// Файл, который нельзя обработать: сообщение показывается пользователю как есть.
class FileRejected extends Error {}

// Конвертирует файл и размечает найденные данные. Для документа пакета
// дополнительно размечает значения, подтвержденные в других документах пакета,
// и согласует с ними метки.
async function analyzeFile(file: File, options: {
  signal: AbortSignal
  forceOcr: boolean
  // Только Markdown: поиск персональных данных не запускается, модель NER не грузится.
  convertOnly: boolean
  batchId?: string
  members: HistoryDoc[]
  onProgress: (p: Progress) => void
}): Promise<{ doc: HistoryDoc; nerFailed: boolean }> {
  const { signal, forceOcr, convertOnly, batchId, members, onProgress } = options
  const kind = await detectFileKind(file)
  signal.throwIfAborted()
  if (kind === 'legacy-doc') {
    throw new FileRejected(
      `Формат .doc не поддерживается. Откройте файл "${file.name}" в Word и сохраните как .docx, затем загрузите заново.`,
    )
  }
  if (kind === 'unknown') {
    throw new FileRejected(`Файл "${file.name}" не поддерживается. Поддерживаются .docx и .pdf (включая сканы).`)
  }

  const buffer = await file.arrayBuffer()
  signal.throwIfAborted()
  let md: string
  if (kind === 'docx') {
    const { docxToMarkdown } = await import('./lib/docxToMarkdown')
    md = await docxToMarkdown(buffer, { signal })
  } else {
    const { pdfToMarkdown } = await import('./lib/pdfToMarkdown')
    const result = await pdfToMarkdown(buffer,
      (page, total) => onProgress({ phase: 'pdf', page, total }),
      (p) => onProgress({ phase: 'ocr', page: p.page, total: p.total, pct: p.pct }),
      { signal, forceOcr },
    )
    md = result.markdown
  }
  signal.throwIfAborted()
  const now = Date.now()
  if (convertOnly) {
    return {
      doc: {
        id: crypto.randomUUID(), name: file.name, format: kind, createdAt: now, updatedAt: now,
        sourceText: md, entities: [], ...(batchId ? { batchId } : {}),
      },
      nerFailed: false,
    }
  }
  const { result, nerFailed } = await anonymizeMarkdown(md, (p) => onProgress(toProgress(p)), signal)
  signal.throwIfAborted()
  const seeded = seedFromBatch(md, result.entities, members)
  // Родственные формы найденных сущностей (падежи фамилий, инициалы, название
  // без ОПФ) ищутся правилами без NER, поэтому их можно предложить сразу.
  const related = findRelatedOccurrences(md, seeded)
  const entities = reconcileBatchPlaceholders([...seeded, ...related], md, members)
  return {
    doc: {
      id: crypto.randomUUID(), name: file.name, format: kind, createdAt: now, updatedAt: now,
      sourceText: md, entities, ...(batchId ? { batchId } : {}),
    },
    nerFailed,
  }
}

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
  // Остальные документы пакета открытого документа. Каждая правка согласует
  // метки с ними: одинаковые значения получают одинаковые метки во всем пакете.
  const batchOthersRef = useRef<HistoryDoc[]>([])
  const prepareDoc = useCallback((doc: HistoryDoc): HistoryDoc => {
    if (!doc.batchId) return doc
    const reconciled = reconcileBatchPlaceholders(doc.entities, doc.sourceText, batchOthersRef.current)
    return reconciled === doc.entities ? doc : { ...doc, entities: reconciled }
  }, [])
  const { snapshot, snapshotRef, replace, edit, setEntities } = useDocumentSession(queueSave, prepareDoc)
  const { start: startJob, cancel: cancelJob } = useAnalysisJob()
  const sourceText = snapshot.doc?.sourceText ?? ''
  const entities = snapshot.doc?.entities ?? EMPTY_ENTITIES
  const currentDocId = snapshot.doc?.id ?? null
  const [nerNotice, setNerNotice] = useState(false)
  const [convertOnly, setConvertOnly] = useStoredFlag('md-blinder:convert-only', false)
  // Открытый документ только что сконвертирован без поиска персональных данных.
  const [convertNotice, setConvertNotice] = useState(false)
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
  // Номер обрабатываемого файла, когда загружено несколько.
  const [batchStep, setBatchStep] = useState<{ index: number; total: number } | null>(null)
  // Секунды с начала обработки. Фазы NER на CPU идут по 10–40 секунд без
  // процентов — тикающий таймер единственный признак, что ничего не зависло.
  const [elapsedSec, setElapsedSec] = useState(0)
  const [reveal, setReveal] = useState<{ from: number; to: number; nonce: number } | null>(null)
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null)
  // PDF, загруженный в этом сеансе, и документ, который из него получился.
  // Исходный файл в истории не хранится, поэтому повторное распознавание через
  // OCR доступно только для только что загруженного PDF.
  const [lastPdf, setLastPdf] = useState<{ file: File; docId: string; ocrForced: boolean } | null>(null)
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
  const batchInputRef = useRef<HTMLInputElement>(null)

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

  // Загружает пакет документа и согласует метки во всех его документах по
  // порядку загрузки. Измененные остальные документы сохраняются сразу;
  // сам документ возвращается вызывающему, чтобы тот открыл или сохранил его.
  const loadBatchFor = useCallback(async (doc: HistoryDoc): Promise<{ doc: HistoryDoc; members: HistoryDoc[] }> => {
    if (!doc.batchId) return { doc, members: [doc] }
    const stored = await loadBatchDocs(doc.batchId)
    const members = stored.some((d) => d.id === doc.id)
      ? stored.map((d) => (d.id === doc.id ? doc : d))
      : [...stored, doc]
    const aligned = alignBatch(members)
    await Promise.all(aligned.filter((d, i) => d !== members[i] && d.id !== doc.id).map((d) => putDoc(d)))
    return { doc: aligned.find((d) => d.id === doc.id)!, members: aligned }
  }, [])

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
        const loaded = { ...doc, entities: dedupeEntityIds(doc.entities) }
        const { doc: aligned, members } = await loadBatchFor(loaded)
        if (!job.isCurrent()) return
        batchOthersRef.current = members.filter((d) => d.id !== aligned.id)
        replace(aligned, aligned !== loaded)
      }
      setFileName(meta.name)
      setNerNotice(false)
      setConvertNotice(false)
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
  }, [cancelAnalysis, startJob, flush, snapshotRef, replace, setHistoryError, loadBatchFor])

  const handleDeleteDoc = useCallback(async (id: string) => {
    try {
      // Stop a running analysis before flushing; otherwise it can requeue this doc
      // between the flush and deletion and resurrect it in the autosave timer.
      if (snapshotRef.current.doc?.id === id) cancelAnalysis()
      await flush()
      await deleteDoc(id)
      batchOthersRef.current = batchOthersRef.current.filter((d) => d.id !== id)
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

  // Один файл открывается как отдельный документ. Несколько файлов, а также
  // файлы, добавленные к открытому документу, образуют пакет: одинаковые
  // значения получают одинаковые метки во всех его документах. Файл, который
  // не удалось обработать, пропускается, остальные обрабатываются.
  const processFiles = useCallback(async (
    files: File[],
    options: { forceOcr?: boolean; batch?: { id: string; members: HistoryDoc[] } } = {},
  ) => {
    if (files.length === 0) return
    const forceOcr = options.forceOcr ?? false
    cancelAnalysis()
    const job = startJob()
    setError('')
    setProgress(null)
    setStatus('loading')
    setElapsedSec(0)
    setFileName(files.length === 1 ? files[0].name : plural(files.length, ['файл', 'файла', 'файлов']))
    setNerNotice(false)
    setConvertNotice(false)
    setView('source')
    setHasResult(false)

    const batchId = options.batch?.id ?? (files.length > 1 ? crypto.randomUUID() : undefined)
    const members = [...(options.batch?.members ?? [])]
    const created: HistoryDoc[] = []
    const failures: string[] = []
    let nerFailed = false
    try {
      await flush()
      if (!job.isCurrent()) return
      replace(null)
      for (const [index, file] of files.entries()) {
        setBatchStep(files.length > 1 ? { index: index + 1, total: files.length } : null)
        setProgress(null)
        try {
          const analyzed = await analyzeFile(file, {
            signal: job.signal, forceOcr, convertOnly, batchId, members,
            onProgress: (p) => { if (job.isCurrent()) setProgress(p) },
          })
          if (!job.isCurrent()) return
          created.push(analyzed.doc)
          members.push(analyzed.doc)
          queueSave(analyzed.doc)
          nerFailed ||= analyzed.nerFailed
        } catch (e) {
          if (!job.isCurrent() || job.signal.aborted) return
          const name = files.length > 1 ? ` «${file.name}»` : ''
          failures.push(e instanceof FileRejected ? e.message
            : `Не удалось сконвертировать файл${name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      if (created.length === 0) {
        setStatus('error')
        setError(failures.join(' '))
        return
      }
      const opened = created[0]
      batchOthersRef.current = members.filter((d) => d.id !== opened.id)
      replace(opened, true)
      setFileName(opened.name)
      setLastPdf(files.length === 1 && opened.format === 'pdf' ? { file: files[0], docId: opened.id, ocrForced: forceOcr } : null)
      setNerNotice(nerFailed)
      setConvertNotice(convertOnly)
      setView('source')
      setSideTab(null)
      setActiveCandidate((prev) => ({ id: null, nonce: prev.nonce }))
      setStatus('idle')
      setHasResult(true)
      if (failures.length > 0) {
        showToast({ text: `Обработаны не все файлы. ${failures.join(' ')}`, tone: 'warn', durationMs: 12000 })
      } else if (batchId && members.length > 1) {
        const count = plural(members.length, ['документ', 'документа', 'документов'])
        showToast({
          text: convertOnly
            ? `В пакете ${count}. Остальные документы пакета открываются из меню «Пакет».`
            : `В пакете ${count}: одинаковые значения заменены одинаковыми метками во всех. Остальные документы пакета открываются из меню «Пакет».`,
          durationMs: 8000,
        })
      }
    } catch (e) {
      if (!job.isCurrent() || job.signal.aborted) return
      setStatus('error')
      setError(`Не удалось сконвертировать файл: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBatchStep(null)
      job.finish()
    }
  }, [cancelAnalysis, startJob, flush, replace, queueSave, showToast, convertOnly])

  // Текстовый слой PDF может быть испорчен (сломанная кодировка шрифтов, ошибки
  // старого OCR). Автоматика ему доверяет, а битый текст виден только в
  // результате, поэтому повторное распознавание предлагается после загрузки.
  // Новый документ сохраняется отдельно: правки разметки в прежнем не теряются.
  // Если документ был в пакете, его место в пакете занимает новая версия.
  const retryWithOcr = useCallback(() => {
    if (!lastPdf) return
    const current = snapshotRef.current.doc
    if (current?.id === lastPdf.docId && current.batchId) {
      const { batchId, ...detached } = current
      const members = batchOthersRef.current
      replace(detached, true)
      void processFiles([lastPdf.file], { forceOcr: true, batch: { id: batchId, members } })
      return
    }
    void processFiles([lastPdf.file], { forceOcr: true })
  }, [lastPdf, processFiles, snapshotRef, replace])

  // Добавляет файлы в пакет открытого документа; одиночный документ при этом
  // становится первым документом нового пакета.
  const addToBatch = useCallback((files: File[]) => {
    const current = snapshotRef.current.doc
    if (!current || files.length === 0) return
    const batchId = current.batchId ?? crypto.randomUUID()
    const joined = current.batchId ? current : { ...current, batchId }
    if (joined !== current) replace(joined, true)
    const members = [...batchOthersRef.current, joined].sort((a, b) => a.createdAt - b.createdAt)
    void processFiles(files, { batch: { id: batchId, members } })
  }, [snapshotRef, replace, processFiles])

  const isLoading = status === 'loading'

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!isLoading) void processFiles(files)
    e.target.value = ''
  }

  const handleBatchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!isLoading) addToBatch(files)
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
    void processFiles(Array.from(e.dataTransfer.files ?? []))
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

  // Документы пакета с согласованными метками, в порядке загрузки. Если
  // согласование изменило открытый документ, он обновляется на экране.
  const collectBatch = useCallback(async (): Promise<HistoryDoc[] | null> => {
    await flush()
    const current = snapshotRef.current.doc
    if (!current?.batchId) return null
    const { doc, members } = await loadBatchFor(current)
    batchOthersRef.current = members.filter((d) => d.id !== doc.id)
    if (doc !== current && snapshotRef.current.doc === current) replace(doc, true)
    return members
  }, [flush, snapshotRef, loadBatchFor, replace])

  const handleExportBatch = useCallback(async () => {
    try {
      const members = await collectBatch()
      if (!members) return
      downloadBlob(new Blob([batchToMarkdown(members)], { type: 'text/markdown;charset=utf-8' }), 'md-blinder-package.md')
      const pending = members.reduce((sum, d) => sum + d.entities.filter((e) => e.candidate && !e.dismissed).length, 0)
      const done = `Пакет из ${plural(members.length, ['документа', 'документов', 'документов'])} сохранен одним файлом.`
      showToast(pending === 0
        ? { text: done, durationMs: 4000 }
        : { text: `${done} Не проверено: ${plural(pending, ['кандидат', 'кандидата', 'кандидатов'])} — в тексте они остались без замены.`, tone: 'warn', durationMs: 8000 })
    } catch (err) {
      showToast({ text: `Не удалось собрать пакет: ${err instanceof Error ? err.message : String(err)}`, tone: 'error', durationMs: 6000 })
    }
  }, [collectBatch, showToast])

  const handleExportBatchCsv = useCallback(async () => {
    try {
      const members = await collectBatch()
      if (!members) return
      downloadBlob(new Blob(['\uFEFF' + batchEntitiesToCsv(members)], { type: 'text/csv;charset=utf-8' }), 'md-blinder-package-replacements.csv')
    } catch (err) {
      showToast({ text: `Не удалось собрать пакет: ${err instanceof Error ? err.message : String(err)}`, tone: 'error', durationMs: 6000 })
    }
  }, [collectBatch, showToast])

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
  const currentBatchId = snapshot.doc?.batchId
  const batchDocs = useMemo(
    () => (currentBatchId
      ? visibleHistory.filter((d) => d.batchId === currentBatchId).sort((a, b) => a.createdAt - b.createdAt)
      : []),
    [visibleHistory, currentBatchId],
  )
  const openFilePicker = () => { if (!isLoading) fileInputRef.current?.click() }
  const openBatchPicker = () => { if (!isLoading) batchInputRef.current?.click() }
  const placeholderCollision = useMemo(() => hasPlaceholderCollision(sourceText), [sourceText])
  const imageCount = useMemo(() => findImageRanges(sourceText).length, [sourceText])

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.pdf"
        multiple
        hidden
        onChange={handleFileInput}
      />
      {hasResult && (
        <input
          ref={batchInputRef}
          type="file"
          accept=".docx,.pdf"
          multiple
          hidden
          aria-label="Добавить документы в пакет"
          onChange={handleBatchInput}
        />
      )}

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
            <p className="dropzone-hint">
              Несколько файлов сразу обрабатываются пакетом: одна и та же сторона получает одинаковую метку во всех документах
            </p>
            {fileName && <p className="filename">Файл: {fileName}</p>}
          </div>
          <label className="convert-only-option">
            <input
              type="checkbox"
              checked={convertOnly}
              disabled={isLoading}
              onChange={(event) => setConvertOnly(event.target.checked)}
            />
            Только конвертировать в Markdown, без поиска персональных данных
          </label>
        </div>
      )}

      {status === 'loading' && (
        <div className="status-block">
          <p className="status status-loading" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            {batchStep && `Документ ${batchStep.index} из ${batchStep.total}. `}
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
          onPickFile={openFilePicker}
          historyDocs={visibleHistory}
          currentDocId={currentDocId}
          onOpenDoc={(doc) => { void handleOpenDoc(doc) }}
          onShowAllDocs={() => { void flush().then(() => setHasResult(false)).catch(() => {}) }}
          inBatch={Boolean(currentBatchId)}
          batchDocs={batchDocs}
          onAddToBatch={openBatchPicker}
          onExportBatch={() => { void handleExportBatch() }}
          onExportBatchCsv={() => { void handleExportBatchCsv() }}
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
          {lastPdf && lastPdf.docId === currentDocId && !lastPdf.ocrForced && !isLoading && (
            <p className="ocr-retry">
              Текст выглядит битым или с ошибками?{' '}
              <button type="button" className="link-button" onClick={retryWithOcr}>
                Распознать заново через OCR
              </button>
              <span className="ocr-retry-hint">
                {' '}Все страницы PDF будут распознаны как изображения. Прежняя версия останется в истории
                {currentBatchId ? ', а в пакете ее заменит новая.' : '.'}
              </span>
            </p>
          )}
          {nerNotice && (
            <p className="ner-notice">
              Модель распознавания имен, компаний и адресов не загрузилась (при первом запуске нужен
              интернет). Найдены только данные, которые определяются по шаблону: телефоны, email,
              реквизиты, номера документов.
            </p>
          )}
          {convertNotice && (
            <p className="convert-notice">
              Документ только сконвертирован в Markdown: поиск персональных данных выключен на стартовом
              экране. Копирование и экспорт дают текст без замен. Данные можно отметить вручную, выделив их
              в исходнике.
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
