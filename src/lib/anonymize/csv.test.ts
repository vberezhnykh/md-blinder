import { describe, it, expect } from 'vitest'
import { entitiesToCsv } from './csv'
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

describe('entitiesToCsv', () => {
  it('has the exact expected header row', () => {
    const csv = entitiesToCsv([], '')
    expect(csv.split('\r\n')[0]).toBe('Плейсхолдер,Тип,Оригинальное значение,Вхождений')
  })

  it('includes only active (anonymize:true) entities', () => {
    const sourceText = 'Acme Corp works with Beta Inc'
    const activeValue = 'Acme Corp'
    const inactiveValue = 'Beta Inc'
    const activeStart = sourceText.indexOf(activeValue)
    const inactiveStart = sourceText.indexOf(inactiveValue)

    const active = makeEntity({
      type: 'COMPANY',
      placeholder: '[COMPANY_1]',
      positions: [{ start: activeStart, end: activeStart + activeValue.length }],
    })
    const inactive = makeEntity({
      type: 'COMPANY',
      placeholder: '[COMPANY_2]',
      anonymize: false,
      positions: [{ start: inactiveStart, end: inactiveStart + inactiveValue.length }],
    })

    const csv = entitiesToCsv([active, inactive], sourceText)
    expect(csv).toContain('[COMPANY_1]')
    expect(csv).not.toContain('[COMPANY_2]')
  })

  it('uses the current doc slice for the value column and positions.length for the count', () => {
    const sourceText = 'John Smith met John Smith twice'
    const value = 'John Smith'
    const firstStart = sourceText.indexOf(value)
    const secondStart = sourceText.indexOf(value, firstStart + 1)

    const entity = makeEntity({
      type: 'PERSON',
      placeholder: '[PERSON_1]',
      value: 'stale cached value',
      positions: [
        { start: firstStart, end: firstStart + value.length },
        { start: secondStart, end: secondStart + value.length },
      ],
    })

    const csv = entitiesToCsv([entity], sourceText)
    const row = csv.split('\r\n')[1]
    expect(row).toBe('[PERSON_1],PERSON,John Smith,2')
  })

  it('quotes a value containing a comma', () => {
    const sourceText = 'Client: Acme, Ltd signed today'
    const value = 'Acme, Ltd'
    const start = sourceText.indexOf(value)

    const entity = makeEntity({
      type: 'COMPANY',
      placeholder: '[COMPANY_1]',
      positions: [{ start, end: start + value.length }],
    })

    const csv = entitiesToCsv([entity], sourceText)
    const row = csv.split('\r\n')[1]
    expect(row).toBe('[COMPANY_1],COMPANY,"Acme, Ltd",1')
  })

  it('doubles internal quotes when the value contains a double quote', () => {
    const sourceText = 'Known as "Acme" locally'
    const value = '"Acme"'
    const start = sourceText.indexOf(value)

    const entity = makeEntity({
      type: 'COMPANY',
      placeholder: '[COMPANY_1]',
      positions: [{ start, end: start + value.length }],
    })

    const csv = entitiesToCsv([entity], sourceText)
    const row = csv.split('\r\n')[1]
    expect(row).toBe('[COMPANY_1],COMPANY,"""Acme""",1')
  })

  it('guards against formula injection by prefixing a leading apostrophe', () => {
    const sourceText = 'Formula: =SUM(A1) end'
    const value = '=SUM(A1)'
    const start = sourceText.indexOf(value)

    const entity = makeEntity({
      type: 'ACCOUNT',
      placeholder: '[ACCOUNT_1]',
      positions: [{ start, end: start + value.length }],
    })

    const csv = entitiesToCsv([entity], sourceText)
    const row = csv.split('\r\n')[1]
    const valueField = row.split(',')[2]
    expect(valueField.startsWith("'")).toBe(true)
    expect(valueField).toBe("'=SUM(A1)")
  })

  it('joins rows with \\r\\n', () => {
    const sourceText = 'Alpha Beta'
    const value = 'Alpha'
    const start = sourceText.indexOf(value)

    const entity = makeEntity({
      type: 'PERSON',
      placeholder: '[PERSON_1]',
      positions: [{ start, end: start + value.length }],
    })

    const csv = entitiesToCsv([entity], sourceText)
    const rows = csv.split('\r\n')
    expect(rows).toHaveLength(2)
    expect(csv).not.toContain('\n\n')
  })
})
