import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

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
export function preprocessTableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
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
