import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./ner', () => ({
  detectEntitiesNer: vi.fn(),
}))

import { detectEntitiesNer } from './ner'
import { runSecondPass } from './secondPass'
import { buildAnonymizedText, buildAnonymizedTextWithMap, mapAnonRangeToSource } from './apply'
import type { Entity, RawMatch } from './types'

const mockedDetectEntitiesNer = vi.mocked(detectEntitiesNer)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildAnonymizedTextWithMap / mapAnonRangeToSource', () => {
  it('produces byte-identical text to buildAnonymizedText and maps verbatim ranges back, but not placeholder ranges', () => {
    const sourceText = 'Contact John Doe at the office.'
    const start = sourceText.indexOf('John Doe')
    const end = start + 'John Doe'.length
    const entities: Entity[] = [
      {
        id: '1',
        type: 'PERSON',
        value: 'John Doe',
        placeholder: '[PERSON_1]',
        positions: [{ start, end }],
        anonymize: true,
        manual: false,
      },
    ]

    const { text, segments } = buildAnonymizedTextWithMap(sourceText, entities)
    expect(text).toBe(buildAnonymizedText(sourceText, entities))

    // "office" lies in the trailing verbatim segment; it should map back cleanly.
    const officeOutStart = text.indexOf('office')
    const officeOutEnd = officeOutStart + 'office'.length
    const mappedBack = mapAnonRangeToSource(officeOutStart, officeOutEnd, segments)
    const officeSrcStart = sourceText.indexOf('office')
    expect(mappedBack).toEqual({ start: officeSrcStart, end: officeSrcStart + 'office'.length })

    // A range overlapping the placeholder itself cannot be mapped.
    const placeholderStart = text.indexOf('[PERSON_1]')
    const placeholderEnd = placeholderStart + '[PERSON_1]'.length
    expect(mapAnonRangeToSource(placeholderStart, placeholderEnd, segments)).toBeNull()
  })
})

describe('runSecondPass', () => {
  it('B2: finds a first-pass miss and maps it back to source offsets with a fresh placeholder', async () => {
    const sourceText = 'Acme Ltd trades as acme@acme.com. Contact Beta Corp today.'
    const companyValue = 'Acme Ltd'
    const companyStart = sourceText.indexOf(companyValue)
    const emailValue = 'acme@acme.com'
    const emailStart = sourceText.indexOf(emailValue)

    const entities: Entity[] = [
      {
        id: '1',
        type: 'COMPANY',
        value: companyValue,
        placeholder: '[COMPANY_1]',
        positions: [{ start: companyStart, end: companyStart + companyValue.length }],
        anonymize: true,
        manual: false,
      },
      {
        id: '2',
        type: 'EMAIL',
        value: emailValue,
        placeholder: '[EMAIL_1]',
        positions: [{ start: emailStart, end: emailStart + emailValue.length }],
        anonymize: true,
        manual: false,
      },
    ]

    const anon = buildAnonymizedText(sourceText, entities)
    expect(anon).toBe('[COMPANY_1] trades as [EMAIL_1]. Contact Beta Corp today.')

    const betaStart = anon.indexOf('Beta Corp')
    const nerMatches: RawMatch[] = [
      { type: 'COMPANY', value: 'Beta Corp', start: betaStart, end: betaStart + 'Beta Corp'.length },
    ]
    mockedDetectEntitiesNer.mockResolvedValueOnce(nerMatches)

    const found = await runSecondPass(sourceText, entities)

    expect(found).toHaveLength(1)
    const entity = found[0]
    expect(entity.type).toBe('COMPANY')
    expect(entity.value).toBe('Beta Corp')
    expect(entity.candidate).toBe(true)
    expect(entity.anonymize).toBe(false)
    expect(entity.candidateNote).toBe('Найдено на контрольном проходе')
    expect(entity.placeholder).toBe('[COMPANY_2]')
    expect(sourceText.slice(entity.positions[0].start, entity.positions[0].end)).toBe('Beta Corp')
  })

  it('B2: skips a NER match whose normalized value is already a known entity of the same type, even at a non-overlapping position', async () => {
    // "Acme Ltd" appears twice; the first pass only caught the first occurrence
    // (as a candidate, left verbatim — anonymize:false), so the second occurrence
    // stays in the clear in the anon text. The known-value dedup (not the
    // position-overlap guard) must be what suppresses it as a "miss".
    const sourceText = 'Acme Ltd trades as acme@acme.com. Also known as Acme Ltd internally.'
    const firstAcmeStart = sourceText.indexOf('Acme Ltd')
    const emailValue = 'acme@acme.com'
    const emailStart = sourceText.indexOf(emailValue)

    const entities: Entity[] = [
      {
        id: '1',
        type: 'COMPANY',
        value: 'Acme Ltd',
        placeholder: '[COMPANY_1]',
        positions: [{ start: firstAcmeStart, end: firstAcmeStart + 'Acme Ltd'.length }],
        anonymize: false,
        manual: false,
        candidate: true,
        candidateNote: 'test setup: known but not anonymized',
      },
      {
        id: '2',
        type: 'EMAIL',
        value: emailValue,
        placeholder: '[EMAIL_1]',
        positions: [{ start: emailStart, end: emailStart + emailValue.length }],
        anonymize: true,
        manual: false,
      },
    ]

    const anon = buildAnonymizedText(sourceText, entities)
    expect(anon).toBe('Acme Ltd trades as [EMAIL_1]. Also known as Acme Ltd internally.')

    // NER "finds" the SECOND occurrence, which does not overlap the known entity's position.
    const secondAcmeStart = anon.indexOf('Acme Ltd', anon.indexOf('Acme Ltd') + 1)
    const nerMatches: RawMatch[] = [
      { type: 'COMPANY', value: 'Acme Ltd', start: secondAcmeStart, end: secondAcmeStart + 'Acme Ltd'.length },
    ]
    mockedDetectEntitiesNer.mockResolvedValueOnce(nerMatches)

    const found = await runSecondPass(sourceText, entities)

    expect(found).toEqual([])
  })
})
