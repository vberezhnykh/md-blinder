import { describe, it, expect } from 'vitest'
import { buildCharset, ctcGreedyDecode } from './ctcDecode'

/** Матрица [T, C] с единицей в заданном классе на каждом шаге. */
function logitsFrom(sequence: number[], numClasses: number): Float32Array {
  const out = new Float32Array(sequence.length * numClasses)
  sequence.forEach((cls, t) => {
    out[t * numClasses + cls] = 1
  })
  return out
}

describe('buildCharset', () => {
  it('ставит blank нулевым классом, символы — дальше по порядку', () => {
    const charset = buildCharset('а\nб\nв\n', 4)
    expect(charset).toHaveLength(4)
    expect(charset[0]).toBe('')
    expect(charset.slice(1)).toEqual(['а', 'б', 'в'])
  })

  it('пропускает ведущую пустую строку словаря PaddleOCR', () => {
    // Иначе алфавит съезжает на позицию и весь текст читается «на букву назад».
    const charset = buildCharset('\n!\nа\nб\n', 5)
    expect(charset).toEqual(['', '!', 'а', 'б', ' '])
  })

  it('добавляет пробел в конец, если модель ждёт use_space_char', () => {
    const charset = buildCharset('а\nб\n', 4)
    expect(charset).toEqual(['', 'а', 'б', ' '])
  })

  it('падает, если словарь не сходится с числом классов', () => {
    expect(() => buildCharset('а\nб\n', 9)).toThrow(/Словарь не совпал/)
  })
})

describe('ctcGreedyDecode', () => {
  const charset = ['', 'а', 'б', 'в']

  it('схлопывает повторы и выбрасывает blank', () => {
    const seq = [1, 1, 0, 1, 2, 2, 3]
    const { text } = ctcGreedyDecode(logitsFrom(seq, 4), seq.length, 4, charset)
    expect(text).toBe('аабв')
  })

  it('пустой выход, если все шаги blank', () => {
    const seq = [0, 0, 0]
    const { text, confidence } = ctcGreedyDecode(logitsFrom(seq, 4), seq.length, 4, charset)
    expect(text).toBe('')
    expect(confidence).toBe(0)
  })

  it('считает уверенность как среднее по выбранным символам', () => {
    const numClasses = 4
    const data = new Float32Array(2 * numClasses)
    data[1] = 0.9 // шаг 0, класс 1
    data[numClasses + 2] = 0.5 // шаг 1, класс 2
    const { text, confidence } = ctcGreedyDecode(data, 2, numClasses, charset)
    expect(text).toBe('аб')
    expect(confidence).toBeCloseTo(0.7, 6)
  })
})
