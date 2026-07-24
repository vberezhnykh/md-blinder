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

  it('trims a leading generic wrapper from a REG_NUMBER, keeping the number with adjusted offsets', () => {
    const cases: [string, string][] = [
      ['registration number 193394577', '193394577'],
      ['Company registration no. 193394577', '193394577'],
      ['VAT No. GB123456789', 'GB123456789'],
    ]
    for (const [value, number] of cases) {
      const result = filterGenericNerMatches([match('REG_NUMBER', value)])
      expect(result).toHaveLength(1)
      expect(result[0].value).toBe(number)
      // start сдвинут на длину обёртки, end остался прежним → спан = сам номер.
      expect(result[0].start).toBe(value.length - number.length)
      expect(result[0].end).toBe(value.length)
    }
  })

  it('leaves a wrapper-less REG_NUMBER untouched', () => {
    const result = filterGenericNerMatches([match('REG_NUMBER', 'HU12345678')])
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe('HU12345678')
    expect(result[0].start).toBe(0)
  })

  it('still drops a pure generic reg-number wrapper with no number', () => {
    const dropped = ['registration number', 'company number']
    const result = filterGenericNerMatches(dropped.map((v) => match('REG_NUMBER', v)))
    expect(result).toHaveLength(0)
  })

  it('drops generic PERSON phrases built from participial/adjective modifiers', () => {
    const dropped = ['permitted subcontractors', 'Impacted Party', 'natural person']
    const matches = dropped.map((v) => match('PERSON', v))
    const result = filterGenericNerMatches(matches)
    for (const v of dropped) {
      expect(result.some((m) => m.value === v)).toBe(false)
    }
  })

  // Ролевые термины договора ("Contributor", "the Contributor", "undersigned
  // contributor") GLiNER тегает как PERSON — это определения ролей, не PII.
  it('drops "contributor" role/defined terms tagged as PERSON', () => {
    const dropped = ['Contributor', 'the Contributor', 'undersigned contributor']
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

// Этап 3: русский словарь ролевых/родовых терминов договора. Мультиязычная
// NER-модель тегает русские ролевые термины ("Заказчик", "Сторона", "третьи
// лица", "порядковый номер", "адрес электронной почты") так же уверенно
// (0.8-0.95), как английские "Client"/"Party" — это не PII.
describe('filterGenericNerMatches (RU)', () => {
  it('drops RU role-noun PERSON matches', () => {
    const dropped = [
      'Заказчик',
      'Заказчика',
      'Заказчику',
      'Заказчиком',
      'Исполнитель',
      'Исполнителя',
      'Сторона',
      'Стороны',
      'Сторонами',
      'третьи лица',
      'третьих лиц',
      'уполномоченного представителя Стороны',
      'Виновная Сторона',
      'должностным лицам',
      'аффилированных лиц',
      'ФИО',
      'работники',
      'представителей',
      'Арендатор',
      'Субарендатор',
    ]
    const matches = dropped.map((v) => match('PERSON', v))
    const result = filterGenericNerMatches(matches)
    for (const v of dropped) {
      expect(result.some((m) => m.value === v)).toBe(false)
    }
  })

  it('drops RU role-noun COMPANY matches', () => {
    const dropped = ['Заказчик', 'Сторонами', 'Общество с ограниченной ответственностью']
    const matches = dropped.map((v) => match('COMPANY', v))
    const result = filterGenericNerMatches(matches)
    for (const v of dropped) {
      expect(result.some((m) => m.value === v)).toBe(false)
    }
  })

  it('drops generic RU REG_NUMBER phrases without digits', () => {
    const dropped = ['порядковый номер', 'регистрационный номер']
    const matches = dropped.map((v) => match('REG_NUMBER', v))
    const result = filterGenericNerMatches(matches)
    for (const v of dropped) {
      expect(result.some((m) => m.value === v)).toBe(false)
    }
  })

  it('drops generic RU ADDRESS phrases without digits', () => {
    const dropped = ['адрес электронной почты', 'юридический адрес', 'адрес местонахождения']
    const matches = dropped.map((v) => match('ADDRESS', v))
    const result = filterGenericNerMatches(matches)
    for (const v of dropped) {
      expect(result.some((m) => m.value === v)).toBe(false)
    }
  })

  // Регрессия recall: настоящие ФИО не должны отбрасываться, даже если
  // содержат слоги, похожие на родовые корни.
  it('keeps real RU PERSON names', () => {
    const kept = [
      'Окишев Алексей Александрович',
      'Столяров Валентин Михайлович',
      'Галенко Сергей Николаевич',
      'Цой Алексей',
      'Сергей Сущевский',
      'Иван Петров',
    ]
    const result = filterGenericNerMatches(kept.map((v) => match('PERSON', v)))
    expect(result).toHaveLength(kept.length)
  })

  // Регрессия recall: настоящие названия компаний (в т.ч. смешанные RU/EN)
  // не должны отбрасываться.
  it('keeps real RU/EN COMPANY names', () => {
    const kept = [
      'ООО «Когнитек»',
      'ООО «Бифорком Текнолоджис»',
      'ООО «Коммуникации технологии менеджмент»',
      'Ling Trade Limited',
      'Acme Ltd',
    ]
    const result = filterGenericNerMatches(kept.map((v) => match('COMPANY', v)))
    expect(result).toHaveLength(kept.length)
  })
})
