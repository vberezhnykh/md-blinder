import { describe, it, expect } from 'vitest'
import { boxesToText, findGutter, groupIntoLines, type TextBox } from './pageText'

function box(text: string, x: number, y: number, w = 60, h = 20): TextBox {
  return { text, left: x, right: x + w, top: y, bottom: y + h }
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

describe('двуязычные колонки', () => {
  const RU = [
    'Настоящий Договор заключён между Сторонами в городе Санкт-Петербурге',
    'и вступает в силу с момента его подписания обеими Сторонами Договора',
    'Исполнитель обязуется оказать услуги в объёме Приложения номер один',
  ]
  const EN = [
    'This Agreement is made by and between the Parties in Saint Petersburg',
    'and shall become effective upon its signature by both Parties hereto',
    'The Contractor shall render the services in the scope of Appendix one',
  ]

  const bilingual = RU.flatMap((ru, i) => [
    box(ru, 20, 20 + i * 40, 420),
    box(EN[i], 560, 22 + i * 40, 420),
  ])

  it('находит жёлоб между колонками', () => {
    expect(findGutter(bilingual)).toBeGreaterThan(440)
    expect(findGutter(bilingual)).toBeLessThan(560)
  })

  it('не находит жёлоб в сплошном тексте', () => {
    const solid = RU.map((ru, i) => box(ru, 20, 20 + i * 40, 960))
    expect(findGutter(solid)).toBeNull()
  })

  it('читает по колонкам: сначала русская версия целиком, потом английская', () => {
    const text = boxesToText(bilingual)
    const lines = text.split('\n')

    expect(lines.slice(0, 3)).toEqual(RU)
    expect(lines.slice(3)).toEqual(EN)
  })

  it('одноязычную таблицу оставляет построчной', () => {
    const table = [
      box('Насос центробежный КМ 80-50-200, четыре штуки, поставка', 20, 20, 420),
      box('212 400,00 рублей включая налог на добавленную стоимость', 560, 20, 420),
      box('Задвижка стальная 30с41нж Ду150, двенадцать штук, склад', 20, 60, 420),
      box('89 750,50 рублей включая налог на добавленную стоимость', 560, 60, 420),
    ]
    const text = boxesToText(table)

    expect(text.split('\n')[0]).toContain('Насос центробежный КМ 80-50-200, четыре штуки, поставка 212 400,00')
  })
})
