import { describe, it, expect } from 'vitest'
import { detectStructural } from './regexDetectors'

describe('detectStructural', () => {
  it('detects an email address', () => {
    const matches = detectStructural('Contact john.doe@acme.co for details')
    const emails = matches.filter((m) => m.type === 'EMAIL')
    expect(emails).toHaveLength(1)
    expect(emails[0].value).toBe('john.doe@acme.co')
  })

  it('detects a valid IBAN', () => {
    const matches = detectStructural('IBAN GB82WEST12345698765432 end')
    const ibans = matches.filter((m) => m.type === 'IBAN')
    expect(ibans.some((m) => m.value === 'GB82WEST12345698765432')).toBe(true)
  })

  it('rejects an IBAN with an invalid checksum', () => {
    const matches = detectStructural('GB00WEST12345698765432')
    expect(matches.some((m) => m.type === 'IBAN')).toBe(false)
  })

  it('rejects an IBAN with an invalid country code', () => {
    const matches = detectStructural('ZZ82WEST12345698765432')
    expect(matches.some((m) => m.type === 'IBAN')).toBe(false)
  })

  it('detects a valid card number with spaces', () => {
    const matches = detectStructural('Card 4111 1111 1111 1111 ok')
    const cards = matches.filter((m) => m.type === 'CARD')
    expect(cards).toHaveLength(1)
    expect(cards[0].value).toBe('4111 1111 1111 1111')
  })

  it('detects a valid card number without spaces', () => {
    const matches = detectStructural('4111111111111111')
    const cards = matches.filter((m) => m.type === 'CARD')
    expect(cards).toHaveLength(1)
    expect(cards[0].value).toBe('4111111111111111')
  })

  it('rejects a card number with an invalid Luhn checksum', () => {
    const matches = detectStructural('4111 1111 1111 1112')
    expect(matches.some((m) => m.type === 'CARD')).toBe(false)
  })

  it('detects a valid 8-char SWIFT code', () => {
    const matches = detectStructural('SWIFT DEUTDEFF here')
    const swifts = matches.filter((m) => m.type === 'SWIFT')
    expect(swifts).toHaveLength(1)
    expect(swifts[0].value).toBe('DEUTDEFF')
  })

  it('detects a valid 11-char SWIFT code', () => {
    const matches = detectStructural('DEUTDEFF500')
    const swifts = matches.filter((m) => m.type === 'SWIFT')
    expect(swifts.some((m) => m.value === 'DEUTDEFF500')).toBe(true)
  })

  it('rejects a SWIFT code with an invalid country code', () => {
    const matches = detectStructural('ABCDZZFF')
    expect(matches.some((m) => m.type === 'SWIFT')).toBe(false)
  })

  it('detects a valid phone number', () => {
    const matches = detectStructural('Call +44 20 7946 0958 now')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones).toHaveLength(1)
    expect(phones[0].value).toBe('+44 20 7946 0958')
  })

  it('rejects a too-short numeric fragment as a phone number', () => {
    const matches = detectStructural('ref 12.34')
    expect(matches.some((m) => m.type === 'PHONE')).toBe(false)
  })

  it('detects an account number from context', () => {
    const matches = detectStructural('Account No: 12345678')
    const accounts = matches.filter((m) => m.type === 'ACCOUNT')
    expect(accounts).toHaveLength(1)
    expect(accounts[0].value).toBe('12345678')
  })

  it('detects a company registration number from context', () => {
    const matches = detectStructural('Company No. 08145531')
    const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
    expect(regNumbers).toHaveLength(1)
    expect(regNumbers[0].value).toBe('08145531')
  })

  it('detects an EIN as a registration number', () => {
    const matches = detectStructural('EIN 12-3456789')
    const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
    expect(regNumbers).toHaveLength(1)
    expect(regNumbers[0].value).toBe('12-3456789')
  })

  it('detects a numeric CNPJ as a registration number', () => {
    const text = 'CNPJ: 00.000.000/0000-00'
    const matches = detectStructural(text)
    const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
    const cnpj = regNumbers.find((m) => m.value === '00.000.000/0000-00')
    expect(cnpj).toBeDefined()
    const start = text.indexOf('00.000.000/0000-00')
    expect(cnpj?.start).toBe(start)
    expect(cnpj?.end).toBe(start + '00.000.000/0000-00'.length)
  })

  it('detects an alphanumeric CNPJ as a registration number', () => {
    const text = 'CNPJ: 12.ABC.345/01DE-35'
    const matches = detectStructural(text)
    const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
    const cnpj = regNumbers.find((m) => m.value === '12.ABC.345/01DE-35')
    expect(cnpj).toBeDefined()
    const start = text.indexOf('12.ABC.345/01DE-35')
    expect(cnpj?.start).toBe(start)
    expect(cnpj?.end).toBe(start + '12.ABC.345/01DE-35'.length)
  })

  it('does not treat a bare dotted number as a CNPJ registration number', () => {
    const matches = detectStructural('Reference 00.000.000 only')
    const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
    expect(regNumbers.some((m) => m.value === '00.000.000')).toBe(false)
  })

  it('does not treat a dotted date as a phone number', () => {
    const matches = detectStructural('Signed on 06.05.2026 by both')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '06.05.2026')).toBe(false)
    expect(phones).toHaveLength(0)
  })

  it('does not treat an ISO-format date as a phone number', () => {
    const matches = detectStructural('Date: 2026-05-06 end')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '2026-05-06')).toBe(false)
  })

  it('still detects a real phone number with international format', () => {
    const matches = detectStructural('Call +44 20 7946 0018 now')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '+44 20 7946 0018')).toBe(true)
  })

  it('still detects a real phone number without country code', () => {
    const matches = detectStructural('Call 020 7946 0018 now')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '020 7946 0018')).toBe(true)
  })
})
