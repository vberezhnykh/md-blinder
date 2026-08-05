import { createWorker } from 'tesseract.js'
import { loadPdf } from './pdf'
import { OCR_LANGS } from './ocrLangs'
import { stripRepeatedLinesAndPageNumbers } from './pdfStructure'

export interface OcrProgress {
  page: number
  total: number
  pct: number
}

// Scanned PDFs have no text layer, so render each requested page to a canvas
// via pdf.js and OCR it with Tesseract.js (which runs its own WASM Web
// Worker). The language models (see OCR_LANGS) are fetched from CDN on first
// run — ~13 МБ на все три, host уже разрешён в CSP (netlify.toml) — and cached
// by Tesseract.js; the page image itself never leaves the browser.
//
// pageNumbers is a set of 1-based page numbers to OCR (not necessarily the
// whole document — see pdfToMarkdown.ts, which may OCR only a subset of
// pages in a mixed text/scan document). Progress page/total is reported
// relative to the count of pages being OCR'd here, not the full document.
export async function ocrPdfToMarkdown(
  arrayBuffer: ArrayBuffer,
  pageNumbers: number[],
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  const pdf = await loadPdf(arrayBuffer)
  const sortedPageNumbers = [...pageNumbers].sort((a, b) => a - b)
  const total = sortedPageNumbers.length
  let currentPage = 0

  const worker = await createWorker([...OCR_LANGS], 1, {
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
    for (let idx = 0; idx < sortedPageNumbers.length; idx++) {
      currentPage = idx + 1
      const page = await pdf.getPage(sortedPageNumbers[idx])
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

    // Тот же конвейер подавления повторяющихся колонтитулов и голых номеров
    // страниц, что и для текстовых PDF (AUD-2.6), — иначе они засоряют NER.
    const pagesLines = pages.map((text) =>
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    )
    const cleanedPages = stripRepeatedLinesAndPageNumbers(pagesLines)

    return cleanedPages.map((lines) => lines.join('\n')).join('\n\n')
  } finally {
    await worker.terminate()
  }
}
