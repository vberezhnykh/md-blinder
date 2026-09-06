import { describe, it, expect } from 'vitest'
import { scoreDetections, scoreOccurrenceCoverage } from './scoring-core.mjs'

function statusOf(results, value) {
  return results.find((r) => r.gold.value === value)?.status
}

describe('scoreDetections', () => {
  it('ANCHOR: matches a declined (genitive) form via position overlap, ignoring morphology', () => {
    const sourceText = 'Договор подписан со стороны директора Цоя Алексея на условиях, указанных ниже.'
    const anchorText = 'Цоя Алексея'
    const start = sourceText.indexOf(anchorText)
    const gold = [{ type: 'PERSON', value: 'Цой Алексей', variants: ['Цоя Алексея'] }]
    const detected = [
      {
        type: 'PERSON',
        value: 'Цоя Алексея',
        positions: [{ start, end: start + anchorText.length }],
      },
    ]
    const { goldResults } = scoreDetections(gold, detected, sourceText)
    expect(goldResults[0].status).toBe('HIT')
    expect(goldResults[0].matchKind).toBe('anchor')
  })

  it('COMPANY-CORE: strips ООО wrapper so bare company name matches', () => {
    const gold = [{ type: 'COMPANY', value: 'ООО «АналитКорп»' }]
    const detected = [{ type: 'COMPANY', value: 'АналитКорп', positions: [] }]
    const { goldResults } = scoreDetections(gold, detected, '')
    expect(goldResults[0].status).toBe('HIT')
    expect(goldResults[0].matchKind).toBe('company-core')
  })

  it('PERSON-INITIALS: initials + surname matches full name (not MISS)', () => {
    const gold = [{ type: 'PERSON', value: 'Окишев Алексей Александрович' }]
    const detected = [{ type: 'PERSON', value: 'А.А. Окишев', positions: [] }]
    const { goldResults } = scoreDetections(gold, detected, '')
    expect(goldResults[0].status).not.toBe('MISS')
    expect(['HIT', 'PARTIAL']).toContain(goldResults[0].status)
  })

  it('BUG-1: one detection matching two gold entities is assigned to only one', () => {
    const gold = [
      { type: 'PERSON', value: 'Иван Петров' },
      { type: 'PERSON', value: 'Иван Петров ' }, // distinct gold entity, same effective value
    ]
    const detected = [{ type: 'PERSON', value: 'Иван Петров', positions: [] }]
    const { goldResults } = scoreDetections(gold, detected, '')
    const hits = goldResults.filter((r) => r.status === 'HIT')
    const misses = goldResults.filter((r) => r.status === 'MISS')
    expect(hits.length).toBe(1)
    expect(misses.length).toBe(1)
  })

  it('BUG-2: a correct-type PARTIAL beats a wrong-type EXACT for the same gold entity', () => {
    const gold = [{ type: 'PERSON', value: 'Иван Петров' }]
    const detected = [
      { type: 'COMPANY', value: 'Иван Петров', positions: [] }, // full match, wrong type
      { type: 'PERSON', value: 'Иван', positions: [] }, // partial match, right type
    ]
    const { goldResults, extras } = scoreDetections(gold, detected, '')
    expect(goldResults[0].status).toBe('PARTIAL')
    expect(goldResults[0].matched.type).toBe('PERSON')
    expect(goldResults[0].matched.value).toBe('Иван')
    // the wrong-type COMPANY detection should be left over as an extra, not
    // consumed as a TYPE_MISMATCH match for this gold entity.
    expect(extras.some((e) => e.type === 'COMPANY' && e.value === 'Иван Петров')).toBe(true)
  })

  it('English: exact company match hits; different companies do not collide via company-core', () => {
    const gold = [{ type: 'COMPANY', value: 'Acme Ltd' }]
    const detected = [{ type: 'COMPANY', value: 'Acme Ltd', positions: [] }]
    const { goldResults } = scoreDetections(gold, detected, '')
    expect(goldResults[0].status).toBe('HIT')

    const gold2 = [{ type: 'COMPANY', value: 'Acme Ltd' }]
    const detected2 = [{ type: 'COMPANY', value: 'Globex Ltd', positions: [] }]
    const { goldResults: goldResults2 } = scoreDetections(gold2, detected2, '')
    expect(goldResults2[0].status).toBe('MISS')
  })

  it('extras: a detection matching no gold entity is returned in extras', () => {
    const gold = [{ type: 'PERSON', value: 'Иван Петров' }]
    const detected = [
      { type: 'PERSON', value: 'Иван Петров', positions: [] },
      { type: 'COMPANY', value: 'Совершенно другая компания', positions: [] },
    ]
    const { extras } = scoreDetections(gold, detected, '')
    expect(extras.length).toBe(1)
    expect(extras[0].value).toBe('Совершенно другая компания')
  })

  it('MISS: no match at all leaves gold entity unassigned', () => {
    const gold = [{ type: 'ADDRESS', value: 'ул. Ленина, 1' }]
    const detected = [{ type: 'PERSON', value: 'Иван Петров', positions: [] }]
    const { goldResults } = scoreDetections(gold, detected, '')
    expect(goldResults[0].status).toBe('MISS')
  })

  it('TYPE_MISMATCH: wrong-type match only counted when no correct-type match exists', () => {
    const gold = [{ type: 'PERSON', value: 'Уникальное Имя' }]
    const detected = [{ type: 'COMPANY', value: 'Уникальное Имя', positions: [] }]
    const { goldResults } = scoreDetections(gold, detected, '')
    expect(statusOf(goldResults, 'Уникальное Имя')).toBe('TYPE_MISMATCH')
  })
})

describe('strict source occurrence coverage', () => {
  const active = (positions, overrides = {}) => ({ type: 'PERSON', value: 'unrelated canonical spelling', anonymize: true, dismissed: false, positions, ...overrides })

  it('finds a repeated leak even when legacy entity scoring reports a full HIT', () => {
    const source = 'Acme approved. Acme signed.'
    const gold = [{ type: 'COMPANY', value: 'Acme' }]
    const detected = [active([{ start: 0, end: 4 }], { type: 'COMPANY', value: 'Acme' })]
    expect(scoreDetections(gold, detected, source).goldResults[0].status).toBe('HIT')
    const result = scoreOccurrenceCoverage(gold, detected, source, '[COMPANY_1] approved. Acme signed.')
    expect(result.occurrences.map((occurrence) => occurrence.status)).toEqual(['FULL', 'MISSED'])
    expect(result.summary).toEqual({ total: 2, full: 1, partial: 0, missed: 1, unanchored: 0, recall: 0.5 })
    expect(result.residual).toHaveLength(1)
  })

  it('distinguishes partial, missed, unanchored and unavailable data', () => {
    const gold = [{ value: 'Alice Smith' }, { value: 'Bob' }, { value: 'Absent Person' }]
    const result = scoreOccurrenceCoverage(gold, [active([{ start: 0, end: 5 }])], 'Alice Smith and Bob')
    expect(result.summary).toEqual({ total: 2, full: 0, partial: 1, missed: 1, unanchored: 1, recall: 0 })
    expect(result.unanchored[0].gold.value).toBe('Absent Person')
    const legacy = scoreOccurrenceCoverage(gold, [{ positions: [{ start: 0, end: 11 }] }], 'Alice Smith')
    expect(legacy.available).toBe(false)
    expect(legacy.summary.recall).toBeNull()
    expect(legacy.missingActiveFlags).toBe(1)
    expect(scoreOccurrenceCoverage(gold, [], null).summary.recall).toBeNull()
  })

  it('anchors every alias/variant with Unicode boundaries and normalized whitespace', () => {
    const source = 'Анна Смирнова; АННА\n  СМИРНОВА; Смирновой; Ann; Anna'
    const gold = [{ value: 'Анна Смирнова', aliases: ['Смирновой'], variants: ['Анна Смирнова'] }, { value: 'Ann' }]
    const result = scoreOccurrenceCoverage(gold, [], source)
    expect(result.occurrences.map((occurrence) => occurrence.value)).toEqual(['Анна Смирнова', 'АННА\n  СМИРНОВА', 'Смирновой', 'Ann'])
    expect(result.summary.total).toBe(4)
  })

  it('deduplicates nested aliases and duplicate gold rows at the same source span', () => {
    const gold = [{ value: 'Alice Smith', aliases: ['Alice', 'Smith', 'ALICE SMITH'] }, { value: 'Alice Smith' }]
    const result = scoreOccurrenceCoverage(gold, [active([{ start: 0, end: 5 }])], 'Alice Smith')
    expect(result.occurrences).toHaveLength(1)
    expect(result.occurrences[0]).toMatchObject({ start: 0, end: 11, status: 'PARTIAL', goldIndices: [0, 1] })
  })

  it('does not collapse distinct repeated mentions into one through a crossing alias', () => {
    const result = scoreOccurrenceCoverage([{ value: 'New York', aliases: ['York New'] }], [], 'New York New York')
    expect(result.occurrences.map(({ start, end }) => [start, end])).toEqual([[0, 8], [4, 12], [9, 17]])
    expect(result.summary.total).toBe(3)
  })

  it('unions adjacent/overlapping active ranges but never bridges an uncovered gap', () => {
    const gold = [{ value: 'Alice Smith' }]
    const covered = scoreOccurrenceCoverage(gold, [active([{ start: 0, end: 5 }]), active([{ start: 5, end: 11 }])], 'Alice Smith')
    expect(covered.summary.full).toBe(1)
    const gap = scoreOccurrenceCoverage(gold, [active([{ start: 0, end: 5 }, { start: 6, end: 11 }])], 'Alice Smith')
    expect(gap.occurrences[0]).toMatchObject({ status: 'PARTIAL', coveredChars: 10 })
  })

  it('uses activation/dismissal rather than candidate/type labels or canonical value as proof of protection', () => {
    const gold = [{ type: 'PERSON', value: 'Alice' }]
    const position = [{ start: 0, end: 5 }]
    expect(scoreOccurrenceCoverage(gold, [active(position, { anonymize: false })], 'Alice').summary.missed).toBe(1)
    expect(scoreOccurrenceCoverage(gold, [active(position, { dismissed: true })], 'Alice').summary.missed).toBe(1)
    expect(scoreOccurrenceCoverage(gold, [active(position, { type: 'OTHER', candidate: true })], 'Alice').summary.full).toBe(1)
    expect(scoreOccurrenceCoverage(gold, [active([], { value: 'Alice' })], 'Alice').summary.missed).toBe(1)
  })

  it('rejects invalid offsets and keeps occurrence recall unavailable when no source anchor exists', () => {
    const gold = [{ value: 'Alice' }]
    const result = scoreOccurrenceCoverage(gold, [active([{ start: -1, end: 5 }, { start: 0, end: 999 }, { start: 0.5, end: 5 }])], 'Alice')
    expect(result.summary.missed).toBe(1)
    expect(result.invalidPositions).toBe(3)
    expect(scoreOccurrenceCoverage(gold, [], '').summary).toMatchObject({ total: 0, unanchored: 1, recall: null })
  })
})
