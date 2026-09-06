import type { RawMatch } from './types'
import { findImageExclusionRanges, type ImageRange } from './imageSafety'

// A Markdown image embeds the whole file as base64: ![alt](data:image/jpeg;base64,<HUGE>).
// mammoth→turndown emits these for embedded images, and a single one can be
// hundreds of KB — which, fed to NER, explodes a doc into 10×+ chunks/inference
// calls (a 289KB sublease went from 26 to 276 chunks, >20 min on CPU). GLiNER
// can't read pixels, so the payload is pure noise. Complete images, identifying
// metadata and generated removal notices are excluded from the compact NER
// projection. The source markdown is untouched.
const DATA_URI_RE = /data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g

// Removes inline Markdown emphasis/code markers (*, _, `, ~) and embedded
// base64 data: URIs so the NER model sees plain text — e.g. `**_ACME LTD_**` →
// `ACME LTD`. GLiNER fails to recognize entities when markers are glued to the
// words. Returns the stripped text plus `map`, where map[i] is the source-
// markdown index of the i-th plain char, so spans found in the plain text can
// be mapped back to the original.
export function stripInlineFormatting(md: string): { plain: string; map: number[]; excluded: ImageRange[] } {
  // Keep generic base64 exclusions too, e.g. a pasted non-image data URI.
  const skip = findImageExclusionRanges(md)
  DATA_URI_RE.lastIndex = 0
  let dm: RegExpExecArray | null
  while ((dm = DATA_URI_RE.exec(md))) skip.push({ start: dm.index, end: dm.index + dm[0].length })
  skip.sort((a, b) => a.start - b.start || b.end - a.end)
  let si = 0

  let plain = ''
  const map: number[] = []
  for (let i = 0; i < md.length; i++) {
    while (si < skip.length && i >= skip[si].end) si++
    if (si < skip.length && i >= skip[si].start) { i = skip[si].end - 1; continue }
    const ch = md[i]
    if (ch === '*' || ch === '_' || ch === '`' || ch === '~') continue
    plain += ch
    map.push(i)
  }
  return { plain, map, excluded: skip }
}

// Maps NER matches (offsets into the stripped `plain` text) back to source-
// markdown offsets via `map`. value is taken from the clean plain text so
// duplicate detection groups e.g. `**Acme**` and `Acme` together. Drops any
// degenerate span.
export function remapMatches(matches: RawMatch[], plain: string, map: number[], excluded: ImageRange[] = []): RawMatch[] {
  const out: RawMatch[] = []
  for (const m of matches) {
    if (!Number.isInteger(m.start) || !Number.isInteger(m.end) || m.start < 0 || m.end <= m.start || m.start >= map.length) continue
    const endIdx = Math.min(m.end, map.length) - 1
    const start = map[m.start]
    const end = map[endIdx] + 1
    // A model span may bridge two words after compacting a large image. It must
    // not absorb the removed image or its neighbouring source text as an entity.
    if (excluded.some((range) => start < range.end && range.start < end)) continue
    out.push({
      type: m.type,
      value: plain.slice(m.start, m.end),
      start,
      end,
      score: m.score,
    })
  }
  return out
}
