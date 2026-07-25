import { describe, it, expect } from 'vitest'
import { countWords, planBatches, expandBatchResult, type NerItem } from './nerBatching'

describe('countWords', () => {
  it('counts letter/digit runs as words', () => {
    expect(countWords('Іван Петров')).toBe(2)
  })

  it('counts each punctuation char as its own word (WORD_RE fallback \\S)', () => {
    // «а.а.» без пробела: точка не входит в класс букв/цифр и не является
    // разделителем «-»/«_», поэтому «а», «.», «а», «.» — четыре отдельных
    // токена, плюс «окишев» — итого 5, а не 3.
    expect(countWords('а.а. окишев')).toBe(5)
  })
})

describe('planBatches', () => {
  it('dedups identical chunk text into one occurrences entry and one batch slot', () => {
    const chunks = [
      { text: 'повторяющийся текст', base: 0 },
      { text: 'повторяющийся текст', base: 100 },
      { text: 'повторяющийся текст', base: 500 },
    ]

    const { batches, occurrences } = planBatches(chunks, 8)

    expect(occurrences.get('повторяющийся текст')?.length).toBe(3)
    const flatBatches = batches.flat()
    expect(flatBatches.filter((t) => t === 'повторяющийся текст').length).toBe(1)
    expect(flatBatches.length).toBe(1)
  })

  it('sorts unique texts by word count ascending', () => {
    const short = Array.from({ length: 5 }, (_, i) => `word${i}`).join(' ')
    const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ')
    const mid = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')

    // Намеренно передаём чанки не по возрастанию слов, чтобы проверить, что
    // planBatches сам их пересортировывает.
    const chunks = [
      { text: long, base: 0 },
      { text: short, base: 1000 },
      { text: mid, base: 2000 },
    ]

    const { batches } = planBatches(chunks, 8)

    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual([short, mid, long])
  })

  it('slices unique texts into batches of the given size', () => {
    const chunks = Array.from({ length: 20 }, (_, i) => ({ text: `chunk-${i}`, base: i * 10 }))

    const { batches } = planBatches(chunks, 8)

    expect(batches.map((b) => b.length)).toEqual([8, 8, 4])
  })
})

describe('expandBatchResult', () => {
  it('maps offsets per-occurrence (not per-representative) when a text repeats', () => {
    const batchTexts = ['Иван Иванов работает в компании']
    const item: NerItem = { label: 'person', start: 0, end: 11, spanText: 'Иван Иванов', score: 0.9 }
    const batchResult: NerItem[][] = [[item]]
    const occurrences = new Map([
      [batchTexts[0], [
        { text: batchTexts[0], base: 100 },
        { text: batchTexts[0], base: 500 },
      ]],
    ])

    const matches = expandBatchResult(batchTexts, batchResult, occurrences, () => 'PERSON')

    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ type: 'PERSON', value: 'Иван Иванов', start: 100, end: 111 })
    expect(matches[1]).toMatchObject({ type: 'PERSON', value: 'Иван Иванов', start: 500, end: 511 })
  })

  it('skips items whose label maps to null', () => {
    const batchTexts = ['текст']
    const item: NerItem = { label: 'unknown', start: 0, end: 5, spanText: 'текст', score: 0.5 }
    const occurrences = new Map([[batchTexts[0], [{ text: batchTexts[0], base: 0 }]]])

    const matches = expandBatchResult(batchTexts, [[item]], occurrences, () => null)

    expect(matches).toHaveLength(0)
  })
})
