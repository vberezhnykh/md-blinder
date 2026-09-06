import { describe, it, expect } from 'vitest'
import { findRelatedOccurrences } from './relatedOccurrences'
import type { Entity } from './types'

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'type' | 'value' | 'placeholder' | 'positions'>): Entity {
  return {
    id: crypto.randomUUID(),
    anonymize: true,
    manual: false,
    ...overrides,
  }
}

describe('findRelatedOccurrences', () => {
  it('PERSON: находит фамилию без имени и инициалы+фамилию', () => {
    const sourceText =
      'Иванов Иван Иванович подписал договор. Позже Иванова видели в офисе. ' +
      'Завизировал И.И. Иванов лично.'
    const fullName = 'Иванов Иван Иванович'
    const start = sourceText.indexOf(fullName)
    const entity = makeEntity({
      type: 'PERSON',
      value: fullName,
      placeholder: '[PERSON_1]',
      positions: [{ start, end: start + fullName.length }],
    })

    const result = findRelatedOccurrences(sourceText, [entity])

    const surnameOnly = result.find((e) => e.value === 'Иванова')
    const initialsForm = result.find((e) => e.value === 'И.И. Иванов')

    expect(surnameOnly).toBeDefined()
    expect(initialsForm).toBeDefined()

    for (const candidate of [surnameOnly, initialsForm]) {
      expect(candidate!.candidate).toBe(true)
      expect(candidate!.anonymize).toBe(false)
      expect(candidate!.candidateNote).toBe('Похоже на [PERSON_1]')
      for (const pos of candidate!.positions) {
        expect(sourceText.slice(pos.start, pos.end)).toBe(candidate!.value)
      }
    }
  })

  it('COMPANY: находит имя без ОПФ и аббревиатуру (2-3 символа)', () => {
    const sourceText = 'Acme Industrial Holdings Ltd (далее — Acme). Годовой отчёт AIH утверждён.'
    const fullName = 'Acme Industrial Holdings Ltd'
    const start = sourceText.indexOf(fullName)
    const entity = makeEntity({
      type: 'COMPANY',
      value: fullName,
      placeholder: '[COMPANY_1]',
      positions: [{ start, end: start + fullName.length }],
    })

    const result = findRelatedOccurrences(sourceText, [entity])

    const shortName = result.find((e) => e.value === 'Acme')
    const acronym = result.find((e) => e.value === 'AIH')

    expect(shortName).toBeDefined()
    expect(acronym).toBeDefined()

    for (const candidate of [shortName, acronym]) {
      expect(candidate!.candidate).toBe(true)
      expect(candidate!.anonymize).toBe(false)
      expect(candidate!.candidateNote).toBe('Похоже на [COMPANY_1]')
      for (const pos of candidate!.positions) {
        expect(sourceText.slice(pos.start, pos.end)).toBe(candidate!.value)
      }
    }
  })

  it('не создаёт кандидата, если единственное вхождение уже занято сущностью', () => {
    const sourceText = 'Beta Corp'
    const entity = makeEntity({
      type: 'COMPANY',
      value: 'Beta Corp',
      placeholder: '[COMPANY_1]',
      positions: [{ start: 0, end: sourceText.length }],
    })

    const result = findRelatedOccurrences(sourceText, [entity])

    expect(result).toHaveLength(0)
  })

  it('находит повтор известного значения на ещё не покрытой позиции', () => {
    const sourceText =
      'Иванов Иван Иванович подписал акт. Отчёт передала Иванова. Позже Иванова заходила снова.'
    const fullName = 'Иванов Иван Иванович'
    const fullStart = sourceText.indexOf(fullName)
    const entity1 = makeEntity({
      type: 'PERSON',
      value: fullName,
      placeholder: '[PERSON_1]',
      positions: [{ start: fullStart, end: fullStart + fullName.length }],
    })

    const firstIvanova = sourceText.indexOf('Иванова')
    const entity2 = makeEntity({
      type: 'PERSON',
      value: 'Иванова',
      placeholder: '[PERSON_2]',
      positions: [{ start: firstIvanova, end: firstIvanova + 'Иванова'.length }],
    })

    const result = findRelatedOccurrences(sourceText, [entity1, entity2])

    const repeat = result.find((e) => e.value === 'Иванова')
    expect(repeat).toBeDefined()
    expect(repeat!.positions).toEqual([{ start: sourceText.lastIndexOf('Иванова'), end: sourceText.lastIndexOf('Иванова') + 7 }])
  })

  it('находит полные повторные имена и компании, сохраняя отклонённые позиции', () => {
    const text = 'Acme approved. Acme signed. Acme confirmed.'
    const active = makeEntity({ type: 'COMPANY', value: 'Acme', placeholder: '[COMPANY_1]', positions: [{ start: 0, end: 4 }] })
    const dismissed = makeEntity({ type: 'COMPANY', value: 'Acme', placeholder: '[COMPANY_2]', positions: [{ start: 15, end: 19 }], anonymize: false, dismissed: true })
    const result = findRelatedOccurrences(text, [active, dismissed])
    expect(result).toHaveLength(1)
    expect(result[0].positions).toEqual([{ start: 28, end: 32 }])
    expect(result[0].value).toBe('Acme')

    const personText = 'Alice Smith. Alice Smith.'
    const person = makeEntity({ type: 'PERSON', value: 'Alice Smith', placeholder: '[PERSON_1]', positions: [{ start: 0, end: 11 }] })
    expect(findRelatedOccurrences(personText, [person])[0].positions).toEqual([{ start: 13, end: 24 }])
  })

  it('нумерует плейсхолдер кандидата вслед за существующими сущностями того же типа', () => {
    const sourceText = 'Иванов Иван Иванович. Иванова тоже здесь.'
    const fullName = 'Иванов Иван Иванович'
    const start = sourceText.indexOf(fullName)
    const entity = makeEntity({
      type: 'PERSON',
      value: fullName,
      placeholder: '[PERSON_1]',
      positions: [{ start, end: start + fullName.length }],
    })

    const result = findRelatedOccurrences(sourceText, [entity])
    const surnameOnly = result.find((e) => e.value === 'Иванова')

    expect(surnameOnly).toBeDefined()
    expect(surnameOnly!.placeholder).toBe('[PERSON_2]')
  })
})
