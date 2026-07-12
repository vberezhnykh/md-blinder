import { describe, it, expect } from 'vitest'
import { stitchAddressRuns } from './stitchAddress'
import type { RawMatch } from './types'

describe('stitchAddressRuns', () => {
  it('merges two ADDRESS fragments separated by ", " into one span', () => {
    const text = 'Located at ROOM C05, 123 Main Street in the annex.'
    const frag1 = 'ROOM C05'
    const frag2 = '123 Main Street'
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    const matches: RawMatch[] = [
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('ADDRESS')
    expect(result[0].start).toBe(start1)
    expect(result[0].end).toBe(start2 + frag2.length)
    expect(result[0].value).toBe(text.slice(result[0].start, result[0].end))
  })

  it('merges ADDRESS fragments separated by a short numeric gap like ", 2-4 "', () => {
    const text = 'Building at BLOCK A, 2-4 SECOND FLOOR for delivery'
    const frag1 = 'BLOCK A'
    const frag2 = 'SECOND FLOOR'
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    const matches: RawMatch[] = [
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    expect(result).toHaveLength(1)
    expect(result[0].start).toBe(start1)
    expect(result[0].end).toBe(start2 + frag2.length)
    expect(result[0].value).toBe(text.slice(result[0].start, result[0].end))
  })

  it('merges across an abbreviation dot before a digit ("No. 1912")', () => {
    const text = 'at Avenida Paulista, No. 1912, Sala 61 today'
    const frag1 = 'Avenida Paulista'
    const frag2 = 'Sala 61'
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    const matches: RawMatch[] = [
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    expect(result).toHaveLength(1)
    expect(result[0].value).toBe('Avenida Paulista, No. 1912, Sala 61')
  })

  it('does not merge ADDRESS fragments separated by a paragraph boundary', () => {
    const text = 'MAIN ST\n\nSECOND AVE'
    const frag1 = 'MAIN ST'
    const frag2 = 'SECOND AVE'
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    const matches: RawMatch[] = [
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    expect(result).toHaveLength(2)
    const values = result.map((m) => m.value).sort()
    expect(values).toEqual([frag1, frag2].sort())
  })

  it('does not merge ADDRESS fragments separated by a sentence boundary', () => {
    const text = 'MAIN ST. SECOND AVE'
    const frag1 = 'MAIN ST'
    const frag2 = 'SECOND AVE'
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    const matches: RawMatch[] = [
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    expect(result).toHaveLength(2)
    const values = result.map((m) => m.value).sort()
    expect(values).toEqual([frag1, frag2].sort())
  })

  it('merges overlapping ADDRESS fragments into one span', () => {
    const text = '123 MAIN STREET APT 4B'
    const frag1 = '123 MAIN STREET'
    const frag2 = 'STREET APT 4B'
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    const matches: RawMatch[] = [
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    expect(result).toHaveLength(1)
    expect(result[0].start).toBe(start1)
    expect(result[0].end).toBe(start2 + frag2.length)
    expect(result[0].value).toBe(text.slice(result[0].start, result[0].end))
  })

  it('passes non-ADDRESS matches through unchanged', () => {
    const text = 'John Doe lives at ROOM C05, 123 Main Street'
    const person = 'John Doe'
    const frag1 = 'ROOM C05'
    const frag2 = '123 Main Street'
    const personStart = text.indexOf(person)
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    const matches: RawMatch[] = [
      { type: 'PERSON', value: person, start: personStart, end: personStart + person.length },
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    const personMatch = result.find((m) => m.type === 'PERSON')
    expect(personMatch).toEqual({
      type: 'PERSON',
      value: person,
      start: personStart,
      end: personStart + person.length,
    })

    const addressMatches = result.filter((m) => m.type === 'ADDRESS')
    expect(addressMatches).toHaveLength(1)
    expect(addressMatches[0].start).toBe(start1)
    expect(addressMatches[0].end).toBe(start2 + frag2.length)
  })

  // AUD-2.4: a stop-word gap ("... to ...") separates two DIFFERENT addresses,
  // it must not be bridged even though the gap itself is short.
  it('does not merge two different addresses separated by " to "', () => {
    const text = 'Deliver from 1 Main St, Springfield to 2 Oak Ave, Shelbyville please'
    const frag1 = '1 Main St, Springfield'
    const frag2 = '2 Oak Ave, Shelbyville'
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    const matches: RawMatch[] = [
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    expect(result).toHaveLength(2)
    const values = result.map((m) => m.value).sort()
    expect(values).toEqual([frag1, frag2].sort())
  })

  it('does not merge two different addresses separated by " and "', () => {
    const text = 'Sites at 1 Main St, Springfield and 2 Oak Ave, Shelbyville are affected'
    const frag1 = '1 Main St, Springfield'
    const frag2 = '2 Oak Ave, Shelbyville'
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    const matches: RawMatch[] = [
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    expect(result).toHaveLength(2)
    const values = result.map((m) => m.value).sort()
    expect(values).toEqual([frag1, frag2].sort())
  })

  it('still merges ADDRESS fragments separated by a glue gap like " / "', () => {
    const text = 'Located at BLOCK A / SECOND FLOOR for delivery'
    const frag1 = 'BLOCK A'
    const frag2 = 'SECOND FLOOR'
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    const matches: RawMatch[] = [
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    expect(result).toHaveLength(1)
    expect(result[0].start).toBe(start1)
    expect(result[0].end).toBe(start2 + frag2.length)
    expect(result[0].value).toBe(text.slice(result[0].start, result[0].end))
  })

  it('does not merge ADDRESS fragments separated by a gap longer than 30 characters', () => {
    const text = 'MAIN ST here is some unrelated filler text padding out the gap SECOND AVE'
    const frag1 = 'MAIN ST'
    const frag2 = 'SECOND AVE'
    const start1 = text.indexOf(frag1)
    const start2 = text.indexOf(frag2)

    expect(start2 - (start1 + frag1.length)).toBeGreaterThan(30)

    const matches: RawMatch[] = [
      { type: 'ADDRESS', value: frag1, start: start1, end: start1 + frag1.length },
      { type: 'ADDRESS', value: frag2, start: start2, end: start2 + frag2.length },
    ]

    const result = stitchAddressRuns(matches, text)

    expect(result).toHaveLength(2)
    const values = result.map((m) => m.value).sort()
    expect(values).toEqual([frag1, frag2].sort())
  })
})
