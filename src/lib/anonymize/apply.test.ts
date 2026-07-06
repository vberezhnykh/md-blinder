import { describe, it, expect } from 'vitest'
import { addEntityFromSelection, buildAnonymizedText, entityCurrentValue, nextPlaceholderNumber } from './apply'
import type { Entity } from './types'

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'type' | 'placeholder' | 'positions'>): Entity {
  return {
    id: overrides.placeholder,
    value: '',
    occurrences: overrides.positions.length,
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
    expect(result[0].occurrences).toBe(2)
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
})
