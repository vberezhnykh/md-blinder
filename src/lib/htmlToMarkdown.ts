import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})
turndownService.use(gfm)

// Markdown tables cannot contain physical line breaks. Let Turndown convert
// every child (including lists and images), then flatten only the resulting
// cell boundaries. No text sentinel is needed, so literal {{BR}} is untouched.
turndownService.addRule('tableCellContent', {
  filter: ['td', 'th'],
  replacement(content, node) {
    const value = content.trim().replace(/\r?\n\s*\n?/g, '<br>').replace(/\|/g, '\\|')
    const first = node.parentNode?.firstChild === node
    return `${first ? '| ' : ' '}${value} |`
  },
})

turndownService.addRule('tableLineBreak', {
  filter: (node) => node.nodeName === 'BR' && !!node.closest('td, th'),
  replacement: () => '<br>',
})

// Ограничение на colspan/rowspan: защита от испорченного документа с огромным
// значением, которое иначе раздует таблицу.
const MAX_SPAN = 1000

function spanOf(cell: Element, attr: 'colspan' | 'rowspan', fallback: number): number {
  const raw = Number.parseInt(cell.getAttribute(attr) ?? '', 10)
  if (Number.isNaN(raw) || raw < 0) return 1
  // rowspan="0" по стандарту тянется до конца таблицы.
  if (raw === 0) return fallback
  return Math.min(raw, MAX_SPAN)
}

function ownRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table)
}

function ownCells(row: Element): Element[] {
  return Array.from(row.children).filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH')
}

// В таблице Markdown нет объединенных ячеек. Объединение раскладывается в
// полную сетку: значение остается в первой ячейке, а покрытые ею места
// заполняются пустыми ячейками. Без этого строка под ячейкой с rowspan теряет
// столбец, и ее значения сдвигаются влево. Короткие строки дополняются до
// ширины таблицы.
function expandSpans(doc: Document, table: Element) {
  const rows = ownRows(table)
  // occupied[r] — столбцы строки r, занятые ячейками с rowspan из строк выше.
  const occupied: Set<number>[] = rows.map(() => new Set())
  rows.forEach((row, r) => {
    let col = 0
    const fill = (before: Element | null, tag: string) => {
      while (occupied[r].has(col)) {
        row.insertBefore(doc.createElement(tag), before)
        col += 1
      }
    }
    for (const cell of ownCells(row)) {
      const tag = cell.nodeName.toLowerCase()
      fill(cell, tag)
      const colspan = spanOf(cell, 'colspan', 1)
      const rowspan = Math.min(spanOf(cell, 'rowspan', rows.length - r), rows.length - r)
      cell.removeAttribute('colspan')
      cell.removeAttribute('rowspan')
      for (let dr = 1; dr < rowspan; dr += 1) {
        for (let dc = 0; dc < colspan; dc += 1) occupied[r + dr].add(col + dc)
      }
      for (let dc = 1; dc < colspan; dc += 1) row.insertBefore(doc.createElement(tag), cell.nextSibling)
      col += colspan
    }
    const lastTag = ownCells(row).at(-1)?.nodeName.toLowerCase() ?? 'td'
    fill(null, lastTag)
  })
  const width = Math.max(0, ...rows.map((row) => ownCells(row).length))
  for (const row of rows) {
    const cells = ownCells(row)
    const tag = cells.at(-1)?.nodeName.toLowerCase() ?? 'td'
    for (let i = cells.length; i < width; i += 1) row.appendChild(doc.createElement(tag))
  }
}

// mammoth emits <td> header cells wrapped in <p>. turndown-plugin-gfm only
// converts tables whose first row is all <th>, otherwise it keeps them as raw
// HTML. Promote the first row to a <thead> of <th> so gfm converts the table.
// Keep every child and its ordering; cell conversion handles block boundaries.
export function preprocessTableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('table').forEach((table) => {
    expandSpans(doc, table)
    if (!table.querySelector('thead')) {
      const firstRow = table.querySelector('tr')
      if (firstRow) {
        firstRow.querySelectorAll('td').forEach((c) => {
          const th = doc.createElement('th')
          th.innerHTML = c.innerHTML
          c.replaceWith(th)
        })
        const thead = doc.createElement('thead')
        thead.appendChild(firstRow)
        table.insertBefore(thead, table.firstChild)
      }
    }
  })
  return doc.body.innerHTML
}

export function htmlToMarkdown(html: string): string {
  return turndownService.turndown(preprocessTableHtml(html))
}
