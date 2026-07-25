import type { RawMatch } from './types'

// A Markdown image embeds the whole file as base64: ![alt](data:image/jpeg;base64,<HUGE>).
// mammoth→turndown emits these for embedded images, and a single one can be
// hundreds of KB — which, fed to NER, explodes a doc into 10×+ chunks/inference
// calls (a 289KB sublease went from 26 to 276 chunks, >20 min on CPU). GLiNER
// can't read pixels, so the base64 is pure noise. We drop just the data: payload
// from the NER projection below (the alt text and the surrounding markdown stay);
// the source markdown is untouched. Docs without a data URI are unaffected.
const DATA_URI_RE = /data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g

// Removes inline Markdown emphasis/code markers (*, _, `, ~) and embedded
// base64 data: URIs so the NER model sees plain text — e.g. `**_ACME LTD_**` →
// `ACME LTD`. GLiNER fails to recognize entities when markers are glued to the
// words. Returns the stripped text plus `map`, where map[i] is the source-
// markdown index of the i-th plain char, so spans found in the plain text can
// be mapped back to the original.
export function stripInlineFormatting(md: string): { plain: string; map: number[] } {
  // Precompute base64 data-URI ranges to skip (non-overlapping, ascending).
  const skip: Array<[number, number]> = []
  DATA_URI_RE.lastIndex = 0
  let dm: RegExpExecArray | null
  while ((dm = DATA_URI_RE.exec(md))) skip.push([dm.index, dm.index + dm[0].length])
  let si = 0

  let plain = ''
  const map: number[] = []
  for (let i = 0; i < md.length; i++) {
    while (si < skip.length && i >= skip[si][1]) si++
    if (si < skip.length && i >= skip[si][0]) continue // inside a data: URI — drop
    const ch = md[i]
    if (ch === '*' || ch === '_' || ch === '`' || ch === '~') continue
    plain += ch
    map.push(i)
  }
  return { plain, map }
}

// Maps NER matches (offsets into the stripped `plain` text) back to source-
// markdown offsets via `map`. value is taken from the clean plain text so
// duplicate detection groups e.g. `**Acme**` and `Acme` together. Drops any
// degenerate span.
export function remapMatches(matches: RawMatch[], plain: string, map: number[]): RawMatch[] {
  const out: RawMatch[] = []
  for (const m of matches) {
    if (m.end <= m.start || m.start >= map.length) continue
    const endIdx = Math.min(m.end, map.length) - 1
    out.push({
      type: m.type,
      value: plain.slice(m.start, m.end),
      start: map[m.start],
      end: map[endIdx] + 1,
      score: m.score,
    })
  }
  return out
}
