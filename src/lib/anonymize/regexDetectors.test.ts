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

  // C2: multi-line notice-block addresses — street line and "City, ST ZIP" line
  // split across newlines (and table-separator noise). norm() collapses the
  // separators, so the messy span still matches the clean gold value.
  const normAddr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  it('detects a US address split as "street\\nCity, ST ZIP"', () => {
    const text = 'Notices to:\n1300 Oakside Circle\nChanhassen, MN 55317\n12.8 Fees.'
    const addrs = detectStructural(text).filter((m) => m.type === 'ADDRESS')
    expect(addrs.some((a) => normAddr(a.value) === '1300 oakside circle chanhassen mn 55317')).toBe(true)
  })

  it('detects a US address split across a table-separator row', () => {
    const text = 'Address:\n11 Hurley Street\n\n--------------------------- Cambridge, MA 02141\nTel'
    const addrs = detectStructural(text).filter((m) => m.type === 'ADDRESS')
    expect(addrs.some((a) => normAddr(a.value) === '11 hurley street cambridge ma 02141')).toBe(true)
  })

  it('detects a US address split by a blank line with a full state name', () => {
    const text = '2791 Loker Avenue West\n\nCarlsbad, California 92008 Telephone: (619) 438-6611'
    const addrs = detectStructural(text).filter((m) => m.type === 'ADDRESS')
    expect(addrs.some((a) => normAddr(a.value) === '2791 loker avenue west carlsbad california 92008')).toBe(true)
  })

  it('does not multi-line-join a non-street number line into an address', () => {
    const text = '500 units\nDelivered to Boston, MA 02101 promptly'
    expect(detectStructural(text).some((m) => m.type === 'ADDRESS')).toBe(false)
  })

  it('bounds a labeled address at a docx table cell boundary (<br>) and keeps the phone', () => {
    const text = 'Business address: Avenida Paulista, No. 1912, São Paulo<br>Phone #: 55 11 96074-1591<br>Fernando'
    const matches = detectStructural(text)
    const addrs = matches.filter((m) => m.type === 'ADDRESS')
    // Address stops at the <br>, not swallowing the whole row.
    expect(addrs.some((a) => a.value === 'Avenida Paulista, No. 1912, São Paulo')).toBe(true)
    expect(addrs.some((a) => a.value.includes('96074'))).toBe(false)
    // The phone survives (it is no longer inside the ADDRESS span).
    expect(matches.some((m) => m.type === 'PHONE' && m.value === '55 11 96074-1591')).toBe(true)
  })

  it('bounds a labeled address at an underscore signature run', () => {
    const text = 'Address: 12 Baker Street, London\\_\\_\\_\\_\\_\\_ John Smith'
    const addrs = detectStructural(text).filter((m) => m.type === 'ADDRESS')
    expect(addrs.some((a) => a.value === '12 Baker Street, London')).toBe(true)
  })

  it('recovers a multi-line address behind a doubled "Address: Address:" label', () => {
    const text = 'Address: Address: 11 Hurley Street\n\n--------------------------- Cambridge, MA 02141\n\nTel'
    const addrs = detectStructural(text).filter((m) => m.type === 'ADDRESS')
    // The full address wins; no truncated "Address: 11 Hurley Street" fragment survives.
    expect(addrs.some((a) => normAddr(a.value) === '11 hurley street cambridge ma 02141')).toBe(true)
    expect(addrs.some((a) => /^address/i.test(a.value.trim()))).toBe(false)
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

  // Stage 2 (русские структурные детекторы): ИНН/ОГРН(ИП)/КПП и р/с, к/с.
  describe('russian ids and accounts', () => {
    it('detects a 10-digit INN', () => {
      const matches = detectStructural('ИНН 7736324582')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '7736324582')).toBe(true)
    })

    it('detects a 12-digit INN (individual/IP)', () => {
      const matches = detectStructural('ИНН 500100732259')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '500100732259')).toBe(true)
    })

    it('detects a 13-digit OGRN', () => {
      const matches = detectStructural('ОГРН 1197746606232')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '1197746606232')).toBe(true)
    })

    it('detects a 15-digit OGRNIP', () => {
      const matches = detectStructural('ОГРНИП 315237500002317')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '315237500002317')).toBe(true)
    })

    it('detects a 9-digit KPP', () => {
      const matches = detectStructural('КПП 773601001')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '773601001')).toBe(true)
    })

    it('splits an INN glued directly to the following KPP label into two matches', () => {
      const matches = detectStructural('ИНН 7736363158КПП 773601001')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '7736363158')).toBe(true)
      expect(regNumbers.some((m) => m.value === '773601001')).toBe(true)
    })

    it('detects a combined "ИНН / КПП" form as two matches without duplicating KPP', () => {
      const matches = detectStructural('ИНН / КПП 7736321479 / 773601001')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers).toHaveLength(2)
      expect(regNumbers.some((m) => m.value === '7736321479')).toBe(true)
      expect(regNumbers.some((m) => m.value === '773601001')).toBe(true)
    })

    // Регрессия: ИНН — строго 10 (юрлицо) или 12 (физлицо/ИП) цифр, 11-значного
    // числа не существует. Комбинированный паттерн раньше брал `\d{10,12}`, что
    // жадно ловило 11 цифр как валидный ИНН. Закрепляем фактическое поведение
    // после фикса: 11-значное число не матчится как ИНН комбинированной формой.
    it('does not treat an 11-digit number as INN in the combined "ИНН / КПП" form', () => {
      const matches = detectStructural('ИНН / КПП 12345678901 / 773601001')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '12345678901')).toBe(false)
      expect(regNumbers.some((m) => m.value.length === 11)).toBe(false)
    })

    it('detects a "р/с" account number (20 digits)', () => {
      const matches = detectStructural('р/с 40702810338000246070')
      const accounts = matches.filter((m) => m.type === 'ACCOUNT')
      expect(accounts.some((m) => m.value === '40702810338000246070')).toBe(true)
    })

    it('detects a "к/с" account number (20 digits)', () => {
      const matches = detectStructural('к/с 30101810400000000225')
      const accounts = matches.filter((m) => m.type === 'ACCOUNT')
      expect(accounts.some((m) => m.value === '30101810400000000225')).toBe(true)
    })

    it('detects a Russian-format phone number', () => {
      const matches = detectStructural('Телефон: +7 (903) 796-17-03')
      const phones = matches.filter((m) => m.type === 'PHONE')
      expect(phones.some((m) => m.value.includes('903') && m.value.includes('796-17-03'))).toBe(true)
    })

    it('reports exact offsets for a plain INN match', () => {
      const text = 'ИНН 7736324582'
      const matches = detectStructural(text)
      const inn = matches.find((m) => m.type === 'REG_NUMBER' && m.value === '7736324582')
      expect(inn).toBeDefined()
      expect(text.slice(inn!.start, inn!.end)).toBe('7736324582')
    })

    it('does not treat a BIK as a REG_NUMBER or ACCOUNT', () => {
      const matches = detectStructural('БИК 044525225')
      expect(matches.some((m) => (m.type === 'REG_NUMBER' || m.type === 'ACCOUNT') && m.value === '044525225')).toBe(false)
    })

    it('does not swallow a cadastral number as a REG_NUMBER', () => {
      const matches = detectStructural('77:06:0002019:1128-77/005/2020-12')
      expect(matches.some((m) => m.type === 'REG_NUMBER' && m.value.includes('77:06:0002019:1128'))).toBe(false)
    })
  })

  // Украинские структурные идентификаторы: ЄДРПОУ (8 цифр), ІПН/РНОКПП (10 цифр).
  describe('ukrainian ids', () => {
    it('detects an 8-digit YEDRPOU', () => {
      const matches = detectStructural('ЄДРПОУ 12345678')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '12345678')).toBe(true)
    })

    it('detects YEDRPOU with the "код за ЄДРПОУ" prefix', () => {
      const matches = detectStructural('код за ЄДРПОУ 12345678')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '12345678')).toBe(true)
    })

    it('detects a 10-digit IPN', () => {
      const matches = detectStructural('ІПН 1234567890')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '1234567890')).toBe(true)
    })

    it('detects a 10-digit RNOKPP', () => {
      const matches = detectStructural('РНОКПП 1234567890')
      const regNumbers = matches.filter((m) => m.type === 'REG_NUMBER')
      expect(regNumbers.some((m) => m.value === '1234567890')).toBe(true)
    })

    it('reports exact offsets for a YEDRPOU match', () => {
      const text = 'ЄДРПОУ 12345678'
      const matches = detectStructural(text)
      const reg = matches.find((m) => m.type === 'REG_NUMBER' && m.value === '12345678')
      expect(reg).toBeDefined()
      expect(text.slice(reg!.start, reg!.end)).toBe('12345678')
    })

    it('reports exact offsets for an IPN match', () => {
      const text = 'ІПН 1234567890'
      const matches = detectStructural(text)
      const reg = matches.find((m) => m.type === 'REG_NUMBER' && m.value === '1234567890')
      expect(reg).toBeDefined()
      expect(text.slice(reg!.start, reg!.end)).toBe('1234567890')
    })

    it('does not emit a REG_NUMBER for a bare "ЄДРПОУ" label without a number', () => {
      const matches = detectStructural('Код ЄДРПОУ додається окремим листом.')
      expect(matches.some((m) => m.type === 'REG_NUMBER')).toBe(false)
    })

    it('does not treat a random 8-digit number without a label as YEDRPOU', () => {
      const matches = detectStructural('Номер накладної 12345678 від учора')
      expect(matches.some((m) => m.type === 'REG_NUMBER' && m.value === '12345678')).toBe(false)
    })
  })

  describe('russian and ukrainian address labels', () => {
    const addresses = (text: string) =>
      detectStructural(text).filter((m) => m.type === 'ADDRESS').map((m) => m.value)

    it('detects a value after a bare "Адрес:" label', () => {
      expect(addresses('Адрес: г. Москва, ул. Тверская, д. 1, кв. 5')).toEqual([
        'г. Москва, ул. Тверская, д. 1, кв. 5',
      ])
    })

    it('detects qualified noun labels', () => {
      expect(addresses('Юридический адрес: 125009, г. Москва, ул. Тверская, д. 1')).toEqual([
        '125009, г. Москва, ул. Тверская, д. 1',
      ])
      expect(addresses('Фактический адрес: 125009, г. Москва, ул. Тверская, д. 1')).toEqual([
        '125009, г. Москва, ул. Тверская, д. 1',
      ])
      expect(addresses('Адрес регистрации: г. Казань, ул. Баумана, д. 7')).toEqual([
        'г. Казань, ул. Баумана, д. 7',
      ])
    })

    // Фразовая метка — единственная, где двоеточие необязательно: после «по
    // адресу» всегда идёт адрес, в договорах двоеточия там обычно нет.
    it('detects a phrase label with and without a colon', () => {
      expect(addresses('Зарегистрирован по адресу: г. Москва, ул. Тверская, д. 1')).toEqual([
        'г. Москва, ул. Тверская, д. 1',
      ])
      expect(addresses('проживающий по адресу г. Москва, ул. Тверская, д. 1')).toEqual([
        'г. Москва, ул. Тверская, д. 1',
      ])
    })

    it('detects Ukrainian labels', () => {
      expect(addresses('Юридична адреса: м. Київ, вул. Хрещатик, буд. 1')).toEqual([
        'м. Київ, вул. Хрещатик, буд. 1',
      ])
      expect(addresses('зареєстрований за адресою м. Київ, вул. Хрещатик, буд. 1')).toEqual([
        'м. Київ, вул. Хрещатик, буд. 1',
      ])
    })

    it('detects "место нахождения" and "местонахождение"', () => {
      expect(addresses('Место нахождения: г. Москва, ул. Тверская, д. 1')).toEqual([
        'г. Москва, ул. Тверская, д. 1',
      ])
    })

    it('trims the value at the next requisites field', () => {
      expect(addresses('Адрес: г. Москва, ул. Тверская, д. 1, ИНН 7712345678')).toEqual([
        'г. Москва, ул. Тверская, д. 1',
      ])
      expect(addresses('Адрес: г. Москва, ул. Тверская, д. 1, тел. +7 495 1234567')).toEqual([
        'г. Москва, ул. Тверская, д. 1',
      ])
      expect(addresses('Адрес: г. Москва, ул. Тверская, д. 1, в лице директора')).toEqual([
        'г. Москва, ул. Тверская, д. 1',
      ])
    })

    // Та же защита, что у английской ветки: без двоеточия именная метка в прозе
    // не должна превращать половину предложения в адрес.
    it('ignores a noun label used in prose without a colon', () => {
      expect(addresses('Юридический адрес Стороны определяется приложением № 1 к договору')).toEqual([])
    })

    it('does not treat an electronic address label as a postal one', () => {
      expect(addresses('Электронный адрес: ivanov@acme.ru')).toEqual([])
      expect(addresses('Адрес электронной почты: ivanov@acme.ru')).toEqual([])
    })

    // Идентификатор часто вводится словом «код», и без этого обрезка не
    // срабатывала: адрес проглатывал номер вместе с его типом, потому что
    // ADDRESS перебивает REG_NUMBER в resolveOverlaps.
    it('trims before an identifier introduced by "код за"', () => {
      const text = 'Юридична адреса: м. Київ, вул. Хрещатик, буд. 1, код за ЄДРПОУ 12345678'
      expect(addresses(text)).toEqual(['м. Київ, вул. Хрещатик, буд. 1'])
      expect(
        detectStructural(text).some((m) => m.type === 'REG_NUMBER' && m.value === '12345678'),
      ).toBe(true)
    })

    it('drops a trailing requisites separator from the value', () => {
      expect(addresses('Адрес: г. Казань, ул. Баумана, д. 7, кв. 12,\nСНИЛС 123-456-789 01')).toEqual([
        'г. Казань, ул. Баумана, д. 7, кв. 12',
      ])
    })

    it('reports exact offsets', () => {
      const text = 'Сторона, зарегистрирован по адресу: г. Москва, ул. Тверская, д. 1\n'
      const m = detectStructural(text).find((x) => x.type === 'ADDRESS')
      expect(m).toBeDefined()
      expect(text.slice(m!.start, m!.end)).toBe('г. Москва, ул. Тверская, д. 1')
    })
  })

  describe('snils', () => {
    const snils = (text: string) =>
      detectStructural(text).filter((m) => m.type === 'REG_NUMBER')

    it('detects a canonical SNILS after its label', () => {
      expect(snils('СНИЛС 123-456-789 01').map((m) => m.value)).toContain('123-456-789 01')
    })

    it('detects a run-together SNILS after its label', () => {
      expect(snils('СНИЛС: 12345678901').map((m) => m.value)).toContain('12345678901')
    })

    it('detects the hyphenated format without a label', () => {
      expect(snils('123-456-789 01').map((m) => m.value)).toContain('123-456-789 01')
    })

    it('does not claim a bare 11-digit number as SNILS', () => {
      expect(snils('Инвентарный 12345678901').some((m) => m.value === '12345678901')).toBe(false)
    })

    // Без этого СНИЛС и телефон дают совпадающие спаны, и победитель зависел бы
    // от порядка элементов в массиве, а не от правила.
    it('is not also claimed by the phone detector', () => {
      const matches = detectStructural('СНИЛС 123-456-789 01')
      expect(matches.some((m) => m.type === 'PHONE')).toBe(false)
    })

    it('reports exact offsets', () => {
      const text = 'Работник, СНИЛС 123-456-789 01, принят'
      const m = snils(text).find((x) => x.value === '123-456-789 01')
      expect(m).toBeDefined()
      expect(text.slice(m!.start, m!.end)).toBe('123-456-789 01')
    })
  })

  describe('identity documents', () => {
    const ids = (text: string) =>
      detectStructural(text).filter((m) => m.type === 'ID_DOC').map((m) => m.value)

    it('detects a Russian passport written as one run', () => {
      expect(ids('Паспорт 4506 123456')).toEqual(['4506 123456'])
    })

    it('detects a Russian passport with a split series', () => {
      expect(ids('паспорт 45 06 123456')).toEqual(['45 06 123456'])
    })

    // Слово «номер» между группами остаётся в тексте: под плейсхолдер уходят
    // только сами цифры, двумя отдельными спанами.
    it('emits series and number separately when a word separates them', () => {
      expect(ids('Паспорт серия 4506 номер 123456')).toEqual(['4506', '123456'])
    })

    it('detects an English-labelled passport with a letter series', () => {
      expect(ids('Passport No. AB1234567')).toEqual(['AB1234567'])
    })

    it('detects a Ukrainian passport with a Cyrillic letter series', () => {
      expect(ids('Паспорт АВ 123456')).toEqual(['АВ 123456'])
    })

    it('detects a hyphenated number as a single span', () => {
      expect(ids('Паспорт 4506-123456')).toEqual(['4506-123456'])
    })

    it('does not swallow the issuing date and authority', () => {
      expect(ids('Паспорт 4506 123456, выдан 12.05.2010 ОВД Москвы')).toEqual(['4506 123456'])
    })

    // Документ, удостоверяющий личность, — не только паспорт: набор зависит от
    // гражданства и статуса стороны.
    it('detects a Russian driving licence', () => {
      expect(ids('Водительское удостоверение 77 12 345678')).toEqual(['77 12 345678'])
      expect(ids('водительские права 7712345678')).toEqual(['7712345678'])
    })

    it('detects an English driving licence with an alphanumeric number', () => {
      expect(ids("Driver's licence SMITH751125AB9CD")).toEqual(['SMITH751125AB9CD'])
    })

    it('detects a residence permit', () => {
      expect(ids('ВНЖ 82 1234567')).toEqual(['82 1234567'])
      expect(ids('вид на жительство № 1234567')).toEqual(['1234567'])
      expect(ids('Residence permit AB1234567')).toEqual(['AB1234567'])
    })

    it('detects a temporary residence permit and an ID card', () => {
      expect(ids('РВП 1234567')).toEqual(['1234567'])
      expect(ids('ID-картка 123456789')).toEqual(['123456789'])
    })

    it('detects a Russian military ID', () => {
      expect(ids('Военный билет АА 1234567')).toEqual(['АА 1234567'])
    })

    // «Права» и «удостоверение» сами по себе стоят в каждом договоре — метка
    // засчитывается только с определением.
    it('does not fire on the bare words "права" or "удостоверение"', () => {
      expect(ids('Права и обязанности сторон 1234567 определены разделом 5')).toEqual([])
      expect(ids('Удостоверение 1234567 приложено')).toEqual([])
    })

    // «Паспорт сделки» — валютный контроль, не документ человека. Отсекается
    // самим построением: сразу после метки идёт слово, а не цифры.
    it('ignores a currency-control "паспорт сделки"', () => {
      expect(ids('Паспорт сделки № 12/34567890 от 01.02.2020')).toEqual([])
    })

    it('ignores a technical passport of equipment', () => {
      expect(ids('Технический паспорт 1234567 на оборудование')).toEqual([])
    })

    it('ignores a cadastral passport', () => {
      expect(ids('Кадастровый паспорт 7712345678 помещения')).toEqual([])
    })

    it('ignores a label with no plausible number after it', () => {
      expect(ids('Паспорт № 5 приложен к делу')).toEqual([])
      expect(ids('Паспорт предъявлен при подписании')).toEqual([])
    })

    it('detects the issuing subdivision code', () => {
      expect(ids('код подразделения 770-053')).toEqual(['770-053'])
    })

    // Метка соседнего поля коротка и заглавна, то есть неотличима от буквенной
    // серии: «…, ІПН 123456789012» разбиралось как второй номер того же
    // документа с серией «ІПН».
    it('stops at the label of the next requisites field', () => {
      expect(ids('Паспорт АВ 123456, ІПН 123456789012')).toEqual(['АВ 123456'])
      expect(ids('ВНЖ 82 1234567, РВП 1234567')).toEqual(['82 1234567', '1234567'])
    })

    it('does not read a following field label as a series when the number is missing', () => {
      expect(ids('Паспорт предъявлен, ИНН 771234567890')).toEqual([])
    })

    it('leaves the neighbouring identifier to its own detector', () => {
      const matches = detectStructural('Паспорт АВ 123456, ІПН 123456789012')
      expect(matches.some((m) => m.type === 'REG_NUMBER' && m.value === '123456789012')).toBe(true)
    })

    it('reports exact offsets', () => {
      const text = 'Стороны: Иванов И.И., паспорт 4506 123456, действует лично'
      const m = detectStructural(text).find((x) => x.type === 'ID_DOC')
      expect(m).toBeDefined()
      expect(text.slice(m!.start, m!.end)).toBe('4506 123456')
    })
  })

  describe('websites', () => {
    const urls = (text: string) =>
      detectStructural(text).filter((m) => m.type === 'URL').map((m) => m.value)

    it('detects a full URL with a scheme', () => {
      expect(urls('Подробности на https://example.com/terms/v2')).toEqual([
        'https://example.com/terms/v2',
      ])
    })

    it('detects a www-prefixed host', () => {
      expect(urls('Сайт www.example.co.uk работает круглосуточно')).toContain('www.example.co.uk')
    })

    it('detects a labelled bare domain', () => {
      expect(urls('Сайт: example.com')).toEqual(['example.com'])
    })

    it('detects a bare lowercase domain', () => {
      expect(urls('Реквизиты опубликованы на acme-legal.ru')).toEqual(['acme-legal.ru'])
    })

    it('strips trailing sentence punctuation', () => {
      expect(urls('Смотрите example.com.')).toEqual(['example.com'])
    })

    it('does not take a URL out of a markdown link target', () => {
      expect(urls('[Сайт](https://example.com)')).toEqual(['https://example.com'])
    })

    // Регистр — единственное, что отличает голый домен от сокращения с точкой.
    it('does not treat a capitalised abbreviation as a domain', () => {
      expect(urls('Acme Ltd.Co подписало договор')).toEqual([])
    })

    it('does not treat a filename as a domain', () => {
      expect(urls('См. приложение contract.doc и akt.pdf')).toEqual([])
    })

    it('does not carve a domain out of an email address', () => {
      expect(urls('Контакт john.doe@example.com')).toEqual([])
    })

    it('reports exact offsets', () => {
      const text = 'Оферта размещена на https://example.com/offer и действует бессрочно'
      const m = detectStructural(text).find((x) => x.type === 'URL')
      expect(m).toBeDefined()
      expect(text.slice(m!.start, m!.end)).toBe('https://example.com/offer')
    })
  })
})
