import { describe, it, expect } from 'vitest'
import { serializeHistory, parseHistory, mergeDocs, type HistoryDoc } from './history'
import type { Entity } from './anonymize/types'

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'e1',
    type: 'PERSON',
    value: 'Иван Иванов',
    placeholder: '[PERSON_1]',
    occurrences: 1,
    positions: [{ start: 0, end: 10 }],
    anonymize: true,
    manual: false,
    ...overrides,
  }
}

function makeDoc(overrides: Partial<HistoryDoc> = {}): HistoryDoc {
  return {
    id: 'doc-1',
    name: 'contract.docx',
    format: 'docx',
    createdAt: 1000,
    updatedAt: 2000,
    sourceText: 'Hello world',
    entities: [makeEntity()],
    ...overrides,
  }
}

describe('serializeHistory / parseHistory round-trip', () => {
  it('preserves document fields through round-trip', () => {
    const docs = [makeDoc(), makeDoc({ id: 'doc-2', name: 'scan.pdf', format: 'pdf' })]
    const json = serializeHistory(docs)
    const parsed = parseHistory(json)

    expect(parsed).toHaveLength(2)
    const [d1, d2] = parsed
    expect(d1.id).toBe('doc-1')
    expect(d1.name).toBe('contract.docx')
    expect(d1.sourceText).toBe('Hello world')
    expect(d1.entities).toEqual([makeEntity()])
    expect(d1.format).toBe('docx')
    expect(d2.format).toBe('pdf')
  })
})

describe('parseHistory validation', () => {
  it('throws on invalid JSON', () => {
    expect(() => parseHistory('не json')).toThrowError('Файл не похож на экспорт истории MD Blinder')
  })

  it('throws on JSON that is not a history export', () => {
    expect(() => parseHistory(JSON.stringify({ foo: 1 }))).toThrowError(
      'Файл не похож на экспорт истории MD Blinder',
    )
  })

  it('defaults missing createdAt/updatedAt/format', () => {
    const raw = {
      app: 'md-blinder',
      kind: 'history',
      version: 1,
      exportedAt: Date.now(),
      documents: [
        {
          id: 'doc-x',
          name: 'no-meta.txt',
          sourceText: 'text',
          entities: [],
        },
      ],
    }
    const before = Date.now()
    const [doc] = parseHistory(JSON.stringify(raw))
    const after = Date.now()

    expect(doc.format).toBe('docx')
    expect(doc.createdAt).toBeGreaterThanOrEqual(before)
    expect(doc.createdAt).toBeLessThanOrEqual(after)
    expect(doc.updatedAt).toBeGreaterThanOrEqual(before)
    expect(doc.updatedAt).toBeLessThanOrEqual(after)
  })
})

describe('mergeDocs', () => {
  it('keeps the document with the larger updatedAt when ids collide', () => {
    const older = makeDoc({ id: 'shared', updatedAt: 100, name: 'old.docx' })
    const newer = makeDoc({ id: 'shared', updatedAt: 200, name: 'new.docx' })

    const mergedA = mergeDocs([older], [newer])
    expect(mergedA).toHaveLength(1)
    expect(mergedA[0].name).toBe('new.docx')

    const mergedB = mergeDocs([newer], [older])
    expect(mergedB).toHaveLength(1)
    expect(mergedB[0].name).toBe('new.docx')
  })

  it('combines documents with different ids', () => {
    const a = makeDoc({ id: 'a' })
    const b = makeDoc({ id: 'b' })
    const merged = mergeDocs([a], [b])
    expect(merged).toHaveLength(2)
    expect(merged.map((d) => d.id).sort()).toEqual(['a', 'b'])
  })
})
