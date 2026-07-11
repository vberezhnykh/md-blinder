import { describe, it, expect } from 'vitest'
import { stripInlineFormatting, remapMatches } from './stripFormatting'
import type { RawMatch } from './types'

describe('stripInlineFormatting', () => {
  it('strips emphasis markers and keeps a valid offset map', () => {
    const md = '**_AKKOL LTD_**'
    const { plain, map } = stripInlineFormatting(md)

    expect(plain).toBe('AKKOL LTD')
    expect(map.length).toBe(plain.length)
    expect(md[map[0]]).toBe('A')
    expect(md[map[map.length - 1]]).toBe('D')
  })

  it('round-trips every plain char back to its source index', () => {
    const md = '**_AKKOL LTD_**'
    const { plain, map } = stripInlineFormatting(md)

    for (let i = 0; i < plain.length; i++) {
      expect(md[map[i]]).toBe(plain[i])
    }
  })
})

describe('remapMatches', () => {
  it('maps a full-span match back to the source markdown', () => {
    const md = '**_AKKOL LTD_**'
    const { plain, map } = stripInlineFormatting(md)
    const matches: RawMatch[] = [{ type: 'COMPANY', value: '', start: 0, end: 9 }]

    const [remapped] = remapMatches(matches, plain, map)

    expect(md.slice(remapped.start, remapped.end)).toBe('AKKOL LTD')
    expect(remapped.value).toBe('AKKOL LTD')
  })

  it('maps a match spanning a mid-word marker back to the source span', () => {
    const md = '**Acme** Ltd'
    const { plain, map } = stripInlineFormatting(md)
    expect(plain).toBe('Acme Ltd')

    const matches: RawMatch[] = [{ type: 'COMPANY', value: '', start: 0, end: plain.length }]
    const [remapped] = remapMatches(matches, plain, map)

    // The source span legitimately swallows the `**` sitting between "Acme"
    // and " Ltd" — apply.ts needs the full span to replace cleanly — but the
    // value (used for display/dedup) is the clean plain text.
    expect(remapped.value).toBe('Acme Ltd')
  })
})
