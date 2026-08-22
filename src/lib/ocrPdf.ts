import { createWorker } from 'tesseract.js'
import { loadPdf } from './pdf'
import { OCR_LANGS } from './ocrLangs'
import { stripRepeatedLinesAndPageNumbers } from './pdfStructure'
import { getOcrEngine, type OcrEngineName } from './ocr/engineChoice'
import { recognizePageWithTesseract } from './ocr/tesseract'
import type { PpocrRequest, PpocrResponse } from '../workers/ppocr.worker'

export interface OcrProgress {
  page: number
  total: number
  pct: number
}

/** Распознаёт готовую страницу-картинку и возвращает её текст. */
type PageRecognizer = (
  canvas: HTMLCanvasElement,
  onPagePercent: (pct: number) => void,
) => Promise<string>

// Scanned PDFs have no text layer, so render each requested page to a canvas
// via pdf.js and OCR it. Движков два (см. ocr/engineChoice.ts): Tesseract.js
// по умолчанию и экспериментальный PP-OCRv5 на onnxruntime-web. Оба крутятся в
// своих воркерах, картинка страницы из браузера никуда не уходит.
//
// pageNumbers is a set of 1-based page numbers to OCR (not necessarily the
// whole document — see pdfToMarkdown.ts, which may OCR only a subset of
// pages in a mixed text/scan document). Progress page/total is reported
// relative to the count of pages being OCR'd here, not the full document.
export async function ocrPdfToMarkdown(
  arrayBuffer: ArrayBuffer,
  pageNumbers: number[],
  onProgress?: (p: OcrProgress) => void,
  engine: OcrEngineName = getOcrEngine(),
): Promise<string> {
  const pdf = await loadPdf(arrayBuffer)
  const sortedPageNumbers = [...pageNumbers].sort((a, b) => a - b)
  const total = sortedPageNumbers.length
  let currentPage = 0

  const report = (pct: number) => onProgress?.({ page: currentPage, total, pct })
  const { recognize, dispose } =
    engine === 'ppocr' ? createPpocrRecognizer() : await createTesseractRecognizer(report)

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
      pages.push((await recognize(canvas, report)).trim())
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
    await dispose()
  }
}

interface Recognizer {
  recognize: PageRecognizer
  dispose: () => Promise<void>
}

// Языковые модели (см. OCR_LANGS) тянутся с CDN при первом запуске — ~13 МБ на
// все три, host уже разрешён в CSP (netlify.toml) — и кешируются Tesseract.js.
async function createTesseractRecognizer(report: (pct: number) => void): Promise<Recognizer> {
  const worker = await createWorker([...OCR_LANGS], 1, {
    logger: (m: { status: string; progress: number }) => report(Math.round((m.progress ?? 0) * 100)),
  })
  return {
    recognize: (canvas) => recognizePageWithTesseract(worker, canvas),
    dispose: async () => {
      await worker.terminate()
    },
  }
}

function createPpocrRecognizer(): Recognizer {
  const worker = new Worker(new URL('../workers/ppocr.worker.ts', import.meta.url), {
    type: 'module',
  })
  let nextId = 1

  const recognize: PageRecognizer = async (canvas, onPagePercent) => {
    const id = nextId++
    // ImageBitmap уезжает в воркер переносом, без копирования пикселей;
    // закрывает его сам воркер после распознавания.
    const bitmap = await createImageBitmap(canvas)
    return new Promise<string>((resolve, reject) => {
      const onMessage = (event: MessageEvent<PpocrResponse>) => {
        const data = event.data
        if (data.id !== id) return
        if (data.type === 'progress') {
          // Проценты есть только у стадии распознавания строк; детекция —
          // одна короткая операция, на ней показываем 0.
          const { done, total } = data.progress
          if (data.progress.stage === 'recognize' && total) {
            onPagePercent(Math.round((done ?? 0) * 100 / total))
          } else {
            onPagePercent(0)
          }
          return
        }
        worker.removeEventListener('message', onMessage)
        if (data.type === 'done') resolve(data.text)
        else reject(new Error(`PP-OCR: ${data.message}`))
      }
      worker.addEventListener('message', onMessage)
      worker.postMessage({ id, bitmap } satisfies PpocrRequest, [bitmap])
    })
  }

  return {
    recognize,
    dispose: async () => worker.terminate(),
  }
}
