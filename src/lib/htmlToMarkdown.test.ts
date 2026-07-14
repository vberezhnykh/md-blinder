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
