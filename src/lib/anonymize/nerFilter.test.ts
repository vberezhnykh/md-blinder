import { describe, it, expect } from 'vitest'
import { filterGenericNerMatches } from './nerFilter'
import type { EntityType, RawMatch } from './types'

function match(type: EntityType, value: string): RawMatch {
  return { type, value, start: 0, end: value.length }
}

describe('filterGenericNerMatches', () => {
  it('drops generic role-noun PERSON matches', () => {
    const dropped = [
      'Director',
      'Client',
      'End-User',
      'Service Provider',
      'such party',
      'recipient Party',
      'disclosing Party',
      'the violating Party',
    ]
    const matches = dropped.map((v) => match('PERSON', v))
    const result = filterGenericNerMatches(matches)
    for (const v of dropped) {
      expect(result.some((m) => m.value === v)).toBe(false)
    }
  })

  it('drops generic ADDRESS matches', () => {
    const dropped = ['registered office address', 'principal place of business']
    const matches = dropped.map((v) => match('ADDRESS', v))
    const result = filterGenericNerMatches(matches)
    for (const v of dropped) {
      expect(result.some((m) => m.value === v)).toBe(false)
    }
  })

  it('keeps real PERSON names', () => {
    const result = filterGenericNerMatches([match('PERSON', 'John Smith')])
    expect(result).toHaveLength(1)
  })

  it('keeps real COMPANY names', () => {
    const kept = ['Acme Ltd', 'Baker & Partners']
    const result = filterGenericNerMatches(kept.map((v) => match('COMPANY', v)))
    expect(result).toHaveLength(2)
  })

  it('keeps ADDRESS matches containing digits', () => {
    const result = filterGenericNerMatches([match('ADDRESS', '12 Baker Street')])
    expect(result).toHaveLength(1)
  })

  it('keeps real ADDRESS names without generic words', () => {
    const result = filterGenericNerMatches([match('ADDRESS', 'Example Avenue')])
    expect(result).toHaveLength(1)
  })

  it('passes structural types through unchanged', () => {
    const email = match('EMAIL', 'a@b.com')
    const result = filterGenericNerMatches([email])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(email)
  })

  it('drops generic REG_NUMBER phrases without digits', () => {
    const dropped = [
      'Company registration number',
      'registration number',
      'VAT number',
      'tax id',
    ]
    const matches = dropped.map((v) => match('REG_NUMBER', v))
    const result = filterGenericNerMatches(matches)
    for (const v of dropped) {
      expect(result.some((m) => m.value === v)).toBe(false)
    }
  })

  it('keeps REG_NUMBER matches containing digits', () => {
    const kept = ['12345678', '00.000.000/0000-00']
    const result = filterGenericNerMatches(kept.map((v) => match('REG_NUMBER', v)))
    expect(result).toHaveLength(2)
  })
})
