import { describe, it, expect } from 'vitest'
import { isParallelTextTable, scriptShare, unwrapColumns } from './parallelTable'

const RU = [
  'Настоящий Договор заключён между Сторонами в городе Санкт-Петербурге и вступает в силу с момента подписания.',
  'Исполнитель обязуется оказать услуги в объёме, предусмотренном Приложением № 1 к настоящему Договору.',
  'Стоимость услуг составляет 1 480 000 рублей, включая налог на добавленную стоимость по ставке 20 процентов.',
]
const EN = [
  'This Agreement is made by and between the Parties in the city of Saint Petersburg and becomes effective upon signature.',
  'The Contractor shall render the services in the scope set out in Appendix No. 1 hereto.',
  'The price of the services amounts to 1,480,000 roubles, including value added tax at the rate of 20 percent.',
]

const bilingual = RU.map((ru, i) => [ru, EN[i]])

describe('scriptShare', () => {
  it('считает долю кириллицы и латиницы среди букв', () => {
    expect(scriptShare('Договор').cyrillic).toBe(1)
    expect(scriptShare('Agreement').latin).toBe(1)
    const mixed = scriptShare('ООО «Alpha»')
    expect(mixed.cyrillic).toBeCloseTo(3 / 8, 6)
    expect(mixed.letters).toBe(8)
  })

  it('не делит на ноль на тексте без букв', () => {
    expect(scriptShare('123 —  №').cyrillic).toBe(0)
  })
})

describe('isParallelTextTable', () => {
  it('узнаёт двуязычную таблицу «русский | перевод»', () => {
    expect(isParallelTextTable(bilingual)).toBe(true)
  })

  it('узнаёт её же в обратном порядке колонок', () => {
    expect(isParallelTextTable(EN.map((en, i) => [en, RU[i]]))).toBe(true)
  })

  it('не трогает обычную таблицу с данными', () => {
    const prices = [
      ['Наименование', 'Стоимость'],
      ['Насос центробежный КМ 80-50-200', '212 400,00'],
      ['Задвижка стальная 30с41нж Ду150', '89 750,50'],
    ]
    expect(isParallelTextTable(prices)).toBe(false)
  })

  it('не трогает одноязычную таблицу из длинных абзацев', () => {
    const ruOnly = RU.map((ru, i) => [ru, RU[(i + 1) % RU.length]])
    expect(isParallelTextTable(ruOnly)).toBe(false)
  })

  it('не трогает таблицу шире двух колонок', () => {
    expect(isParallelTextTable(bilingual.map((row) => [...row, 'третья']))).toBe(false)
  })

  it('не трогает короткие подписи сторон', () => {
    const signatures = [
      ['Заказчик', 'Customer'],
      ['Прокофьев И. В.', 'I. V. Prokofiev'],
    ]
    expect(isParallelTextTable(signatures)).toBe(false)
  })

  it('требует, чтобы колонки были на разных алфавитах', () => {
    const bothMixed = RU.map((ru, i) => [`${ru} ${EN[i]}`, `${EN[i]} ${ru}`])
    expect(isParallelTextTable(bothMixed)).toBe(false)
  })
})

describe('unwrapColumns', () => {
  it('выдаёт сначала левую колонку целиком, потом правую', () => {
    expect(unwrapColumns(bilingual)).toEqual([...RU, ...EN])
  })

  it('пропускает пустые ячейки', () => {
    expect(unwrapColumns([['А', ''], ['', 'B']])).toEqual(['А', 'B'])
  })
})
