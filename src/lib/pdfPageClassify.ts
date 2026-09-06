export interface PdfPageSignals {
  nonWsCount: number
  bodyNonWsCount: number
  textAreaRatio: number
  imageAreaRatio: number
}

// A textual header does not make the scan beneath it readable. Large raster
// coverage plus sparse body text routes that page through OCR; a searchable
// scan with a substantial text layer can continue using that layer.
export function classifyPdfPages(pages: (number | PdfPageSignals)[], threshold = 8): ('text' | 'ocr')[] {
  return pages.map((page) => {
    if (typeof page === 'number') return page < threshold ? 'ocr' : 'text'
    if (page.nonWsCount < threshold) return 'ocr'
    if (page.imageAreaRatio >= 0.35 && (page.bodyNonWsCount < 80 || page.textAreaRatio < 0.01)) return 'ocr'
    return 'text'
  })
}
