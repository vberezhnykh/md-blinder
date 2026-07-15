import { describe, it, expect } from 'vitest'
import { computeExportGate } from './exportGate'
import type { Entity } from './types'

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'type' | 'placeholder' | 'positions'>): Entity {
  return {
    id: overrides.placeholder,
    value: '',
    anonymize: true,
    manual: false,
    ...overrides,
  }
}

describe('computeExportGate', () => {
  it('no candidates, all active confirmed entities → no confirm needed', () => {
    const entities = [
      makeEntity({ type: 'PERSON', placeholder: '[PERSON_1]', positions: [{ start: 0, end: 4 }] }),
      makeEntity({ type: 'COMPANY', placeholder: '[COMPANY_1]', positions: [{ start: 10, end: 14 }] }),
      makeEntity({ type: 'EMAIL', placeholder: '[EMAIL_1]', positions: [{ start: 20, end: 24 }] }),
    ]
    expect(computeExportGate(entities)).toEqual({ replaced: 3, unreviewed: 0, needsConfirm: false })
  })

  it('confirmed active entities plus unreviewed candidates → needs confirm', () => {
    const entities = [
      makeEntity({ type: 'PERSON', placeholder: '[PERSON_1]', positions: [{ start: 0, end: 4 }] }),
      makeEntity({ type: 'COMPANY', placeholder: '[COMPANY_1]', positions: [{ start: 10, end: 14 }] }),
      makeEntity({
        type: 'PERSON',
        placeholder: '[PERSON_2]',
        positions: [{ start: 30, end: 34 }],
        anonymize: false,
        candidate: true,
      }),
      makeEntity({
        type: 'ADDRESS',
        placeholder: '[ADDRESS_1]',
        positions: [{ start: 40, end: 50 }],
        anonymize: false,
        candidate: true,
      }),
    ]
    expect(computeExportGate(entities)).toEqual({ replaced: 2, unreviewed: 2, needsConfirm: true })
  })

  it('a confirmed entity with anonymize:false (user unchecked) is not counted as replaced', () => {
    const entities = [
      makeEntity({ type: 'PERSON', placeholder: '[PERSON_1]', positions: [{ start: 0, end: 4 }] }),
      makeEntity({
        type: 'COMPANY',
        placeholder: '[COMPANY_1]',
        positions: [{ start: 10, end: 14 }],
        anonymize: false,
      }),
    ]
    expect(computeExportGate(entities)).toEqual({ replaced: 1, unreviewed: 0, needsConfirm: false })
  })
})
