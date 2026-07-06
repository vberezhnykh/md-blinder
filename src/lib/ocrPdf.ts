import { createWorker } from 'tesseract.js'
import { loadPdf } from './pdf'

export interface OcrProgress {
  page: number
  total: number
  pct: number
}

// Scanned PDFs have no text layer, so render each page to a canvas via pdf.js
// and OCR it with Tesseract.js (which runs its own WASM Web Worker). The eng
// language model is fetched from CDN on first run and cached by Tesseract.js;
// the page image itself never leaves the browser.
export async function ocrPdfToMarkdown(
  arrayBuffer: ArrayBuffer,
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  const pdf = await loadPdf(arrayBuffer)
  const total = pdf.numPages
  let currentPage = 0

  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      onProgress?.({
        page: currentPage,
        total,
        pct: Math.round((m.progress ?? 0) * 100),
      })
    },
  })

  try {
    const pages: string[] = []
    for (let i = 1; i <= total; i++) {
      currentPage = i
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Не удалось создать 2D-контекст для рендера PDF')
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      const { data } = await worker.recognize(canvas)
      pages.push(data.text.trim())
      canvas.width = 0
      canvas.height = 0
    }
    return pages.join('\n\n')
  } finally {
    await worker.terminate()
  }
}
