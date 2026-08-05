import { describe, it, expect } from 'vitest'
import {
  findPlaceholderRanges,
  hasPlaceholderCollision,
  escapePlaceholderLiteral,
  unescapePlaceholders,
} from './placeholderGuard'
import { ALL_ENTITY_TYPES } from './types'

describe('findPlaceholderRanges', () => {
  it('locates a single [PERSON_1]-style literal', () => {
    const text = 'Contact [PERSON_1] for details'
    const ranges = findPlaceholderRanges(text)
    expect(ranges).toEqual([{ start: 8, end: 18 }])
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('[PERSON_1]')
  })

  it('locates multi-digit numbers like [REG_NUMBER_12]', () => {
    const text = 'Ref [REG_NUMBER_12] applies'
    const ranges = findPlaceholderRanges(text)
    expect(ranges).toEqual([{ start: 4, end: 19 }])
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('[REG_NUMBER_12]')
  })

  it('returns an empty array for text without collisions', () => {
    expect(findPlaceholderRanges('Just a normal sentence.')).toEqual([])
  })
})

describe('hasPlaceholderCollision', () => {
  it('returns true when the text contains a placeholder-like literal', () => {
    expect(hasPlaceholderCollision('See [COMPANY_3] below')).toBe(true)
  })

  it('returns false when there is no placeholder-like literal', () => {
    expect(hasPlaceholderCollision('No placeholders here')).toBe(false)
  })
})

describe('escapePlaceholderLiteral / unescapePlaceholders round-trip', () => {
  it('restores the original literal after escape then unescape', () => {
    const original = '[PERSON_1]'
    const escaped = escapePlaceholderLiteral(original)
    expect(escaped).not.toBe(original)
    expect(unescapePlaceholders(escaped)).toBe(original)
  })

  it('escaped literal is no longer matched by the placeholder regex', () => {
    const escaped = escapePlaceholderLiteral('[PERSON_1]')
    expect(hasPlaceholderCollision(escaped)).toBe(false)
  })

  it('leaves text without collisions unchanged by unescape', () => {
    const text = 'Nothing to see here'
    expect(unescapePlaceholders(text)).toBe(text)
  })

  // Список типов раньше дублировался строковым литералом, и новый тип молча
  // выпадал из защиты. Теперь он берётся из ALL_ENTITY_TYPES — проверяем на всех.
  it('covers every entity type, including newly added ones', () => {
    for (const type of ALL_ENTITY_TYPES) {
      expect(hasPlaceholderCollision(`текст [${type}_1] текст`)).toBe(true)
    }
  })
})
