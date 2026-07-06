import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export { pdfjsLib }

export function loadPdf(data: ArrayBuffer) {
  return pdfjsLib.getDocument({ data }).promise
}
