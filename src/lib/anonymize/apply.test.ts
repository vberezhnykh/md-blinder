import { describe, it, expect, vi } from 'vitest'
import {
  acceptCandidate,
  addEntityFromSelection,
  buildAnonymizedText,
  changeEntityType,
  dedupeEntityIds,
  entityCurrentValue,
  nextPlaceholderNumber,
} from './apply'
import { hasPlaceholderCollision } from './placeholderGuard'
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

describe('buildAnonymizedText', () => {
  it('replaces every position of an active entity with its placeholder', () => {
    const sourceText = 'John met John yesterday'
    const person = makeEntity({
      type: 'PERSON',
      placeholder: '[PERSON_1]',
      value: 'John',
      positions: [
        { start: 0, end: 4 },
        { start: 9, end: 13 },
      ],
    })
    const result = buildAnonymizedText(sourceText, [person])
    expect(result).toBe('[PERSON_1] met [PERSON_1] yesterday')
  })

  it('does not replace an inactive (anonymize:false) entity', () => {
    const sourceText = 'John met John yesterday'
    const person = makeEntity({
      type: 'PERSON',
      placeholder: '[PERSON_1]',
      value: 'John',
      positions: [
        { start: 0, end: 4 },
        { start: 9, end: 13 },
      ],
    })
    const dateWord = makeEntity({
      type: 'ADDRESS',
      placeholder: '[ADDRESS_1]',
      value: 'yesterday',
      anonymize: false,
      positions: [{ start: 14, end: 23 }],
    })
    const result = buildAnonymizedText(sourceText, [person, dateWord])
    expect(result).toBe('[PERSON_1] met [PERSON_1] yesterday')
    expect(result).not.toContain('[ADDRESS_1]')
  })

  it('splices back-to-front correctly for entities of different lengths', () => {
    const sourceText = 'Email john.doe@acme.co and phone +44 20 7946 0958 today'
    const emailValue = 'john.doe@acme.co'
    const phoneValue = '+44 20 7946 0958'
    const emailStart = sourceText.indexOf(emailValue)
    const phoneStart = sourceText.indexOf(phoneValue)

    const email = makeEntity({
      type: 'EMAIL',
      placeholder: '[EMAIL_1]',
      value: emailValue,
      positions: [{ start: emailStart, end: emailStart + emailValue.length }],
    })
    const phone = makeEntity({
      type: 'PHONE',
      placeholder: '[PHONE_1]',
      value: phoneValue,
      positions: [{ start: phoneStart, end: phoneStart + phoneValue.length }],
    })

    const result = buildAnonymizedText(sourceText, [email, phone])
    expect(result).toBe('Email [EMAIL_1] and phone [PHONE_1] today')
  })

  it('drops one of two overlapping replacements instead of double-splicing', () => {
    const sourceText = 'Contact Jane Doe today'
    // Overlapping positions: a broken invariant that should never happen via
    // normal app flow, but must not corrupt the output if it ever does.
    const person = makeEntity({
      type: 'PERSON',
      placeholder: '[PERSON_1]',
      value: 'Jane Doe',
      positions: [{ start: 8, end: 16 }],
    })
    const other = makeEntity({
      type: 'OTHER',
      placeholder: '[OTHER_1]',
      value: 'Doe today',
      positions: [{ start: 13, end: 22 }],
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = buildAnonymizedText(sourceText, [person, other])

    // Exactly one of the two placeholders survives, and the text is a valid
    // splice (no doubled/garbled text from applying both overlapping ranges).
    const hasPerson = result.includes('[PERSON_1]')
    const hasOther = result.includes('[OTHER_1]')
    expect(hasPerson !== hasOther).toBe(true)
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('B4: escapes a pre-existing placeholder-like literal not tied to any entity', () => {
    const sourceText = 'Existing note [PERSON_1] refers to an earlier draft.'
    const result = buildAnonymizedText(sourceText, [])
    expect(hasPlaceholderCollision(result)).toBe(false)
  })

  it('B4: a real entity still gets its genuine placeholder substituted (fresh entity, unrelated source)', () => {
    const sourceText = 'John Doe signed the agreement.'
    const johnStart = sourceText.indexOf('John Doe')
    const john = makeEntity({
      type: 'PERSON',
      placeholder: '[PERSON_1]',
      value: 'John Doe',
      positions: [{ start: johnStart, end: johnStart + 'John Doe'.length }],
    })

    const result = buildAnonymizedText(sourceText, [john])
    expect(result).toContain('[PERSON_1]')
  })
})

describe('entityCurrentValue', () => {
  it('returns the source-text slice at the first position', () => {
    const sourceText = 'Contact Jane Doe today'
    const entity = makeEntity({
      type: 'PERSON',
      placeholder: '[PERSON_1]',
      value: 'stale value',
      positions: [{ start: 8, end: 16 }],
    })
    expect(entityCurrentValue(sourceText, entity)).toBe('Jane Doe')
  })

  it('falls back to e.value when positions is empty', () => {
    const sourceText = 'Contact Jane Doe today'
    const entity = makeEntity({
      type: 'PERSON',
      placeholder: '[PERSON_1]',
      value: 'fallback value',
      positions: [],
    })
    expect(entityCurrentValue(sourceText, entity)).toBe('fallback value')
  })
})

describe('nextPlaceholderNumber', () => {
  it('returns one past the max existing number for a matching type, and 1 for unseen types', () => {
    const entities: Entity[] = [
      makeEntity({ type: 'PERSON', placeholder: '[PERSON_1]', positions: [{ start: 0, end: 1 }] }),
      makeEntity({ type: 'PERSON', placeholder: '[PERSON_2]', positions: [{ start: 2, end: 3 }] }),
      makeEntity({ type: 'COMPANY', placeholder: '[COMPANY_1]', positions: [{ start: 4, end: 5 }] }),
    ]
    expect(nextPlaceholderNumber(entities, 'PERSON')).toBe(3)
    expect(nextPlaceholderNumber(entities, 'COMPANY')).toBe(2)
    expect(nextPlaceholderNumber(entities, 'IBAN')).toBe(1)
  })

  it('returns 1 for an empty entities array', () => {
    expect(nextPlaceholderNumber([], 'PERSON')).toBe(1)
  })
})

describe('addEntityFromSelection', () => {
  it('absorbs a partial overlap and replaces it', () => {
    const sourceText = '221B Baker Street, London'
    const addressStart = sourceText.indexOf('Baker Street')
    const address = makeEntity({
      type: 'ADDRESS',
      placeholder: '[ADDRESS_1]',
      value: 'Baker Street',
      positions: [{ start: addressStart, end: addressStart + 'Baker Street'.length }],
    })

    const result = addEntityFromSelection([address], sourceText, 0, sourceText.length, 'ADDRESS')

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('ADDRESS')
    expect(result[0].value).toBe('221B Baker Street, London')
    expect(result[0].positions).toEqual([{ start: 0, end: sourceText.length }])
    expect(result.some((e) => e.value === 'Baker Street')).toBe(false)
  })

  it('keeps an unrelated non-overlapping entity', () => {
    const sourceText = 'John lives at 221B Baker Street'
    const addressStart = sourceText.indexOf('Baker Street')
    const person = makeEntity({
      type: 'PERSON',
      placeholder: '[PERSON_1]',
      value: 'John',
      positions: [{ start: 0, end: 4 }],
    })
    const address = makeEntity({
      type: 'ADDRESS',
      placeholder: '[ADDRESS_1]',
      value: 'Baker Street',
      positions: [{ start: addressStart, end: addressStart + 'Baker Street'.length }],
    })
    const selStart = sourceText.indexOf('221B')
    const selEnd = addressStart + 'Baker Street'.length

    const result = addEntityFromSelection([person, address], sourceText, selStart, selEnd, 'ADDRESS')

    const keptPerson = result.find((e) => e.type === 'PERSON')
    expect(keptPerson?.value).toBe('John')
    expect(keptPerson?.positions).toEqual([{ start: 0, end: 4 }])

    const addressEntities = result.filter((e) => e.type === 'ADDRESS')
    expect(addressEntities).toHaveLength(1)
    expect(addressEntities[0].value).toBe('221B Baker Street')
    expect(addressEntities[0].positions).toEqual([{ start: selStart, end: selEnd }])
  })

  it('auto-adds non-overlapping exact duplicates', () => {
    const sourceText = 'Acme Ltd and Acme Ltd'

    const result = addEntityFromSelection([], sourceText, 0, 8, 'COMPANY')

    expect(result).toHaveLength(1)
    expect(result[0].placeholder).toBe('[COMPANY_1]')
    expect(result[0].positions).toHaveLength(2)
    expect(result[0].positions).toEqual([
      { start: 0, end: 8 },
      { start: 13, end: 21 },
    ])
  })

  it('partially-absorbed multi-occurrence entity survives with its remaining occurrence', () => {
    const sourceText = 'Baker Street then Baker Street'
    const first = sourceText.indexOf('Baker Street')
    const second = sourceText.indexOf('Baker Street', first + 1)
    const address = makeEntity({
      type: 'ADDRESS',
      placeholder: '[ADDRESS_1]',
      value: 'Baker Street',
      positions: [
        { start: first, end: first + 'Baker Street'.length },
        { start: second, end: second + 'Baker Street'.length },
      ],
    })
    const selEnd = sourceText.indexOf('then') + 'then'.length

    const result = addEntityFromSelection([address], sourceText, 0, selEnd, 'ADDRESS')

    const survivor = result.find((e) => e.placeholder === '[ADDRESS_1]')
    expect(survivor).toBeDefined()
    expect(survivor?.positions).toEqual([{ start: second, end: second + 'Baker Street'.length }])

    const added = result.find((e) => e.value === 'Baker Street then')
    expect(added).toBeDefined()
    expect(added?.positions).toEqual([{ start: 0, end: selEnd }])
  })

  it('no-op on collapsed selection', () => {
    const sourceText = '221B Baker Street, London'
    const address = makeEntity({
      type: 'ADDRESS',
      placeholder: '[ADDRESS_1]',
      value: 'Baker Street',
      positions: [{ start: 5, end: 17 }],
    })
    const entities = [address]

    const result = addEntityFromSelection(entities, sourceText, 5, 5, 'ADDRESS')

    expect(result).toEqual(entities)
  })

  it('placeholder numbering after absorption does not collide with surviving entities', () => {
    const sourceText = 'Baker Street office, Main Street office'
    const bakerStart = sourceText.indexOf('Baker Street')
    const mainStart = sourceText.indexOf('Main Street')
    const baker = makeEntity({
      type: 'ADDRESS',
      placeholder: '[ADDRESS_1]',
      value: 'Baker Street',
      positions: [{ start: bakerStart, end: bakerStart + 'Baker Street'.length }],
    })
    const main = makeEntity({
      type: 'ADDRESS',
      placeholder: '[ADDRESS_2]',
      value: 'Main Street',
      positions: [{ start: mainStart, end: mainStart + 'Main Street'.length }],
    })

    const result = addEntityFromSelection(
      [baker, main],
      sourceText,
      bakerStart,
      bakerStart + 'Baker Street'.length,
      'ADDRESS',
    )

    const newEntity = result.find((e) => e.value === 'Baker Street')
    expect(newEntity?.placeholder).toMatch(/^\[ADDRESS_\d+\]$/)
    const placeholders = result.map((e) => e.placeholder)
    expect(new Set(placeholders).size).toBe(placeholders.length)
  })

  it('yields a UUID-style id distinct from the placeholder', () => {
    const sourceText = 'Acme Ltd works with Beta Ltd'
    const result = addEntityFromSelection([], sourceText, 0, 8, 'COMPANY')

    expect(result).toHaveLength(1)
    expect(result[0].placeholder).toBe('[COMPANY_1]')
    expect(result[0].id).not.toBe(result[0].placeholder)
    expect(result[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})

describe('changeEntityType', () => {
  it('updates the target entity type and placeholder, keeps its id, and leaves others untouched', () => {
    const sourceText = 'Acme Ltd and John Smith'
    const withCompany = addEntityFromSelection([], sourceText, 0, 8, 'COMPANY')
    const withPerson = addEntityFromSelection(withCompany, sourceText, 13, 23, 'PERSON')

    const company = withPerson.find((e) => e.type === 'COMPANY')!
    const person = withPerson.find((e) => e.type === 'PERSON')!

    const result = changeEntityType(withPerson, company.id, 'PERSON')

    const changed = result.find((e) => e.id === company.id)!
    expect(changed.type).toBe('PERSON')
    expect(changed.placeholder).toBe('[PERSON_2]')
    expect(changed.id).toBe(company.id)

    const untouched = result.find((e) => e.id === person.id)!
    expect(untouched).toEqual(person)
  })

  it('returns the array unchanged when the id does not exist', () => {
    const sourceText = 'Acme Ltd'
    const entities = addEntityFromSelection([], sourceText, 0, 8, 'COMPANY')

    const result = changeEntityType(entities, 'no-such-id', 'PERSON')

    expect(result).toBe(entities)
  })

  it('AUD-1.2: recoloring then adding a new entity of the vacated type produces unique ids', () => {
    const sourceText = 'Acme Ltd works with Globex Inc'
    let entities = addEntityFromSelection([], sourceText, 0, 8, 'COMPANY')
    const firstId = entities[0].id

    entities = changeEntityType(entities, firstId, 'PERSON')

    const globexStart = sourceText.indexOf('Globex Inc')
    entities = addEntityFromSelection(
      entities,
      sourceText,
      globexStart,
      globexStart + 'Globex Inc'.length,
      'COMPANY',
    )

    expect(entities).toHaveLength(2)
    const ids = entities.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('dedupeEntityIds', () => {
  it('assigns a fresh id to a later duplicate while keeping the first occurrence', () => {
    const shared: Entity = {
      id: 'dup-id',
      type: 'PERSON',
      value: 'John',
      placeholder: '[PERSON_1]',
      positions: [{ start: 0, end: 4 }],
      anonymize: true,
      manual: false,
    }
    const collidingCompany: Entity = {
      id: 'dup-id',
      type: 'COMPANY',
      value: 'Acme',
      placeholder: '[COMPANY_1]',
      positions: [{ start: 10, end: 14 }],
      anonymize: true,
      manual: false,
    }
    const entities = [shared, collidingCompany]

    const result = dedupeEntityIds(entities)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('dup-id')
    const ids = result.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result[1].id).not.toBe('dup-id')
  })

  it('leaves an already-unique array with unchanged ids', () => {
    const a: Entity = {
      id: 'id-a',
      type: 'PERSON',
      value: 'John',
      placeholder: '[PERSON_1]',
      positions: [{ start: 0, end: 4 }],
      anonymize: true,
      manual: false,
    }
    const b: Entity = {
      id: 'id-b',
      type: 'COMPANY',
      value: 'Acme',
      placeholder: '[COMPANY_1]',
      positions: [{ start: 10, end: 14 }],
      anonymize: true,
      manual: false,
    }
    const result = dedupeEntityIds([a, b])

    expect(result.map((e) => e.id)).toEqual(['id-a', 'id-b'])
  })
})

describe('acceptCandidate', () => {
  it('accepting sets candidate:false, anonymize:true, and recomputes a non-colliding placeholder', () => {
    const confirmed: Entity = {
      id: 'confirmed-1',
      type: 'PERSON',
      value: 'John Doe',
      placeholder: '[PERSON_1]',
      positions: [{ start: 0, end: 8 }],
      anonymize: true,
      manual: false,
    }
    const candidate: Entity = {
      id: 'candidate-1',
      type: 'PERSON',
      value: 'Jane Roe',
      placeholder: '[PERSON_2]',
      positions: [{ start: 20, end: 28 }],
      anonymize: false,
      manual: false,
      candidate: true,
      candidateNote: 'Низкая уверенность модели',
      score: 0.2,
    }

    const result = acceptCandidate([confirmed, candidate], 'candidate-1')

    const accepted = result.find((e) => e.id === 'candidate-1')!
    expect(accepted.candidate).toBe(false)
    expect(accepted.candidateNote).toBeUndefined()
    expect(accepted.anonymize).toBe(true)
    expect(accepted.placeholder).toBe('[PERSON_2]')

    const placeholders = result.map((e) => e.placeholder)
    expect(new Set(placeholders).size).toBe(placeholders.length)
  })

  it('is a no-op when accepting a non-candidate id', () => {
    const confirmed: Entity = {
      id: 'confirmed-1',
      type: 'PERSON',
      value: 'John Doe',
      placeholder: '[PERSON_1]',
      positions: [{ start: 0, end: 8 }],
      anonymize: true,
      manual: false,
    }
    const entities = [confirmed]
    const result = acceptCandidate(entities, 'confirmed-1')
    expect(result).toBe(entities)
  })

  it('is a no-op when the id does not exist', () => {
    const entities: Entity[] = [
      {
        id: 'confirmed-1',
        type: 'PERSON',
        value: 'John Doe',
        placeholder: '[PERSON_1]',
        positions: [{ start: 0, end: 8 }],
        anonymize: true,
        manual: false,
      },
    ]
    const result = acceptCandidate(entities, 'no-such-id')
    expect(result).toBe(entities)
  })
})
