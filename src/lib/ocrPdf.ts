import { createWorker, type Worker } from 'tesseract.js'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdf } from './pdf'
import { OCR_LANGS } from './ocrLangs'
import { stripRepeatedLinesAndPageNumbers } from './pdfStructure'
import { withAbort } from './conversionAbort'

export interface OcrProgress {
  page: number
  total: number
  pct: number
}

/** Borrow the already-open PDF, and use one OCR worker for all selected pages. */
export async function ocrPdfPages(
  pdf: PDFDocumentProxy,
  pageNumbers: number[],
  onProgress?: (p: OcrProgress) => void,
  options: { signal?: AbortSignal } = {},
): Promise<Map<number, string>> {
  const { signal } = options
  signal?.throwIfAborted()
  const sortedPageNumbers = [...new Set(pageNumbers)].sort((a, b) => a - b)
  if (!sortedPageNumbers.length) return new Map()
  const total = sortedPageNumbers.length
  let currentPage = 0

  let worker: Worker | undefined
  let terminated: ReturnType<Worker['terminate']> | undefined
  const terminate = () => {
    if (worker) terminated ??= worker.terminate()
    void terminated?.catch(() => {})
  }
  const workerPromise = createWorker([...OCR_LANGS], 1, {
    logger: (m: { status: string; progress: number }) => {
      if (!signal?.aborted) onProgress?.({
        page: currentPage,
        total,
        pct: Math.round((m.progress ?? 0) * 100),
      })
    },
  })
  // Initialization cannot be interrupted by Tesseract. If cancellation wins,
  // terminate the created worker as soon as initialization eventually finishes.
  void workerPromise.then((created) => {
    worker = created
    if (signal?.aborted) terminate()
  }, () => {})

  try {
    await withAbort(workerPromise, signal)
    signal?.throwIfAborted()
    const pages: string[] = []
    for (let idx = 0; idx < sortedPageNumbers.length; idx++) {
      currentPage = idx + 1
      const page = await withAbort(pdf.getPage(sortedPageNumbers[idx]), signal)
      const canvas = document.createElement('canvas')
      try {
        const viewport = page.getViewport({ scale: 2 })
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Не удалось создать 2D-контекст для рендера PDF')
        const rendering = page.render({ canvas, canvasContext: ctx, viewport })
        await withAbort(rendering.promise, signal, () => rendering.cancel())
        signal?.throwIfAborted()
        const { data } = await withAbort(worker!.recognize(canvas), signal, terminate)
        pages.push(data.text.trim())
      } finally {
        canvas.width = 0
        canvas.height = 0
        page.cleanup()
      }
    }

    const pagesLines = pages.map((text) =>
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    )
    const cleanedPages = stripRepeatedLinesAndPageNumbers(pagesLines)

    return new Map(sortedPageNumbers.map((pageNumber, idx) => [pageNumber, cleanedPages[idx].join('\n')]))
  } finally {
    terminate()
    await terminated
  }
}

/** Standalone entry point; this wrapper owns and closes its PDF. */
export async function ocrPdfToMarkdown(
  arrayBuffer: ArrayBuffer,
  pageNumbers: number[],
  onProgress?: (p: OcrProgress) => void,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const pdf = await loadPdf(arrayBuffer, options.signal)
  try {
    const pages = await ocrPdfPages(pdf, pageNumbers, onProgress, options)
    return [...pages.values()].join('\n\n')
  } finally {
    await pdf.loadingTask.destroy()
  }
}
