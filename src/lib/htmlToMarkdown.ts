import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { isParallelTextTable, unwrapColumns } from './parallelTable'

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})
turndownService.use(gfm)

// mammoth emits <td> header cells wrapped in <p>. turndown-plugin-gfm only
// converts tables whose first row is all <th>, otherwise it keeps them as raw
// HTML. Preprocess: flatten paragraphs inside cells (multi-paragraph cells keep
// line breaks via a {{BR}} sentinel restored to <br> after conversion), and
// promote the first row to a <thead> of <th> so gfm converts the table.
/**
 * Разворачивает двуязычные таблицы «русский | перевод» в последовательный
 * текст по колонкам ещё до turndown: как таблица такой договор читается
 * построчно, вперемешку двумя языками (см. parallelTable.ts).
 *
 * Каждая ячейка становится отдельным блоком <p>, порядок абзацев внутри ячейки
 * сохраняется — то есть текст остаётся ровно тем же, меняется только порядок
 * чтения.
 */
export function unwrapParallelTables(doc: Document): number {
  let unwrapped = 0
  doc.querySelectorAll('table').forEach((table) => {
    const rowElements = Array.from(table.querySelectorAll('tr'))
    const cellsByRow = rowElements.map((row) =>
      Array.from(row.querySelectorAll('td, th')),
    )
    const textRows = cellsByRow.map((cells) => cells.map((c) => c.textContent?.trim() ?? ''))
    if (!isParallelTextTable(textRows)) return

    // Порядок обхода задаётся по тексту, а разметку берём из тех же ячеек:
    // внутри ячейки может быть несколько абзацев, списки, выделения.
    const htmlRows = cellsByRow.map((cells) => cells.map((c) => c.innerHTML))
    const blocks = unwrapColumns(
      textRows.map((row, i) => row.map((_, j) => htmlRows[i][j])),
    )

    const fragment = doc.createDocumentFragment()
    for (const block of blocks) {
      const div = doc.createElement('div')
      div.innerHTML = block
      // Ячейка из mammoth — уже набор <p>; голый текст оборачиваем сами,
      // иначе turndown склеит соседние блоки в один абзац.
      if (!div.querySelector('p, ul, ol, table, h1, h2, h3, h4, h5, h6')) {
        const p = doc.createElement('p')
        p.innerHTML = div.innerHTML
        div.innerHTML = ''
        div.appendChild(p)
      }
      while (div.firstChild) fragment.appendChild(div.firstChild)
    }
    table.replaceWith(fragment)
    unwrapped++
  })
  return unwrapped
}

export function preprocessTableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  unwrapParallelTables(doc)
  doc.querySelectorAll('table').forEach((table) => {
    table.querySelectorAll('td, th').forEach((cell) => {
      const paras = cell.querySelectorAll('p')
      if (paras.length) {
        const parts = Array.from(paras)
          .map((p) => p.innerHTML.trim())
          .filter(Boolean)
        cell.innerHTML = parts.join('{{BR}}')
      }
    })
    if (!table.querySelector('thead')) {
      const firstRow = table.querySelector('tr')
      if (firstRow) {
        firstRow.querySelectorAll('td').forEach((c) => {
          const th = doc.createElement('th')
          th.innerHTML = c.innerHTML
          const colspan = c.getAttribute('colspan')
          if (colspan) th.setAttribute('colspan', colspan)
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
  return turndownService
    .turndown(preprocessTableHtml(html))
    .replace(/\{\{BR\}\}/g, '<br>')
}
