import { loadPdf } from './pdf'
import { itemsToMarkdown, type PdfTextItem } from './pdfStructure'
import { classifyPdfPages } from './pdfPageClassify'
import { ocrPdfToMarkdown, type OcrProgress } from './ocrPdf'

// Владеет полным решением "текстовый PDF vs скан" и маршрутизацией страниц.
// Каждая страница классифицируется независимо (см. classifyPdfPages): если
// ВСЕ страницы текстовые — идём старым путём (itemsToMarkdown), если ВСЕ
// сканы — старым OCR-путём (ocrPdfToMarkdown на весь документ). Смешанный
// документ (например, текстовая титульная страница + сканированное тело)
// разбивается на максимальные прогоны одного вида и обрабатывается каждым
// конвейером отдельно, без потери страниц.
export async function pdfToMarkdown(
  arrayBuffer: ArrayBuffer,
  onPdfProgress?: (page: number, total: number) => void,
  onOcrProgress?: (p: OcrProgress) => void,
): Promise<{ markdown: string }> {
  // pdf.js передаёт (detach'ит) переданный ArrayBuffer в свой воркер, поэтому
  // заранее откладываем нетронутую копию на случай, если ниже понадобится
  // OCR — каждый OCR-прогон получает свежий срез этой копии.
  const ocrSourceBuffer = arrayBuffer.slice(0)

  const pdf = await loadPdf(arrayBuffer)

  const pages: PdfTextItem[][] = []
  const perPageNonWsCounts: number[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    const pageItems: PdfTextItem[] = []
    let pageText = ''
    for (const item of content.items) {
      if ('str' in item) {
        pageText += item.str
        pageItems.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          w: item.width,
          fontSize: Math.hypot(item.transform[2], item.transform[3]) || item.height || 0,
          fontName: item.fontName,
          hasEOL: item.hasEOL,
        })
      }
    }

    perPageNonWsCounts.push(pageText.replace(/\s/g, '').length)
    pages.push(pageItems)
    onPdfProgress?.(i, pdf.numPages)
  }

  const kinds = classifyPdfPages(perPageNonWsCounts)

  if (kinds.every((k) => k === 'text')) {
    return { markdown: itemsToMarkdown(pages) }
  }

  if (kinds.every((k) => k === 'ocr')) {
    const allPageNumbers = pages.map((_, idx) => idx + 1)
    const markdown = await ocrPdfToMarkdown(ocrSourceBuffer.slice(0), allPageNumbers, onOcrProgress)
    return { markdown }
  }

  // Смешанный документ: группируем страницы в максимальные прогоны одного
  // вида, сохраняя порядок документа, и склеиваем результаты прогонов.
  const runs: { kind: 'text' | 'ocr'; pageNumbers: number[] }[] = []
  for (let i = 0; i < kinds.length; i++) {
    const pageNumber = i + 1
    const lastRun = runs[runs.length - 1]
    if (lastRun && lastRun.kind === kinds[i]) {
      lastRun.pageNumbers.push(pageNumber)
    } else {
      runs.push({ kind: kinds[i], pageNumbers: [pageNumber] })
    }
  }

  const outputs: string[] = []
  for (const run of runs) {
    if (run.kind === 'text') {
      const runPages = run.pageNumbers.map((n) => pages[n - 1])
      outputs.push(itemsToMarkdown(runPages))
    } else {
      const markdown = await ocrPdfToMarkdown(ocrSourceBuffer.slice(0), run.pageNumbers, onOcrProgress)
      outputs.push(markdown)
    }
  }

  return { markdown: outputs.join('\n\n') }
}
