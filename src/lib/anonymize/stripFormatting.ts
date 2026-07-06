import type { RawMatch } from './types'

// Removes inline Markdown emphasis/code markers (*, _, `, ~) so the NER model
// sees plain text — e.g. `**_ACME LTD_**` → `ACME LTD`. GLiNER fails to
// recognize entities when markers are glued to the words. Returns the stripped
// text plus `map`, where map[i] is the source-markdown index of the i-th plain
// char, so spans found in the plain text can be mapped back to the original.
export function stripInlineFormatting(md: string): { plain: string; map: number[] } {
  let plain = ''
  const map: number[] = []
  for (let i = 0; i < md.length; i++) {
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
    })
  }
  return out
}
