import { describe, it, expect } from 'vitest'
import { scoreDetections } from './scoring-core.mjs'

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
