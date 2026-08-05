import { describe, it, expect } from 'vitest'
import { normalizeValue } from './index'

describe('normalizeValue', () => {
  // AUD-2.7: PHONE formatting variants must group together for dedup.
  it('normalizes PHONE formatting variants to the same value', () => {
    const a = normalizeValue('PHONE', '+36 1 234 5678')
    const b = normalizeValue('PHONE', '+36-1-234-5678')
    expect(a).toBe(b)
  })

  it('normalizes a parenthesized PHONE the same as a hyphenated one', () => {
    const a = normalizeValue('PHONE', '(202) 555-0123')
    const b = normalizeValue('PHONE', '202.555.0123')
    expect(a).toBe(b)
  })

  // AUD-2.7: REG_NUMBER case-insensitive grouping.
  it('normalizes REG_NUMBER case-insensitively', () => {
    const a = normalizeValue('REG_NUMBER', 'hu12345678')
    const b = normalizeValue('REG_NUMBER', 'HU12345678')
    expect(a).toBe(b)
  })

  // AUD-2.7: SWIFT normalizes to upper-case defensively.
  it('normalizes a lowercase SWIFT code to upper case', () => {
    expect(normalizeValue('SWIFT', 'deutdeff')).toBe('DEUTDEFF')
  })

  it('still lowercases PERSON and EMAIL values', () => {
    expect(normalizeValue('PERSON', 'John Doe')).toBe('john doe')
    expect(normalizeValue('EMAIL', 'John@Acme.co')).toBe('john@acme.co')
  })

  it('leaves CARD/IBAN/ACCOUNT normalization unchanged', () => {
    expect(normalizeValue('CARD', '4111 1111 1111 1111')).toBe('4111111111111111')
    expect(normalizeValue('IBAN', 'gb82 west1234 5698765432')).toBe('GB82WEST12345698765432')
    expect(normalizeValue('ACCOUNT', '1234-5678')).toBe('12345678')
  })

  // Паспорт пишут по-разному в шапке и в реквизитах одного и того же договора.
  it('groups ID_DOC spacing variants', () => {
    const a = normalizeValue('ID_DOC', '4506 123456')
    expect(normalizeValue('ID_DOC', '45 06 123456')).toBe(a)
    expect(normalizeValue('ID_DOC', '4506123456')).toBe(a)
  })

  it('uppercases an ID_DOC letter series', () => {
    expect(normalizeValue('ID_DOC', 'ab 1234567')).toBe('AB1234567')
  })

  it('groups URL spellings of the same host', () => {
    const a = normalizeValue('URL', 'https://Example.com/')
    expect(normalizeValue('URL', 'www.example.com')).toBe(a)
    expect(normalizeValue('URL', 'example.com')).toBe(a)
  })

  it('keeps distinct URL paths apart', () => {
    expect(normalizeValue('URL', 'example.com/a')).not.toBe(normalizeValue('URL', 'example.com/b'))
  })
})
