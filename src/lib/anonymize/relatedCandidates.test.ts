import { describe, it, expect } from 'vitest'
import {
  acceptAllRelated,
  acceptRelatedCandidate,
  candidateReason,
  compactPlaceholderNumbers,
  mergeEntities,
  restoreCandidate,
} from './apply'
import type { Entity } from './types'

// «Иван Петров … Петров … Петрову … Анна Смирнова … Смирнова»
const person: Entity = {
  id: 'p1', type: 'PERSON', value: 'Иван Петров', placeholder: '[PERSON_1]',
  positions: [{ start: 0, end: 11 }], anonymize: true, manual: false,
}
const other: Entity = {
  id: 'p2', type: 'PERSON', value: 'Анна Смирнова', placeholder: '[PERSON_2]',
  positions: [{ start: 40, end: 53 }], anonymize: true, manual: false,
}

function related(id: string, relatedTo: string, start: number, value: string, placeholder: string): Entity {
  return {
    id, type: 'PERSON', value, placeholder, positions: [{ start, end: start + value.length }],
    anonymize: false, manual: false, candidate: true, relatedTo,
  }
}

const surname = related('c1', 'p1', 14, 'Петров', '[PERSON_3]')
const dative = related('c2', 'p1', 24, 'Петрову', '[PERSON_4]')
const herSurname = related('c3', 'p2', 60, 'Смирнова', '[PERSON_5]')

describe('acceptRelatedCandidate', () => {
  it('сливает родственное вхождение с исходной сущностью и ее меткой', () => {
    const result = compactPlaceholderNumbers(acceptRelatedCandidate([person, other, surname, dative], 'c1'))
    expect(result.find((e) => e.id === 'c1')).toBeUndefined()
    const merged = result.find((e) => e.id === 'p1')!
    expect(merged.placeholder).toBe('[PERSON_1]')
    expect(merged.anonymize).toBe(true)
    expect(merged.positions).toEqual([{ start: 0, end: 11 }, { start: 14, end: 20 }])
    // Освободившийся номер кандидата занимает следующий кандидат.
    expect(result.find((e) => e.id === 'c2')!.placeholder).toBe('[PERSON_3]')
  })

  it('без исходной сущности принимает кандидата отдельно, с новой меткой', () => {
    const result = acceptRelatedCandidate([other, surname], 'c1')
    const accepted = result.find((e) => e.id === 'c1')!
    expect(accepted.candidate).toBe(false)
    expect(accepted.anonymize).toBe(true)
    // Номер следует за занятым [PERSON_2], а не сливается с ним.
    expect(accepted.placeholder).toBe('[PERSON_3]')
    expect(result.find((e) => e.id === 'p2')!.positions).toEqual(other.positions)
  })

  it('не сливает кандидата, если перед принятием сменили его тип', () => {
    const recolored: Entity = { ...surname, type: 'COMPANY', placeholder: '[COMPANY_1]' }
    const result = acceptRelatedCandidate([person, recolored], 'c1')
    expect(result.find((e) => e.id === 'c1')!.candidate).toBe(false)
    expect(result.find((e) => e.id === 'p1')!.positions).toEqual(person.positions)
  })

  it('не включает выключенную замену исходной сущности', () => {
    const disabled: Entity = { ...person, anonymize: false }
    const result = acceptRelatedCandidate([disabled, surname], 'c1')
    expect(result.find((e) => e.id === 'p1')!.anonymize).toBe(false)
    const accepted = result.find((e) => e.id === 'c1')!
    expect(accepted.anonymize).toBe(true)
    expect(accepted.placeholder).toBe('[PERSON_2]')
  })

  it('ничего не меняет для id, который не кандидат', () => {
    const entities = [person, surname]
    expect(acceptRelatedCandidate(entities, 'p1')).toBe(entities)
  })
})

describe('acceptAllRelated', () => {
  it('принимает только непроверенных кандидатов, похожих на эту сущность', () => {
    const dismissed: Entity = { ...dative, candidate: false, dismissed: true }
    const result = acceptAllRelated([person, other, surname, dismissed, herSurname], 'p1')
    expect(result.find((e) => e.id === 'c1')).toBeUndefined()
    expect(result.find((e) => e.id === 'p1')!.positions).toHaveLength(2)
    expect(result.find((e) => e.id === 'c2')!.dismissed).toBe(true)
    expect(result.find((e) => e.id === 'c3')!.candidate).toBe(true)
  })
})

describe('restoreCandidate', () => {
  it('возвращает отклоненного кандидата в непроверенные', () => {
    const dismissed: Entity = { ...surname, candidate: false, dismissed: true }
    const restored = restoreCandidate([person, dismissed], 'c1').find((e) => e.id === 'c1')!
    expect(restored.dismissed).toBe(false)
    expect(restored.candidate).toBe(true)
    expect(restored.anonymize).toBe(false)
    expect(restored.relatedTo).toBe('p1')
  })

  it('ничего не меняет для неотклоненной сущности', () => {
    const entities = [person, surname]
    expect(restoreCandidate(entities, 'c1')).toBe(entities)
  })
})

describe('candidateReason', () => {
  it('берет текущую метку исходной сущности', () => {
    const renumbered: Entity = { ...person, placeholder: '[PERSON_7]' }
    expect(candidateReason([renumbered, surname], surname)).toBe('Похоже на [PERSON_7]')
  })

  it('сообщает, что исходная сущность удалена', () => {
    expect(candidateReason([other, surname], surname)).toBe('Похоже на удаленную замену')
  })

  it('для кандидата без relatedTo показывает сохраненную причину', () => {
    const lowScore: Entity = { ...surname, relatedTo: undefined, candidateNote: 'Низкая уверенность модели' }
    expect(candidateReason([person, lowScore], lowScore)).toBe('Низкая уверенность модели')
  })
})

describe('mergeEntities и relatedTo', () => {
  it('переводит кандидатов на сущность, в которую влилась исходная', () => {
    const second: Entity = { ...person, id: 'p3', value: 'И. Петров', placeholder: '[PERSON_3]', positions: [{ start: 30, end: 39 }] }
    const result = mergeEntities([person, second, related('c4', 'p3', 70, 'Петровым', '[PERSON_4]')], 'p3', 'p1')
    expect(result.find((e) => e.id === 'c4')!.relatedTo).toBe('p1')
  })
})
