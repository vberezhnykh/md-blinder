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

  // C2: role/defined terms the older vocabulary let through as PERSON/COMPANY.
  it('drops C2 role/defined-term PERSON & COMPANY matches', () => {
    const dropped: [EntityType, string][] = [
      ['PERSON', 'Consultant'],
      ['PERSON', 'CEO'],
      ['COMPANY', 'Notifying Party'],
      ['PERSON', 'General Counsel'],
      ['COMPANY', 'Agency sales force'],
      ['PERSON', 'the Addressee'],
      ['PERSON', 'Vice President'],
      ['PERSON', 'Sponsor'],
    ]
    const result = filterGenericNerMatches(dropped.map(([t, v]) => match(t, v)))
    for (const [, v] of dropped) {
      expect(result.some((m) => m.value === v)).toBe(false)
    }
  })

  it('keeps real names/companies that merely contain a role word', () => {
    const kept = [
      match('PERSON', 'John Smith'),
      match('COMPANY', 'General Motors'),
      match('COMPANY', 'Creative Agency'),
      match('COMPANY', 'Acme Consulting'),
      match('PERSON', 'Sales Director Anna Lee'),
    ]
    const result = filterGenericNerMatches(kept)
    for (const m of kept) {
      expect(result.some((r) => r.value.includes(m.value.split(' ').pop()!))).toBe(true)
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
    const result = filterGenericNerMatches([match('ADDRESS', 'Avenida Paulista')])
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
    const kept = ['12345678', '53.200.745/0001-60']
    const result = filterGenericNerMatches(kept.map((v) => match('REG_NUMBER', v)))
    expect(result).toHaveLength(2)
  })

  it('drops a UK postcode mislabeled as REG_NUMBER', () => {
    const dropped = ['AB1 2CD', 'SW1A 1AA', 'EC1A 1BB']
    const result = filterGenericNerMatches(dropped.map((v) => match('REG_NUMBER', v)))
    expect(result).toHaveLength(0)
  })

  it('drops a PERSON span that carries a company suffix', () => {
    const dropped = ['ACME LIMITED GLOBEX LLC', 'Acme Ltd', 'Foo GmbH']
    const result = filterGenericNerMatches(dropped.map((v) => match('PERSON', v)))
    expect(result).toHaveLength(0)
  })

  it('keeps a COMPANY span with a company suffix (suffix rule is PERSON-only)', () => {
    const result = filterGenericNerMatches([match('COMPANY', 'Acme Ltd')])
    expect(result).toHaveLength(1)
  })

  it('trims a leading title/role from a PERSON and keeps the name with adjusted offsets', () => {
    const result = filterGenericNerMatches([match('PERSON', 'Director John Smith')])
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe('John Smith')
    expect(result[0].start).toBe('Director '.length)
    expect(result[0].end).toBe('Director John Smith'.length)
  })

  it('leaves a title-less PERSON name untouched', () => {
    const result = filterGenericNerMatches([match('PERSON', 'John Smith')])
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe('John Smith')
    expect(result[0].start).toBe(0)
  })

  it('drops generic PERSON phrases built from participial/adjective modifiers', () => {
    const dropped = ['permitted subcontractors', 'Impacted Party', 'natural person']
    const matches = dropped.map((v) => match('PERSON', v))
    const result = filterGenericNerMatches(matches)
    for (const v of dropped) {
      expect(result.some((m) => m.value === v)).toBe(false)
    }
  })

  // В системе нет типа DATE, значит дата не может быть валидной сущностью
  // ни для одного из проверяемых типов.
  it('drops a date mislabeled as REG_NUMBER or PERSON', () => {
    const dropped: [EntityType, string][] = [
      ['REG_NUMBER', '05.06.2026'],
      ['REG_NUMBER', '2026-06-05'],
      ['PERSON', '5/6/26'],
      ['REG_NUMBER', '31.12.1999'],
      ['REG_NUMBER', '12/25/2024'], // американский порядок m/d/y
    ]
    const result = filterGenericNerMatches(dropped.map(([t, v]) => match(t, v)))
    expect(result).toHaveLength(0)
  })

  // Регрессия recall: GENERIC_DATE не должна отбрасывать регномера, которые
  // просто выглядят как дата по разделителям, но не проходят по диапазону
  // дня/месяца (день/месяц > 31/12 соответственно).
  it('keeps date-shaped values that are not plausible dates (recall regression)', () => {
    const kept: [EntityType, string][] = [
      ['REG_NUMBER', '12.34.5678'],
      ['REG_NUMBER', '99.99.9999'],
      ['REG_NUMBER', '45.13.2020'],
      ['REG_NUMBER', '2026-13-45'],
    ]
    const result = filterGenericNerMatches(kept.map(([t, v]) => match(t, v)))
    expect(result).toHaveLength(kept.length)
  })

  // Регрессия recall: значения не покрытые другими тестами файла, которые
  // фильтр не должен отбрасывать.
  it('keeps real reg-numbers/companies not covered elsewhere (recall regression)', () => {
    const kept = [match('REG_NUMBER', 'HU12345678'), match('COMPANY', 'Consultant Software')]
    const result = filterGenericNerMatches(kept)
    expect(result).toHaveLength(2)
  })
})
