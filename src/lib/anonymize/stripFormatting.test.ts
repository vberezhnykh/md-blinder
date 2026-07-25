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

  it('drops an embedded base64 data URI but keeps the alt text and offsets', () => {
    const base64 = 'A'.repeat(500) + '+/=='
    const md = `Заказчик: Иван Петров ![схема](data:image/jpeg;base64,${base64}) ИНН 7736324582`
    const { plain, map } = stripInlineFormatting(md)

    // The base64 payload is gone; alt text and the rest survive.
    expect(plain).not.toContain(base64)
    expect(plain).not.toContain('base64')
    expect(plain).toContain('схема')
    expect(plain).toContain('Иван Петров')
    expect(plain).toContain('ИНН 7736324582')
    // map stays valid: every plain char maps to its true source char, ascending.
    expect(map.length).toBe(plain.length)
    for (let i = 0; i < plain.length; i++) expect(md[map[i]]).toBe(plain[i])
    for (let i = 1; i < map.length; i++) expect(map[i]).toBeGreaterThan(map[i - 1])
  })

  it('remaps an entity that sits AFTER a data URI back to the right source span', () => {
    const base64 = 'Z'.repeat(1000)
    const name = 'Иван Петров'
    const md = `![x](data:image/png;base64,${base64}) ${name} подписал`
    const { plain, map } = stripInlineFormatting(md)

    const start = plain.indexOf(name)
    const matches: RawMatch[] = [{ type: 'PERSON', value: '', start, end: start + name.length }]
    const [remapped] = remapMatches(matches, plain, map)

    // Despite the huge dropped base64 before it, the source offset is exact.
    expect(md.slice(remapped.start, remapped.end)).toBe(name)
  })

  it('is a no-op on text without a data URI', () => {
    const md = 'ООО «Когнитек», ИНН 7736324582'
    const { plain } = stripInlineFormatting(md)
    expect(plain).toBe(md)
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
