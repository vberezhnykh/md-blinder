// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { htmlToMarkdown, preprocessTableHtml } from './htmlToMarkdown'

describe('htmlToMarkdown', () => {
  it('converts a mammoth-style table with <td><p>…</p></td> header cells to a GFM table with a header row', () => {
    const html = `
      <table>
        <tr>
          <td><p>Name</p></td>
          <td><p>Age</p></td>
        </tr>
        <tr>
          <td><p>Alice</p></td>
          <td><p>30</p></td>
        </tr>
      </table>
    `
    const md = htmlToMarkdown(html)

    expect(md).toContain('| Name | Age |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| Alice | 30 |')
  })

  it('joins a multi-paragraph cell with <br>', () => {
    const html = `
      <table>
        <tr>
          <td><p>Header</p></td>
        </tr>
        <tr>
          <td><p>A</p><p>B</p></td>
        </tr>
      </table>
    `
    const md = htmlToMarkdown(html)

    expect(md).toContain('A<br>B')
  })

  it('still converts a table that already has a <thead>', () => {
    const html = `
      <table>
        <thead>
          <tr><th>Name</th><th>Age</th></tr>
        </thead>
        <tbody>
          <tr><td>Bob</td><td>25</td></tr>
        </tbody>
      </table>
    `
    const md = htmlToMarkdown(html)

    expect(md).toContain('| Name | Age |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| Bob | 25 |')
  })

  it('keeps colspan on a header cell when promoting <td> to <th>', () => {
    // GFM markdown tables have no colspan syntax, so the attribute can't
    // survive into the final markdown string — assert directly on the
    // preprocessed HTML, where the promoted <th> should retain it.
    const html = `
      <table>
        <tr>
          <td colspan="2"><p>Wide Header</p></td>
        </tr>
        <tr>
          <td><p>A</p></td>
          <td><p>B</p></td>
        </tr>
      </table>
    `
    const preprocessed = preprocessTableHtml(html)

    expect(preprocessed).toContain('colspan="2"')
    const doc = new DOMParser().parseFromString(preprocessed, 'text/html')
    const th = doc.querySelector('thead th')
    expect(th?.getAttribute('colspan')).toBe('2')
    expect(th?.textContent?.trim()).toBe('Wide Header')

    // Conversion itself still succeeds (doesn't fall back to raw HTML).
    const md = htmlToMarkdown(html)
    expect(md).toContain('Wide Header')
    expect(md).not.toContain('<table')
  })
})

describe('двуязычные таблицы', () => {
  const bilingualHtml = `
    <table>
      <tr>
        <td><p>Настоящий Договор заключён между Сторонами в городе Санкт-Петербурге и вступает в силу с момента подписания обеими Сторонами.</p></td>
        <td><p>This Agreement is made by and between the Parties in the city of Saint Petersburg and becomes effective upon signature by both Parties.</p></td>
      </tr>
      <tr>
        <td><p>1. Исполнитель обязуется оказать услуги в объёме, предусмотренном Приложением № 1.</p><p>Срок — до 28 апреля 2026 года.</p></td>
        <td><p>1. The Contractor shall render the services in the scope set out in Appendix No. 1.</p><p>Deadline — 28 April 2026.</p></td>
      </tr>
    </table>
  `

  it('разворачивает таблицу «русский | перевод» по колонкам, а не по строкам', () => {
    const md = htmlToMarkdown(bilingualHtml)

    expect(md).not.toContain('|')
    const ruIndex = md.indexOf('Срок — до 28 апреля 2026 года.')
    const enIndex = md.indexOf('This Agreement is made')
    // Вся русская версия идёт до начала английской.
    expect(ruIndex).toBeGreaterThan(-1)
    expect(enIndex).toBeGreaterThan(ruIndex)
  })

  it('сохраняет абзацы внутри ячейки отдельными блоками', () => {
    const md = htmlToMarkdown(bilingualHtml)

    // turndown экранирует «1.» в начале абзаца, чтобы не получился список.
    expect(md).toContain('1\\. Исполнитель обязуется оказать услуги')
    expect(md).toContain('\n\nСрок — до 28 апреля 2026 года.')
    expect(md).toContain('\n\nDeadline — 28 April 2026.')
  })

  it('обычную таблицу с данными оставляет таблицей', () => {
    const md = htmlToMarkdown(`
      <table>
        <tr><td><p>Наименование</p></td><td><p>Стоимость</p></td></tr>
        <tr><td><p>Насос центробежный КМ 80-50-200</p></td><td><p>212 400,00</p></td></tr>
      </table>
    `)

    expect(md).toContain('| Наименование | Стоимость |')
    expect(md).toContain('| Насос центробежный КМ 80-50-200 | 212 400,00 |')
  })
})
