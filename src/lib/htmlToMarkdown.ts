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

// mammoth emits <td> header cells wrapped in <p>. turndown-plugin-gfm only
// converts tables whose first row is all <th>, otherwise it keeps them as raw
// HTML. Promote the first row to a <thead> of <th> so gfm converts the table.
// Keep every child and its ordering; cell conversion handles block boundaries.
export function preprocessTableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('table').forEach((table) => {
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
  return turndownService.turndown(preprocessTableHtml(html))
}
