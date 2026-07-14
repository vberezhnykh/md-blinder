export type FileKind = 'docx' | 'pdf' | 'legacy-doc' | 'unknown'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function looksLikeDocxByName(name: string) {
  return name.toLowerCase().endsWith('.docx')
}

function looksLikePdfByName(name: string) {
  return name.toLowerCase().endsWith('.pdf')
}

function looksLikeLegacyDocByName(file: File) {
  return file.name.toLowerCase().endsWith('.doc') && !looksLikeDocxByName(file.name)
}

// Note: a file named *.pdf without the %PDF- magic bytes is still routed to the PDF path below
// (via looksLikePdfByName); pdf.js then fails to parse it and that failure is surfaced as a
// wrapped error upstream. This is intentional — behavior unchanged, documented here only.
export async function detectFileKind(file: File): Promise<FileKind> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())

  const isPdfMagic =
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46 &&
    head[4] === 0x2d

  if (isPdfMagic || looksLikePdfByName(file.name)) return 'pdf'

  const isZipMagic =
    head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04

  if (isZipMagic && looksLikeDocxByName(file.name)) return 'docx'

  if (looksLikeLegacyDocByName(file)) return 'legacy-doc'

  if (looksLikeDocxByName(file.name) || file.type === DOCX_MIME) return 'docx'

  return 'unknown'
}
