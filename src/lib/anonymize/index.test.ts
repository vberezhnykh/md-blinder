import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./ner', () => ({
  detectEntitiesNer: vi.fn(),
}))

import { detectEntitiesNer } from './ner'
import { anonymizeMarkdown } from './index'
import type { RawMatch } from './types'

const mockedDetectEntitiesNer = vi.mocked(detectEntitiesNer)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('anonymizeMarkdown', () => {
  it('merges duplicate NER matches into one entity and numbers types independently', async () => {
    const markdown = 'Acme Ltd pays Acme Ltd via john@x.com'
    const companyValue = 'Acme Ltd'
    const firstStart = markdown.indexOf(companyValue)
    const secondStart = markdown.indexOf(companyValue, firstStart + 1)
    const emailValue = 'john@x.com'

    const nerMatches: RawMatch[] = [
      { type: 'COMPANY', value: companyValue, start: firstStart, end: firstStart + companyValue.length },
      { type: 'COMPANY', value: companyValue, start: secondStart, end: secondStart + companyValue.length },
    ]
    mockedDetectEntitiesNer.mockResolvedValueOnce(nerMatches)

    const { result, nerFailed } = await anonymizeMarkdown(markdown)

    expect(nerFailed).toBe(false)

    const company = result.entities.find((e) => e.type === 'COMPANY')
    expect(company).toBeDefined()
    expect(company?.placeholder).toBe('[COMPANY_1]')
    expect(company?.positions).toHaveLength(2)

    const email = result.entities.find((e) => e.type === 'EMAIL')
    expect(email).toBeDefined()
    expect(email?.placeholder).toBe('[EMAIL_1]')
    expect(email?.value).toBe(emailValue)

    const companyOccurrences = result.markdown.split('[COMPANY_1]').length - 1
    const emailOccurrences = result.markdown.split('[EMAIL_1]').length - 1
    expect(companyOccurrences).toBe(2)
    expect(emailOccurrences).toBe(1)
  })

  it('lets a structural (regex) match win over an overlapping NER match', async () => {
    const markdown = 'mail john@x.com'
    const emailValue = 'john@x.com'
    const emailStart = markdown.indexOf(emailValue)

    const nerMatches: RawMatch[] = [
      { type: 'PERSON', value: emailValue, start: emailStart, end: emailStart + emailValue.length },
    ]
    mockedDetectEntitiesNer.mockResolvedValueOnce(nerMatches)

    const { result } = await anonymizeMarkdown(markdown)

    const overlapping = result.entities.filter((e) =>
      e.positions.some((p) => p.start < emailStart + emailValue.length && emailStart < p.end),
    )
    expect(overlapping).toHaveLength(1)
    expect(overlapping[0].type).toBe('EMAIL')
    expect(result.entities.some((e) => e.type === 'PERSON')).toBe(false)
  })

  it('still detects regex entities when NER fails', async () => {
    mockedDetectEntitiesNer.mockRejectedValueOnce(new Error('no worker'))
    const markdown = 'reach me at a@b.com'

    const { result, nerFailed } = await anonymizeMarkdown(markdown)

    expect(nerFailed).toBe(true)
    const email = result.entities.find((e) => e.type === 'EMAIL')
    expect(email).toBeDefined()
    expect(email?.value).toBe('a@b.com')
    expect(result.markdown).toContain('[EMAIL_1]')
  })

  it('detects a full CNPJ as REG_NUMBER and prevents a truncated PHONE match', async () => {
    mockedDetectEntitiesNer.mockResolvedValueOnce([])
    const markdown = 'Registered under CNPJ 53.200.745/0001-60 in Brazil'

    const { result } = await anonymizeMarkdown(markdown)

    const regNumber = result.entities.find((e) => e.type === 'REG_NUMBER')
    expect(regNumber).toBeDefined()
    expect(regNumber?.value).toBe('53.200.745/0001-60')

    expect(result.entities.some((e) => e.type === 'PHONE')).toBe(false)

    expect(result.markdown).toContain('[REG_NUMBER_1]')
    expect(result.markdown).not.toContain('53.200.745')
  })

  it('filters out generic role-noun NER matches while keeping real entities', async () => {
    const markdown = 'The Director shall notify Acme Ltd of any change.'
    const directorValue = 'Director'
    const directorStart = markdown.indexOf(directorValue)
    const companyValue = 'Acme Ltd'
    const companyStart = markdown.indexOf(companyValue)

    const nerMatches: RawMatch[] = [
      { type: 'PERSON', value: directorValue, start: directorStart, end: directorStart + directorValue.length },
      { type: 'COMPANY', value: companyValue, start: companyStart, end: companyStart + companyValue.length },
    ]
    mockedDetectEntitiesNer.mockResolvedValueOnce(nerMatches)

    const { result } = await anonymizeMarkdown(markdown)

    expect(
      result.entities.some((e) => e.type === 'PERSON' && e.value.toLowerCase() === 'director'),
    ).toBe(false)

    const company = result.entities.find((e) => e.type === 'COMPANY')
    expect(company).toBeDefined()
    expect(company?.value).toBe(companyValue)
  })

  it('B1: a NER match at confirm-level score becomes a confirmed entity in the output', async () => {
    const markdown = 'Meeting with Ann Baker tomorrow.'
    const value = 'Ann Baker'
    const start = markdown.indexOf(value)

    const nerMatches: RawMatch[] = [
      { type: 'PERSON', value, start, end: start + value.length, score: 0.4 },
    ]
    mockedDetectEntitiesNer.mockResolvedValueOnce(nerMatches)

    const { result } = await anonymizeMarkdown(markdown)

    const person = result.entities.find((e) => e.type === 'PERSON' && e.value === value)
    expect(person).toBeDefined()
    expect(person?.candidate).toBeFalsy()
    expect(person?.anonymize).toBe(true)
    expect(result.markdown).toContain(person!.placeholder)
  })

  it('B1: a NER match below the confirm threshold becomes a gray-zone candidate, excluded from the output', async () => {
    const markdown = 'Perhaps Cy Vance was mentioned.'
    const value = 'Cy Vance'
    const start = markdown.indexOf(value)

    const nerMatches: RawMatch[] = [
      { type: 'PERSON', value, start, end: start + value.length, score: 0.2 },
    ]
    mockedDetectEntitiesNer.mockResolvedValueOnce(nerMatches)

    const { result } = await anonymizeMarkdown(markdown)

    const person = result.entities.find((e) => e.type === 'PERSON' && e.value === value)
    expect(person).toBeDefined()
    expect(person?.candidate).toBe(true)
    expect(person?.anonymize).toBe(false)
    expect(result.markdown).not.toContain(person!.placeholder)
  })

  it('B1: confirmed entities are numbered before gray-zone candidates of the same type', async () => {
    const markdown = 'Signed by Tom Reed. Possibly Sam Kerr too.'
    const confirmedValue = 'Tom Reed'
    const candidateValue = 'Sam Kerr'
    const confirmedStart = markdown.indexOf(confirmedValue)
    const candidateStart = markdown.indexOf(candidateValue)

    const nerMatches: RawMatch[] = [
      { type: 'PERSON', value: confirmedValue, start: confirmedStart, end: confirmedStart + confirmedValue.length, score: 0.5 },
      { type: 'PERSON', value: candidateValue, start: candidateStart, end: candidateStart + candidateValue.length, score: 0.2 },
    ]
    mockedDetectEntitiesNer.mockResolvedValueOnce(nerMatches)

    const { result } = await anonymizeMarkdown(markdown)

    const confirmed = result.entities.find((e) => e.value === confirmedValue)
    const candidate = result.entities.find((e) => e.value === candidateValue)
    expect(confirmed?.placeholder).toBe('[PERSON_1]')
    expect(candidate?.placeholder).toBe('[PERSON_2]')
    expect(candidate?.candidate).toBe(true)
  })

  // Паспорт «4506 123456» подходит и под телефонный паттерн (11 цифр с
  // разделителем). Оба матча структурные и начинаются в одной позиции, поэтому
  // исход решает правило «при равном start побеждает длинный спан» в
  // resolveOverlaps — телефон захватывает на цифру меньше. Тест сторожит именно
  // это, а не сам факт детекции паспорта.
  it('resolves a Russian passport against the phone detector in favour of PASSPORT', async () => {
    const markdown = 'Иванов И.И., паспорт 4506 123456, проживает в Москве'
    mockedDetectEntitiesNer.mockResolvedValueOnce([])

    const { result } = await anonymizeMarkdown(markdown)

    const passport = result.entities.find((e) => e.type === 'PASSPORT')
    expect(passport?.value).toBe('4506 123456')
    expect(result.entities.some((e) => e.type === 'PHONE')).toBe(false)
    expect(result.markdown).toContain('[PASSPORT_1]')
    expect(result.markdown).not.toContain('4506 123456')
  })

  it('numbers and substitutes SNILS, passport and website entities', async () => {
    const markdown = 'СНИЛС 123-456-789 01, паспорт 4506 123456, сайт https://acme-legal.ru'
    mockedDetectEntitiesNer.mockResolvedValueOnce([])

    const { result } = await anonymizeMarkdown(markdown)

    // СНИЛС размечается как REG_NUMBER — в одном ряду с ИНН физлица и РНОКПП.
    const snils = result.entities.find((e) => e.value === '123-456-789 01')
    expect(snils?.type).toBe('REG_NUMBER')

    expect(result.entities.find((e) => e.type === 'URL')?.placeholder).toBe('[URL_1]')
    expect(result.markdown).toBe(
      'СНИЛС [REG_NUMBER_1], паспорт [PASSPORT_1], сайт [URL_1]',
    )
  })

  // Разные записи одного адреса должны схлопываться в одну сущность, иначе в
  // таблице замен окажутся [URL_1] и [URL_2] на один и тот же сайт.
  it('groups scheme, www and bare spellings of one host into a single URL entity', async () => {
    const markdown = 'Публикуется на https://example.com, зеркало www.example.com, кратко example.com'
    mockedDetectEntitiesNer.mockResolvedValueOnce([])

    const { result } = await anonymizeMarkdown(markdown)

    const urls = result.entities.filter((e) => e.type === 'URL')
    expect(urls).toHaveLength(1)
    expect(urls[0].positions).toHaveLength(3)
  })
})
