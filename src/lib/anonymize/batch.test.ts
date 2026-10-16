import { describe, it, expect } from 'vitest'
import { alignBatch, reconcileBatchPlaceholders, seedFromBatch, type BatchMember } from './batch'
import { batchEntitiesToCsv, batchToMarkdown } from './batchExport'
import { buildAnonymizedText } from './apply'
import type { Entity, EntityType } from './types'

let seq = 0
// Сущность по всем вхождениям значения в тексте.
function entity(text: string, type: EntityType, value: string, placeholder: string, extra: Partial<Entity> = {}): Entity {
  const positions: { start: number; end: number }[] = []
  for (let i = text.indexOf(value); i !== -1; i = text.indexOf(value, i + value.length)) {
    positions.push({ start: i, end: i + value.length })
  }
  return { id: `e${++seq}`, type, value, placeholder, positions, anonymize: true, manual: false, ...extra }
}

function doc(text: string, parties: [EntityType, string, string][]): BatchMember {
  return { sourceText: text, entities: parties.map(([type, value, placeholder]) => entity(text, type, value, placeholder)) }
}

const first = doc('Договор между ООО «Альфа» и ООО «Бета». ООО «Бета» обязуется…', [
  ['COMPANY', 'ООО «Альфа»', '[COMPANY_1]'],
  ['COMPANY', 'ООО «Бета»', '[COMPANY_2]'],
])

describe('reconcileBatchPlaceholders', () => {
  it('дает общей стороне метку из другого документа, а новой — свободный номер', () => {
    const second = doc('Договор между ООО «Бета» и ООО «Гамма».', [
      ['COMPANY', 'ООО «Бета»', '[COMPANY_1]'],
      ['COMPANY', 'ООО «Гамма»', '[COMPANY_2]'],
    ])
    const result = reconcileBatchPlaceholders(second.entities, second.sourceText, [first])
    expect(result.map((e) => [e.value, e.placeholder])).toEqual([
      ['ООО «Бета»', '[COMPANY_2]'],
      ['ООО «Гамма»', '[COMPANY_3]'],
    ])
    expect(buildAnonymizedText(second.sourceText, result)).toBe('Договор между [COMPANY_2] и [COMPANY_3].')
  })

  it('связывает значения по любой форме вхождения без учета регистра', () => {
    const text = 'БЕТА и ООО «Бета»'
    const beta = entity(text, 'COMPANY', 'БЕТА', '[COMPANY_1]')
    beta.positions.push(...entity(text, 'COMPANY', 'ООО «Бета»', '').positions)
    const result = reconcileBatchPlaceholders([beta], text, [first])
    expect(result[0].placeholder).toBe('[COMPANY_2]')
  })

  it('связывает компанию по названию без ОПФ', () => {
    const second = doc('Бета и АО «Гамма»', [
      ['COMPANY', 'Бета', '[COMPANY_1]'],
      ['COMPANY', 'АО «Гамма»', '[COMPANY_2]'],
    ])
    const result = reconcileBatchPlaceholders(second.entities, second.sourceText, [first])
    expect(result.map((e) => e.placeholder)).toEqual(['[COMPANY_2]', '[COMPANY_3]'])
  })

  it('не связывает по названию без ОПФ, если оно ведет к разным сторонам', () => {
    const parent = doc('ООО «Бета» и АО «Бета»', [
      ['COMPANY', 'ООО «Бета»', '[COMPANY_1]'],
      ['COMPANY', 'АО «Бета»', '[COMPANY_2]'],
    ])
    const second = doc('Бета', [['COMPANY', 'Бета', '[COMPANY_1]']])
    const result = reconcileBatchPlaceholders(second.entities, second.sourceText, [parent])
    expect(result[0].placeholder).toBe('[COMPANY_3]')
  })

  it('не сливает две сущности документа в одну метку', () => {
    const text = 'ООО «Бета» и Бета'
    const full = entity(text, 'COMPANY', 'ООО «Бета»', '[COMPANY_1]')
    const short = { ...entity(text, 'COMPANY', 'Бета', '[COMPANY_2]'), positions: [{ start: 13, end: 17 }] }
    const result = reconcileBatchPlaceholders([full, short], text, [first])
    expect(result.map((e) => e.placeholder)).toEqual(['[COMPANY_2]', '[COMPANY_3]'])
  })

  it('нумерует типы независимо и кандидатов после всех занятых номеров', () => {
    const text = 'ООО «Дельта», Иван Петров, Петров'
    const delta = entity(text, 'COMPANY', 'ООО «Дельта»', '[COMPANY_1]')
    const person = entity(text, 'PERSON', 'Иван Петров', '[PERSON_1]')
    const candidate: Entity = {
      ...entity(text, 'COMPANY', 'Петров', '[COMPANY_2]'), positions: [{ start: 27, end: 33 }],
      anonymize: false, candidate: true,
    }
    const result = reconcileBatchPlaceholders([delta, person, candidate], text, [first])
    expect(result.map((e) => e.placeholder)).toEqual(['[COMPANY_3]', '[PERSON_1]', '[COMPANY_4]'])
  })

  it('сохраняет свободную метку и возвращает тот же массив без изменений', () => {
    const second = doc('ООО «Бета» и ООО «Сигма»', [
      ['COMPANY', 'ООО «Бета»', '[COMPANY_2]'],
      ['COMPANY', 'ООО «Сигма»', '[COMPANY_5]'],
    ])
    expect(reconcileBatchPlaceholders(second.entities, second.sourceText, [first])).toBe(second.entities)
  })
})

describe('alignBatch', () => {
  it('согласует цепочку договоров 1–2 и 2–3 по порядку', () => {
    const second = doc('ООО «Бета» и ООО «Гамма»', [
      ['COMPANY', 'ООО «Бета»', '[COMPANY_1]'],
      ['COMPANY', 'ООО «Гамма»', '[COMPANY_2]'],
    ])
    const third = doc('ООО «Гамма» и ООО «Альфа»', [
      ['COMPANY', 'ООО «Гамма»', '[COMPANY_1]'],
      ['COMPANY', 'ООО «Альфа»', '[COMPANY_2]'],
    ])
    const [a, b, c] = alignBatch([first, second, third])
    expect(a).toBe(first)
    expect(b.entities.map((e) => e.placeholder)).toEqual(['[COMPANY_2]', '[COMPANY_3]'])
    expect(c.entities.map((e) => e.placeholder)).toEqual(['[COMPANY_3]', '[COMPANY_1]'])
  })
})

describe('seedFromBatch', () => {
  it('размечает сторону, которую NER не нашел в новом документе', () => {
    const text = 'Поставщик ООО «Бета» и покупатель Иванов. Бета-версия.'
    const result = seedFromBatch(text, [], [first])
    const beta = result.find((e) => e.value === 'ООО «Бета»')!
    expect(beta.anonymize).toBe(true)
    expect(beta.candidate).toBeUndefined()
    expect(beta.positions).toEqual([{ start: 10, end: 20 }])
    const aligned = reconcileBatchPlaceholders(result, text, [first])
    expect(buildAnonymizedText(text, aligned)).toBe('Поставщик [COMPANY_2] и покупатель Иванов. Бета-версия.')
  })

  it('добавляет вхождения к сущности с той же формой и не трогает чужую разметку', () => {
    const text = 'ООО «Бета», ООО «БЕТА» и ООО «Бета Плюс»'
    const beta = { ...entity(text, 'COMPANY', 'ООО «Бета»', '[COMPANY_1]'), positions: [{ start: 0, end: 10 }] }
    const plus = entity(text, 'COMPANY', 'ООО «Бета Плюс»', '[COMPANY_2]')
    const result = seedFromBatch(text, [beta, plus], [first])
    expect(result).toHaveLength(2)
    expect(result[0].positions).toEqual([{ start: 0, end: 10 }, { start: 12, end: 22 }])
    expect(result[1]).toEqual(plus)
  })

  it('принимает кандидата, который ровно покрывает подтвержденную в пакете форму', () => {
    const text = 'Стороны: ООО «Бета».'
    const candidate = { ...entity(text, 'COMPANY', 'ООО «Бета»', '[COMPANY_1]'), anonymize: false, candidate: true, candidateNote: 'Низкая уверенность модели' }
    const [result] = seedFromBatch(text, [candidate], [first])
    expect(result).toMatchObject({ candidate: false, anonymize: true, candidateNote: undefined })
  })

  it('не использует выключенные и непроверенные значения других документов', () => {
    const off = { sourceText: 'ООО «Бета»', entities: [{ ...entity('ООО «Бета»', 'COMPANY', 'ООО «Бета»', '[COMPANY_1]'), anonymize: false }] }
    const text = 'ООО «Бета»'
    expect(seedFromBatch(text, [], [off])).toEqual([])
  })
})

describe('экспорт пакета', () => {
  const second = doc('Договор с Гаммой.', [['COMPANY', 'Гаммой', '[COMPANY_3]']])
  const docs = [
    { name: 'alpha-beta.docx', ...first },
    { name: 'Договор с Гаммой.docx', ...second },
  ]

  it('собирает документы под нейтральными заголовками без имен файлов', () => {
    const md = batchToMarkdown(docs)
    expect(md).toBe(
      '# Документ 1\n\nДоговор между [COMPANY_1] и [COMPANY_2]. [COMPANY_2] обязуется…\n\n---\n\n# Документ 2\n\nДоговор с [COMPANY_3].\n',
    )
    expect(md).not.toContain('docx')
  })

  it('сводит таблицу замен по меткам всего пакета', () => {
    const csv = batchEntitiesToCsv(docs)
    expect(csv.split('\r\n')).toEqual([
      'sep=,',
      'Плейсхолдер,Тип,Оригинальные значения,Документы,Вхождений',
      '[COMPANY_1],COMPANY,ООО «Альфа»,Документ 1 (alpha-beta.docx),1',
      '[COMPANY_2],COMPANY,ООО «Бета»,Документ 1 (alpha-beta.docx),2',
      '[COMPANY_3],COMPANY,Гаммой,Документ 2 (Договор с Гаммой.docx),1',
    ])
  })
})
