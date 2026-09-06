export interface ImageRange { start: number; end: number }

export const IMAGE_REMOVED_MARKER = '[Изображение удалено при обезличивании]'

function closingBracket(text: string, start: number, open: string, close: string): number {
  let depth = 1
  let quote = ''
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') { i++; continue }
    // Titles and angle-bracket destinations may contain unmatched parentheses.
    if (open === '(') {
      if (quote) { if (ch === quote) quote = ''; continue }
      if (ch === '"' || ch === "'" || ch === '<') { quote = ch === '<' ? '>' : ch; continue }
    }
    if (ch === open) depth++
    if (ch === close && --depth === 0) return i
  }
  return -1
}

const normalizeReference = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()

/** Identify complete images, including alt text and payload. The original is never modified. */
export function findImageRanges(text: string): ImageRange[] {
  const ranges: ImageRange[] = []
  const references = new Set<string>()
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '!' || text[i + 1] !== '[') continue
    const altEnd = closingBracket(text, i + 1, '[', ']')
    if (altEnd < 0) continue
    let end = altEnd + 1
    if (text[end] === '(') {
      const destEnd = closingBracket(text, end, '(', ')')
      if (destEnd >= 0) end = destEnd + 1
      else {
        // A damaged image must not leave its embedded data in the export.
        const lineEnd = text.indexOf('\n', end)
        end = lineEnd < 0 ? text.length : lineEnd
      }
    } else if (text[end] === '[') {
      const refEnd = closingBracket(text, end, '[', ']')
      if (refEnd >= 0) {
        references.add(normalizeReference(text.slice(end + 1, refEnd) || text.slice(i + 2, altEnd)))
        end = refEnd + 1
      }
    } else {
      references.add(normalizeReference(text.slice(i + 2, altEnd)))
    }
    ranges.push({ start: i, end })
    i = end - 1
  }

  // Quoted > characters belong to attributes, not the tag boundary.
  const html = /<(img|picture|svg)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
  let match: RegExpExecArray | null
  while ((match = html.exec(text))) {
    let end = html.lastIndex
    if (match[1].toLowerCase() !== 'img' && !/\/\s*>$/.test(match[0])) {
      const close = new RegExp(`</${match[1]}\\s*>`, 'gi')
      close.lastIndex = end
      const last = close.exec(text)
      end = last ? close.lastIndex : text.length
      html.lastIndex = end
    }
    ranges.push({ start: match.index, end })
  }

  if (references.size) {
    const definition = /^ {0,3}\[([^\]\r\n]+)\]:([^\r\n]*)/gm
    while ((match = definition.exec(text))) {
      if (!references.has(normalizeReference(match[1]))) continue
      let end = definition.lastIndex
      if (!match[2].trim()) {
        const destinationLine = /^\r?\n[ \t]*\S[^\r\n]*/.exec(text.slice(end))
        if (destinationLine) end += destinationLine[0].length
      }
      const titleLine = /^\r?\n[ \t]+["'(][^\r\n]*/.exec(text.slice(end))
      if (titleLine) end += titleLine[0].length
      ranges.push({ start: match.index, end })
      definition.lastIndex = end
    }
  }

  // Also remove orphaned/HTML-escaped image payloads; they remain recoverable pixels.
  const data = /data:image\/[^\s<>"')\]]+/gi
  while ((match = data.exec(text))) ranges.push({ start: match.index, end: data.lastIndex })

  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: ImageRange[] = []
  for (const range of ranges) {
    const previous = merged[merged.length - 1]
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

/** Generated removal notices are opaque to both detectors, just like images. */
export function findImageExclusionRanges(text: string): ImageRange[] {
  const ranges = findImageRanges(text)
  for (let start = text.indexOf(IMAGE_REMOVED_MARKER); start >= 0; start = text.indexOf(IMAGE_REMOVED_MARKER, start + IMAGE_REMOVED_MARKER.length)) {
    ranges.push({ start, end: start + IMAGE_REMOVED_MARKER.length })
  }
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end)
}

/** Same UTF-16 offsets/newlines, without model or regex work on image payloads. */
export function maskImagesForDetection(text: string, ranges = findImageExclusionRanges(text)): string {
  if (!ranges.length) return text
  const parts: string[] = []
  let start = 0
  for (const range of ranges) {
    if (range.end <= start) continue
    const begin = Math.max(start, range.start)
    parts.push(text.slice(start, begin), text.slice(begin, range.end).replace(/[^\r\n]/g, ' '))
    start = range.end
  }
  parts.push(text.slice(start))
  return parts.join('')
}
