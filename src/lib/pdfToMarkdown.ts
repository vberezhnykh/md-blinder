import { loadPdf } from './pdf'
import { itemsToMarkdown, type PdfTextItem } from './pdfStructure'

export async function pdfToMarkdown(
  arrayBuffer: ArrayBuffer,
  onProgress?: (page: number, total: number) => void,
): Promise<{ markdown: string; scanned: boolean }> {
  const pdf = await loadPdf(arrayBuffer)

  const pages: PdfTextItem[][] = []
  let trimmedTotalTextLength = 0

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

    trimmedTotalTextLength += pageText.replace(/\s/g, '').length
    pages.push(pageItems)
    onProgress?.(i, pdf.numPages)
  }

  const scanned = trimmedTotalTextLength < pdf.numPages * 8

  return { markdown: itemsToMarkdown(pages), scanned }
}
