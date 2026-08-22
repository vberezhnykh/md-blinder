import { describe, it, expect } from 'vitest'
import { boxesToText, groupIntoLines, type RecognizedBox } from './lines'

function box(text: string, x: number, y: number, w = 60, h = 20): RecognizedBox {
  return {
    text,
    confidence: 0.9,
    points: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  }
}

describe('groupIntoLines', () => {
  it('собирает куски одной строки и сортирует слева направо', () => {
    const lines = groupIntoLines([box('мир', 100, 10), box('привет', 10, 12)])
    expect(lines).toHaveLength(1)
    expect(lines[0].map((b) => b.text)).toEqual(['привет', 'мир'])
  })

  it('разносит разные строки сверху вниз', () => {
    const lines = groupIntoLines([box('вторая', 10, 60), box('первая', 10, 10)])
    expect(lines.map((l) => l[0].text)).toEqual(['первая', 'вторая'])
  })

  it('колонки таблицы остаются одной строкой', () => {
    const lines = groupIntoLines([box('ИНН', 10, 30), box('7701234567', 300, 32)])
    expect(lines).toHaveLength(1)
  })
})

describe('boxesToText', () => {
  it('склеивает куски строки через пробел, строки — через перевод', () => {
    const text = boxesToText([
      box('ИНН', 10, 10),
      box('7701234567', 120, 11),
      box('Договор', 10, 60),
    ])
    expect(text).toBe('ИНН 7701234567\nДоговор')
  })

  it('выбрасывает пустые куски и пустые строки', () => {
    expect(boxesToText([box('  ', 10, 10), box('текст', 10, 60)])).toBe('текст')
  })
})
