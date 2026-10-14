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

  it('preserves ordered cell content including paragraphs, lists, images and literal sentinels', () => {
    const md = htmlToMarkdown(`<p>Literal {{BR}} outside</p><table><tr><td>Details</td></tr><tr><td>
      <p>Obligations: {{BR}}</p><ul><li>Pay 1000 EUR</li><li>Contact Alice Smith</li></ul>
      <p>After list<br>Second line</p><img src="data:image/png;base64,c3ludGhldGlj" alt="Signature">
    </td></tr></table>`)
    expect(md).toContain('Literal {{BR}} outside')
    expect(md).toContain('Obligations: {{BR}}')
    expect(md).toContain('Pay 1000 EUR')
    expect(md).toContain('Contact Alice Smith')
    expect(md).toContain('After list<br>Second line')
    expect(md).toContain('![Signature](data:image/png;base64,c3ludGhldGlj)')
    const content = md.split('\n').find((line) => line.includes('Obligations:'))!
    expect(content.indexOf('Obligations:')).toBeLessThan(content.indexOf('Pay 1000 EUR'))
    expect(content.indexOf('Contact Alice Smith')).toBeLessThan(content.indexOf('After list'))
    expect(content).toContain('![Signature]')
  })

  it('escapes pipes inside a cell so they do not add extra columns', () => {
    expect(htmlToMarkdown('<table><tr><td><p>A | B</p></td></tr></table>')).toContain('A \\| B')
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

  it('expands a header colspan into empty cells so the header matches the body width', () => {
    const md = htmlToMarkdown(`
      <table>
        <tr><td colspan="2"><p>Wide Header</p></td></tr>
        <tr><td><p>A</p></td><td><p>B</p></td></tr>
      </table>
    `)
    expect(md).not.toContain('<table')
    expect(md).toContain('| Wide Header |  |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| A | B |')
  })

  it('keeps columns aligned under a rowspan cell (mammoth output for a vertical merge)', () => {
    const html = '<table><tr><td><p>r0c0</p></td><td colspan="2"><p>r0c1</p><p>r0c2</p></td></tr>'
      + '<tr><td rowspan="2"><p>r1c0</p><p>r2c0</p></td><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>'
      + '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr></table>'
    const lines = htmlToMarkdown(html).split('\n')
    expect(lines).toEqual([
      '| r0c0 | r0c1<br>r0c2 |  |',
      '| --- | --- | --- |',
      '| r1c0<br>r2c0 | r1c1 | r1c2 |',
      '|  | r2c1 | r2c2 |',
    ])
    expect(preprocessTableHtml(html)).not.toMatch(/colspan|rowspan/)
  })

  it('fills a rowspan in the middle of a row and a block spanning rows and columns', () => {
    const html = '<table><tr><th>A</th><th>B</th><th>C</th></tr>'
      + '<tr><td>a1</td><td rowspan="2" colspan="2">merged</td></tr>'
      + '<tr><td>a2</td></tr>'
      + '<tr><td>a3</td><td>b3</td><td>c3</td></tr></table>'
    expect(htmlToMarkdown(html).split('\n')).toEqual([
      '| A | B | C |',
      '| --- | --- | --- |',
      '| a1 | merged |  |',
      '| a2 |  |  |',
      '| a3 | b3 | c3 |',
    ])
  })

  it('pads short rows and clamps a rowspan that runs past the table', () => {
    const html = '<table><tr><td>H1</td><td>H2</td><td>H3</td></tr>'
      + '<tr><td rowspan="9">x</td><td>y</td></tr></table>'
    expect(htmlToMarkdown(html).split('\n')).toEqual([
      '| H1 | H2 | H3 |',
      '| --- | --- | --- |',
      '| x | y |  |',
    ])
  })

  it('expands spans of a nested table separately from the outer table', () => {
    const html = '<table><tr><td>Outer</td><td>Second</td></tr>'
      + '<tr><td><table><tr><td colspan="2">inner</td></tr><tr><td>i1</td><td>i2</td></tr></table></td><td>o2</td></tr></table>'
    const doc = new DOMParser().parseFromString(preprocessTableHtml(html), 'text/html')
    const outer = doc.querySelector('table')!
    const inner = outer.querySelector('table')!
    expect(inner.querySelectorAll('tr')[0].children).toHaveLength(2)
    expect(Array.from(outer.querySelectorAll('tr')).filter((tr) => tr.closest('table') === outer)
      .map((tr) => tr.children.length)).toEqual([2, 2])
  })
})
