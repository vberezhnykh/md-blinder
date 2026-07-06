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
    const markdown = 'Registered under CNPJ 00.000.000/0000-00 in Brazil'

    const { result } = await anonymizeMarkdown(markdown)

    const regNumber = result.entities.find((e) => e.type === 'REG_NUMBER')
    expect(regNumber).toBeDefined()
    expect(regNumber?.value).toBe('00.000.000/0000-00')

    expect(result.entities.some((e) => e.type === 'PHONE')).toBe(false)

    expect(result.markdown).toContain('[REG_NUMBER_1]')
    expect(result.markdown).not.toContain('00.000.000')
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
})
