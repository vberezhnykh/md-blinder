import type { PDFPageProxy } from 'pdfjs-dist'
import { loadPdf, pdfjsLib } from './pdf'
import { itemsToMarkdown, type PdfTextItem, type PdfPageLayout } from './pdfStructure'
import { classifyPdfPages, type PdfPageSignals } from './pdfPageClassify'
import { ocrPdfPages, type OcrProgress } from './ocrPdf'
import { withAbort } from './conversionAbort'

export interface PdfConversionOptions {
  signal?: AbortSignal
  forceOcr?: boolean
}

// Image drawing uses a unit square transformed by the current PDF matrix.
// Sum its area as a conservative scan heuristic, respecting save/restore and
// form transforms. This reads the operator list without rendering a bitmap.
async function imageAreaRatio(page: PDFPageProxy, area: number, signal?: AbortSignal): Promise<number> {
  const list = await withAbort(page.getOperatorList(), signal)
  const { OPS, Util } = pdfjsLib
  let matrix = [1, 0, 0, 1, 0, 0]
  const stack: number[][] = []
  let imageArea = 0
  for (let i = 0; i < list.fnArray.length; i++) {
    const operation = list.fnArray[i]
    const args = list.argsArray[i]
    if (operation === OPS.save || operation === OPS.paintFormXObjectBegin) {
      stack.push(matrix)
      if (operation === OPS.paintFormXObjectBegin && args[0]) matrix = Util.transform(matrix, args[0])
    } else if (operation === OPS.restore || operation === OPS.paintFormXObjectEnd) {
      matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0]
    } else if (operation === OPS.transform) {
      matrix = Util.transform(matrix, args)
    } else if (operation === OPS.paintImageXObject || operation === OPS.paintInlineImageXObject
      || operation === OPS.paintImageMaskXObject) {
      imageArea += Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])
    } else if (operation === OPS.paintImageXObjectRepeat) {
      imageArea += Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])
        * Math.abs(args[1] * args[2]) * (args[3].length / 2)
    } else if (operation === OPS.paintInlineImageXObjectGroup || operation === OPS.paintImageMaskXObjectGroup) {
      const images = operation === OPS.paintInlineImageXObjectGroup ? args[1] : args[0]
      for (const image of images) {
        const transformed = pdfjsLib.Util.transform(matrix, image.transform)
        imageArea += Math.abs(transformed[0] * transformed[3] - transformed[1] * transformed[2])
      }
    } else if (operation === OPS.paintImageMaskXObjectRepeat) {
      imageArea += Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])
        * Math.abs(args[1] * args[4] - args[2] * args[3]) * (args[5].length / 2)
    }
  }
  return Math.min(1, imageArea / Math.max(1, area))
}

// Own one PDF for the entire import and one OCR worker for all scanned pages,
// including non-consecutive pages. Never clone/reopen the full source buffer.
export async function pdfToMarkdown(
  arrayBuffer: ArrayBuffer,
  onPdfProgress?: (page: number, total: number) => void,
  onOcrProgress?: (p: OcrProgress) => void,
  options: PdfConversionOptions = {},
): Promise<{ markdown: string }> {
  const { signal, forceOcr } = options
  const pdf = await loadPdf(arrayBuffer, signal)
  try {
    const pages: PdfTextItem[][] = []
    const signals: PdfPageSignals[] = []
    const layouts: PdfPageLayout[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      signal?.throwIfAborted()
      if (forceOcr) {
        pages.push([])
        continue
      }
      const page = await withAbort(pdf.getPage(i), signal)
      try {
        const content = await withAbort(page.getTextContent(), signal)
        const height = page.view[3] - page.view[1]
        const area = height * (page.view[2] - page.view[0])
        layouts.push({ bottom: page.view[1], height, pageNumber: i, totalPages: pdf.numPages })
        const pageItems: PdfTextItem[] = []
        const metrics: PdfPageSignals = { nonWsCount: 0, bodyNonWsCount: 0, textAreaRatio: 0, imageAreaRatio: 0 }
        for (const item of content.items) {
          if (!('str' in item)) continue
          const fontSize = Math.hypot(item.transform[2], item.transform[3]) || item.height || 0
          const count = item.str.replace(/\s/g, '').length
          const relativeY = (item.transform[5] - page.view[1]) / height
          metrics.nonWsCount += count
          if (relativeY > 0.12 && relativeY < 0.88) metrics.bodyNonWsCount += count
          if (count) metrics.textAreaRatio += Math.abs(item.width * fontSize) / Math.max(1, area)
          pageItems.push({
            str: item.str,
            x: item.transform[4],
            y: item.transform[5],
            w: item.width,
            fontSize,
            fontName: item.fontName,
            hasEOL: item.hasEOL,
          })
        }
        // Dense text layers do not need the more expensive image inspection.
        if (metrics.nonWsCount >= 8 && (metrics.bodyNonWsCount < 80 || metrics.textAreaRatio < 0.01)) {
          metrics.imageAreaRatio = await imageAreaRatio(page, area, signal)
        }
        signals.push(metrics)
        pages.push(pageItems)
        onPdfProgress?.(i, pdf.numPages)
      } finally {
        page.cleanup()
      }
    }
    const kinds = forceOcr ? pages.map(() => 'ocr' as const) : classifyPdfPages(signals)
    const ocrNumbers = kinds.flatMap((kind, idx) => kind === 'ocr' ? [idx + 1] : [])
    const recognized = await ocrPdfPages(pdf, ocrNumbers, onOcrProgress, { signal })
    signal?.throwIfAborted()
    const outputs: string[] = []
    for (let idx = 0; idx < kinds.length;) {
      if (kinds[idx] === 'ocr') {
        outputs.push(recognized.get(idx + 1) ?? '')
        idx++
      } else {
        const start = idx
        while (idx < kinds.length && kinds[idx] === 'text') idx++
        outputs.push(itemsToMarkdown(pages.slice(start, idx), layouts.slice(start, idx)))
      }
    }
    return { markdown: outputs.join('\n\n') }
  } finally {
    await pdf.loadingTask.destroy()
  }
}
