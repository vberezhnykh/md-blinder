import { describe, expect, it, vi } from 'vitest'
import { decodeSpans, prepareSpanBatch, type SpanTokenizer } from './glinerSpan'

// Token IDs recorded from the legacy Deberta tokenizer at the pinned model
// revision. These synthetic names exercise Cyrillic and multi-subtoken words.
const ids: Record<string, number[]> = {
  '<<ENT>>': [250103], '<<SEP>>': [250104], person: [2986],
  John: [4041], Smith: [16786], Иван: [30869], Петров: [67960],
  Олена: [984, 20380], Коваленко: [126188, 166581],
}
const tokenizer: SpanTokenizer = { clsId: 1, sepId: 2, encodeWord: (word) => ids[word] ?? [3] }

describe('GLiNER span adapter compatibility', () => {
  it('preserves the legacy prompt, first-subtoken word mask, padding and UTF-16 offsets', () => {
    const batch = prepareSpanBatch(['John Smith', 'Олена Коваленко', 'Иван Петров'], ['person'], tokenizer)
    expect([...batch.inputIds].map(Number)).toEqual([
      1, 250103, 2986, 250104, 4041, 16786, 2, 0, 0,
      1, 250103, 2986, 250104, 984, 20380, 126188, 166581, 2,
      1, 250103, 2986, 250104, 30869, 67960, 2, 0, 0,
    ])
    expect([...batch.wordsMask].map(Number)).toEqual([
      0, 0, 0, 0, 1, 2, 0, 0, 0,
      0, 0, 0, 0, 1, 0, 2, 0, 0,
      0, 0, 0, 0, 1, 2, 0, 0, 0,
    ])
    expect([...batch.attentionMask].map(Number)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 0, 0,
      1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 0, 0,
    ])
    expect(batch.starts).toEqual([[0, 5], [0, 6], [0, 5]])
    expect(batch.ends).toEqual([[4, 10], [5, 15], [4, 11]])
  })

  it('tokenizes repeated prompt words only once per batch', () => {
    const encodeWord = vi.fn(tokenizer.encodeWord)
    prepareSpanBatch(['John Smith', 'John Smith'], ['person'], { ...tokenizer, encodeWord })
    expect(encodeWord).toHaveBeenCalledTimes(5)
  })

  it('does not decode padded spans or widths extending past the source text', () => {
    const texts = ['John', 'Иван Петров']
    const batch = prepareSpanBatch(texts, ['person'], tokenizer)
    const logits = new Float32Array(2 * 2 * 12).fill(-20)
    logits[0] = 5
    logits[1] = 9 // Invalid extension beyond first row's only word.
    logits[12] = 9 // Padded word in the first row.
    logits[25] = 5 // Full valid Russian name in second row.
    const decoded = decodeSpans(logits, batch, texts, ['person'], 0.5)
    expect(decoded.map((row) => row.map(({ spanText, start, end }) => ({ spanText, start, end })))).toEqual([
      [{ spanText: 'John', start: 0, end: 4 }],
      [{ spanText: 'Иван Петров', start: 0, end: 11 }],
    ])
  })

  it('selects the highest-confidence overlap and preserves offsets after astral characters', () => {
    const text = '💻 Иван Петров'
    const batch = prepareSpanBatch([text], ['person'], tokenizer)
    const logits = new Float32Array(3 * 12).fill(-20)
    logits[12] = 3
    logits[13] = 5
    const matches = decodeSpans(logits, batch, [text], ['person'], 0.5)[0]
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ spanText: 'Иван Петров', start: 3, end: 14, label: 'person' })
  })

  it('rejects non-finite or truncated model outputs instead of accepting unsafe matches', () => {
    const batch = prepareSpanBatch(['John Smith'], ['person'], tokenizer)
    for (const invalid of [new Float32Array(24).fill(NaN), new Float32Array(24).fill(Infinity), new Float32Array([5])]) {
      expect(() => decodeSpans(invalid, batch, ['John Smith'], ['person'], 0.5)).toThrow()
    }
  })
})
