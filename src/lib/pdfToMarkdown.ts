import { loadPdf } from './pdf'

export async function pdfToMarkdown(
  arrayBuffer: ArrayBuffer,
  onProgress?: (page: number, total: number) => void,
): Promise<{ markdown: string; scanned: boolean }> {
  const pdf = await loadPdf(arrayBuffer)

  const pages: string[] = []
  let trimmedTotalTextLength = 0

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    let pageText = ''
    for (const item of content.items) {
      if ('str' in item) {
        pageText += item.str
        if (item.hasEOL) pageText += '\n'
      }
    }

    const normalized = pageText
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim()

    trimmedTotalTextLength += normalized.replace(/\s/g, '').length
    pages.push(normalized)
    onProgress?.(i, pdf.numPages)
  }

  const scanned = trimmedTotalTextLength < pdf.numPages * 8

  return { markdown: pages.join('\n\n'), scanned }
}
