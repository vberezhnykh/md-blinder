import { describe, it, expect } from 'vitest'
import { serializeHistory, parseHistory, sanitizeEntities, mergeDocs, type HistoryDoc } from './history'
import type { Entity } from './anonymize/types'

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'e1',
    type: 'PERSON',
    value: 'Иван Иванов',
    placeholder: '[PERSON_1]',
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

  it('сохраняет пакет документа и не придумывает его для одиночных', () => {
    const [batched, single] = parseHistory(serializeHistory([makeDoc({ batchId: 'b1' }), makeDoc({ id: 'doc-2' })]))
    expect(batched.batchId).toBe('b1')
    expect(single).not.toHaveProperty('batchId')
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

describe('sanitizeEntities', () => {
  it('drops malformed entities but keeps the valid ones, coercing unknown types to OTHER', () => {
    const valid = makeEntity()
    const raw = [
      {}, // missing id/value/placeholder/type
      { ...makeEntity({ id: 'e2' }), positions: null }, // positions not an array
      { ...makeEntity({ id: 'e3' }), type: 'ALIEN_TYPE' }, // unknown type
      { ...makeEntity({ id: 'e4' }), positions: [{ start: 'x', end: 5 }, { start: 5, end: 3 }] }, // non-numeric / start>=end
      valid,
    ]

    const result = sanitizeEntities(raw)

    expect(result).toHaveLength(2)
    const ids = result.map((e) => e.id)
    expect(ids).toContain('e3')
    expect(ids).toContain('e1')
    const coerced = result.find((e) => e.id === 'e3')
    expect(coerced?.type).toBe('OTHER')
    const stillValid = result.find((e) => e.id === 'e1')
    expect(stillValid?.type).toBe('PERSON')
  })

  it('returns an empty array for non-array input', () => {
    expect(sanitizeEntities(null)).toEqual([])
    expect(sanitizeEntities(undefined)).toEqual([])
    expect(sanitizeEntities('not an array')).toEqual([])
  })

  it('preserves candidate, candidateNote, and score fields', () => {
    const raw = [
      makeEntity({
        id: 'cand-1',
        candidate: true,
        candidateNote: 'Низкая уверенность модели',
        score: 0.2,
        anonymize: false,
      }),
    ]
    const result = sanitizeEntities(raw)
    expect(result).toHaveLength(1)
    expect(result[0].candidate).toBe(true)
    expect(result[0].candidateNote).toBe('Низкая уверенность модели')
    expect(result[0].score).toBe(0.2)
  })

  it('preserves relatedTo and drops it when it is not a string', () => {
    const result = sanitizeEntities([
      makeEntity({ id: 'related', candidate: true, relatedTo: 'person-1', anonymize: false }),
      { ...makeEntity({ id: 'broken', candidate: true, anonymize: false }), relatedTo: 42 },
    ])
    expect(result.map((e) => e.relatedTo)).toEqual(['person-1', undefined])
  })

  it('keeps only the valid positions of an otherwise-valid entity', () => {
    const raw = [
      {
        ...makeEntity(),
        positions: [
          { start: 0, end: 10 },
          { start: 'a', end: 5 },
          { start: 8, end: 8 },
          { start: 20, end: 15 },
        ],
      },
    ]
    const result = sanitizeEntities(raw)
    expect(result).toHaveLength(1)
    expect(result[0].positions).toEqual([{ start: 0, end: 10 }])
  })
})

describe('parseHistory entity validation', () => {
  it('drops malformed entities within a document without rejecting the document', () => {
    const raw = {
      app: 'md-blinder',
      kind: 'history',
      version: 1,
      exportedAt: Date.now(),
      documents: [
        {
          id: 'doc-x',
          name: 'mixed.docx',
          sourceText: 'Hello world',
          entities: [
            {}, // fully malformed
            { ...makeEntity({ id: 'p-null' }), positions: null },
            { ...makeEntity({ id: 'p-unknown-type' }), type: 'NOT_A_TYPE' },
            {
              ...makeEntity({ id: 'p-bad-pos' }),
              positions: [{ start: 5, end: 2 }],
            },
            makeEntity({ id: 'p-good' }),
          ],
        },
      ],
    }

    const [doc] = parseHistory(JSON.stringify(raw))

    const ids = doc.entities.map((e) => e.id)
    expect(ids).toEqual(['p-unknown-type', 'p-good'])
    expect(doc.entities.find((e) => e.id === 'p-unknown-type')?.type).toBe('OTHER')
  })

  it('leaves a normal round-trip export/import unchanged', () => {
    const doc = makeDoc()
    const [parsed] = parseHistory(serializeHistory([doc]))
    expect(parsed.entities).toEqual(doc.entities)
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
