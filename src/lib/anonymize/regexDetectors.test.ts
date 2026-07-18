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

  it('detects a hyphenated company registration number from context', () => {
    const matches = detectStructural('company registration number: 01-09-391554')
    const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
    expect(regNumbers.some((m) => m.value === '01-09-391554')).toBe(true)
  })

  it('detects an EIN as a registration number', () => {
    const matches = detectStructural('EIN 12-3456789')
    const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
    expect(regNumbers).toHaveLength(1)
    expect(regNumbers[0].value).toBe('12-3456789')
  })

  it('detects a numeric CNPJ as a registration number', () => {
    const text = 'CNPJ: 53.200.745/0001-60'
    const matches = detectStructural(text)
    const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
    const cnpj = regNumbers.find((m) => m.value === '53.200.745/0001-60')
    expect(cnpj).toBeDefined()
    const start = text.indexOf('53.200.745/0001-60')
    expect(cnpj?.start).toBe(start)
    expect(cnpj?.end).toBe(start + '53.200.745/0001-60'.length)
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
    const matches = detectStructural('Reference 53.200.745 only')
    const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
    expect(regNumbers.some((m) => m.value === '53.200.745')).toBe(false)
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

  it('detects a phone number with a 5-digit group', () => {
    const matches = detectStructural('Phone #: 55 11 96074-1591')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '55 11 96074-1591')).toBe(true)
  })

  it('does not treat a Brazilian CEP postal code as a phone number', () => {
    const matches = detectStructural('CEP 95.010-040, Caxias do Sul')
    expect(matches.some((m) => m.type === 'PHONE')).toBe(false)
  })

  it('does not treat an 8-letter word as a SWIFT code without context', () => {
    const matches = detectStructural('TECHVISE LIMITED')
    expect(matches.some((m) => m.type === 'SWIFT')).toBe(false)
  })

  it('detects a SWIFT code with BIC context keyword', () => {
    const matches = detectStructural('BIC: DEUTDEFF')
    const swifts = matches.filter((m) => m.type === 'SWIFT')
    expect(swifts.some((m) => m.value === 'DEUTDEFF')).toBe(true)
  })

  // C2: 11-letter ALL-CAPS headings whose chars 5–6 form a valid ISO country
  // code ("IN" = India) must not be flagged as SWIFT without a SWIFT/BIC label.
  it('does not treat the 11-letter word "APPOINTMENT" as a SWIFT code', () => {
    const matches = detectStructural('APPOINTMENT OF CONSULTANT')
    expect(matches.some((m) => m.type === 'SWIFT')).toBe(false)
  })

  it('does not treat the 11-letter word "TERMINATION" as a SWIFT code', () => {
    const matches = detectStructural('7. TERMINATION AND SURVIVAL')
    expect(matches.some((m) => m.type === 'SWIFT')).toBe(false)
  })

  it('still detects an all-letter 11-char BIC when a SWIFT/BIC label is present', () => {
    const matches = detectStructural('SWIFT: DEUTDEFFXXX')
    const swifts = matches.filter((m) => m.type === 'SWIFT')
    expect(swifts.some((m) => m.value === 'DEUTDEFFXXX')).toBe(true)
  })

  it('detects a labeled country-led address', () => {
    const text = 'Registered office address: Ruritania, Zenda, Central district, Rassendyll st. N 51 b. 121\n'
    const addrs = detectStructural(text).filter((m) => m.type === 'ADDRESS')
    expect(addrs).toHaveLength(1)
    expect(addrs[0].value).toBe('Ruritania, Zenda, Central district, Rassendyll st. N 51 b. 121')
    expect(text.slice(addrs[0].start, addrs[0].end)).toBe(addrs[0].value)
  })

  it('trims a labeled address at the next field keyword', () => {
    const matches = detectStructural('Business address: 12 Baker Street, London, company registration number 12345678')
    const addrs = matches.filter((m) => m.type === 'ADDRESS')
    expect(addrs).toHaveLength(1)
    expect(addrs[0].value).toBe('12 Baker Street, London')
  })

  it('ignores an address mentioned in prose without a colon', () => {
    const matches = detectStructural('the registered office address of the other Party shall prevail')
    expect(matches.some((m) => m.type === 'ADDRESS')).toBe(false)
  })

  it('does not treat an email-address label as a postal address', () => {
    const matches = detectStructural('Email address: john@acme.co')
    expect(matches.some((m) => m.type === 'ADDRESS')).toBe(false)
  })

  // C2: unlabeled US notice-block addresses (state-abbrev or full-name + ZIP).
  it('detects an unlabeled US address with a state abbreviation', () => {
    const text = 'Notices to: 3900 Freedom Circle, Suite # 200, Santa Clara, CA 95054\n'
    const addrs = detectStructural(text).filter((m) => m.type === 'ADDRESS')
    expect(addrs.some((a) => a.value === '3900 Freedom Circle, Suite # 200, Santa Clara, CA 95054')).toBe(true)
  })

  it('detects an unlabeled US address with a full state name', () => {
    const text = 'If to Sponsor: 2791 Loker Avenue West, Carlsbad, California 92008.'
    const addrs = detectStructural(text).filter((m) => m.type === 'ADDRESS')
    expect(addrs.some((a) => a.value === '2791 Loker Avenue West, Carlsbad, California 92008')).toBe(true)
  })

  it('detects a US address whose city and state are both "New York"', () => {
    const text = 'Attn: Legal, 22 East 71st Street, New York, New York 10021'
    const addrs = detectStructural(text).filter((m) => m.type === 'ADDRESS')
    expect(addrs.some((a) => a.value === '22 East 71st Street, New York, New York 10021')).toBe(true)
  })

  it('detects a US address with a ZIP+4 code', () => {
    const text = '11 Hurley Street, Cambridge, MA 02141-1234 end'
    const addrs = detectStructural(text).filter((m) => m.type === 'ADDRESS')
    expect(addrs.some((a) => a.value === '11 Hurley Street, Cambridge, MA 02141-1234')).toBe(true)
  })

  it('does not flag prose numbers as a US address without a state+ZIP tail', () => {
    const text = 'The Company shall deliver 5000 units, within 30 days of the order.'
    expect(detectStructural(text).some((m) => m.type === 'ADDRESS')).toBe(false)
  })

  // AUD-2.1: label-anchored contiguous-digit phones.
  it('detects a labeled contiguous-digit phone number ("Tel: ...")', () => {
    const matches = detectStructural('Tel: 0612345678 for support')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '0612345678')).toBe(true)
  })

  it('detects a labeled contiguous-digit phone number ("Phone #: ...")', () => {
    const matches = detectStructural('Phone #: 12025550123 for support')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '12025550123')).toBe(true)
  })

  it('does not treat a bare unlabeled contiguous number as a phone number', () => {
    const matches = detectStructural('Invoice No. 12025550123 is due')
    expect(matches.some((m) => m.type === 'PHONE')).toBe(false)
  })

  it('still detects a Hungarian-style separated phone number', () => {
    const matches = detectStructural('Call +36 1 234 5678 now')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '+36 1 234 5678')).toBe(true)
  })

  it('still detects a US-style parenthesized phone number', () => {
    const matches = detectStructural('Call (202) 555-0123 now')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '(202) 555-0123')).toBe(true)
  })

  it('still detects a UK-style separated phone number', () => {
    const matches = detectStructural('Call 20 7946 0958 now')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '20 7946 0958')).toBe(true)
  })

  it('still detects a plus-prefixed separated phone number', () => {
    const matches = detectStructural('Call +1 202 555 0123 now')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '+1 202 555 0123')).toBe(true)
  })

  it('keeps a labeled 3-3-3 grouped number as a phone despite thousands-like grouping', () => {
    const matches = detectStructural('Tel: 123 456 789 for support')
    const phones = matches.filter((m) => m.type === 'PHONE')
    expect(phones.some((m) => m.value === '123 456 789')).toBe(true)
  })

  // AUD-2.2: drop money-sum false positives from the separator pass.
  it('does not treat an unlabeled thousands-grouped number as a phone number', () => {
    const matches = detectStructural('Total items: 1 000 000 units')
    expect(matches.some((m) => m.type === 'PHONE' && m.value === '1 000 000')).toBe(false)
  })

  it('does not treat another unlabeled thousands-grouped number as a phone number', () => {
    const matches = detectStructural('Population: 12 345 678 people')
    expect(matches.some((m) => m.type === 'PHONE' && m.value === '12 345 678')).toBe(false)
  })

  it('does not treat a money amount with decimals as a phone number', () => {
    const matches = detectStructural('Total: 123 456 789.00 due')
    expect(matches.some((m) => m.type === 'PHONE')).toBe(false)
  })

  it('does not treat a euro-marked amount as a phone number', () => {
    const matches = detectStructural('Price: € 1 234 567 total')
    expect(matches.some((m) => m.type === 'PHONE')).toBe(false)
  })

  it('does not treat a USD-marked amount as a phone number', () => {
    const matches = detectStructural('Budget: USD 2 500 000 approved')
    expect(matches.some((m) => m.type === 'PHONE')).toBe(false)
  })
})
