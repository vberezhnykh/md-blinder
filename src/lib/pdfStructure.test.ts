import { describe, it, expect } from 'vitest'
import { itemsToMarkdown, stripRepeatedLinesAndPageNumbers, type PdfTextItem } from './pdfStructure'

// Синтетические данные: никаких реальных имён/адресов, только заглушки
// вида "Section One", "Company Alpha", "12 Example Street".
//
// Разбиение на строки теперь управляется hasEOL и падением y (порядок pdf.js
// сохраняется, без глобальной пересортировки). Поэтому в тестах последний
// элемент каждой намеренной строки помечаем hasEOL: true.

const BODY_SIZE = 10

function makeItem(overrides: Partial<PdfTextItem> = {}): PdfTextItem {
  return {
    str: 'text',
    x: 0,
    y: 0,
    w: 20,
    fontSize: BODY_SIZE,
    fontName: 'F1',
    hasEOL: false,
    ...overrides,
  }
}

describe('itemsToMarkdown: body size & heading levels', () => {
  it('detects body size from the longest total run and levels headings relative to it', () => {
    const pages: PdfTextItem[][] = [
      [
        makeItem({ str: 'Title Sixteen', x: 0, y: 300, w: 100, fontSize: BODY_SIZE * 1.6, hasEOL: true }),
        makeItem({ str: 'Heading Thirteen', x: 0, y: 260, w: 100, fontSize: BODY_SIZE * 1.3, hasEOL: true }),
        makeItem({ str: 'Heading Twelve', x: 0, y: 220, w: 100, fontSize: BODY_SIZE * 1.2, hasEOL: true }),
        // Тело документа: длинный текст на BODY_SIZE, чтобы его суммарная
        // длина строк перевесила заголовки и определила bodySize = 10.
        makeItem({
          str: 'This is the body paragraph text of the sample contract document repeated for length.',
          x: 0,
          y: 180,
          w: 400,
          fontSize: BODY_SIZE,
          hasEOL: true,
        }),
      ],
    ]

    const md = itemsToMarkdown(pages)

    expect(md).toContain('# Title Sixteen')
    expect(md).toContain('## Heading Thirteen')
    expect(md).toContain('### Heading Twelve')
  })
})

describe('itemsToMarkdown: line assembly', () => {
  it('joins two in-order same-line items with a space and starts a new line after hasEOL', () => {
    const pages: PdfTextItem[][] = [
      [
        // Одна строка: два элемента по возрастанию x с широким зазором, без hasEOL
        // между ними -> склеиваются через пробел.
        makeItem({ str: 'Section', x: 0, y: 300, w: 50, fontSize: BODY_SIZE, hasEOL: false }),
        makeItem({ str: 'One', x: 100, y: 300, w: 30, fontSize: BODY_SIZE, hasEOL: true }),
        // Следующая строка: hasEOL предыдущего элемента и падение y начинают новую.
        makeItem({
          str: 'Company Alpha agreement text goes here for padding purposes only today.',
          x: 0,
          y: 260,
          w: 300,
          fontSize: BODY_SIZE,
          hasEOL: true,
        }),
      ],
    ]

    const md = itemsToMarkdown(pages)
    const blocks = md.split('\n\n')

    expect(blocks[0]).toBe('Section One')
    expect(blocks[1]).toContain('Company Alpha agreement')
  })
})

describe('itemsToMarkdown: all-caps short heading', () => {
  it('treats a short all-caps line at body size as a level-2 heading', () => {
    const pages: PdfTextItem[][] = [
      [
        makeItem({ str: 'GENERAL PROVISIONS', x: 0, y: 300, w: 120, fontSize: BODY_SIZE, hasEOL: true }),
        makeItem({
          str: 'This paragraph explains general provisions of the sample contract for testing purposes.',
          x: 0,
          y: 260,
          w: 400,
          fontSize: BODY_SIZE,
          hasEOL: true,
        }),
      ],
    ]

    const md = itemsToMarkdown(pages)
    expect(md).toContain('## GENERAL PROVISIONS')
  })
})

describe('itemsToMarkdown: clauses and bullets', () => {
  it('keeps a numbered clause verbatim instead of renumbering it as a list', () => {
    const pages: PdfTextItem[][] = [
      [
        makeItem({
          str: '2.1 The parties agree to the terms outlined in this sample section below.',
          x: 0,
          y: 300,
          w: 400,
          fontSize: BODY_SIZE,
          hasEOL: true,
        }),
        makeItem({
          str: 'This body paragraph follows the clause and is padded with extra sample words.',
          x: 0,
          y: 260,
          w: 400,
          fontSize: BODY_SIZE,
          hasEOL: true,
        }),
      ],
    ]

    const md = itemsToMarkdown(pages)
    expect(md).toContain('2.1 The parties agree to the terms outlined in this sample section below.')
    expect(md).not.toContain('1. 2.1')
  })

  it('converts a bullet-glyph line into a markdown list item', () => {
    const pages: PdfTextItem[][] = [
      [
        makeItem({
          str: '• Foo bar sample bullet item for the synthetic contract test.',
          x: 0,
          y: 300,
          w: 400,
          fontSize: BODY_SIZE,
          hasEOL: true,
        }),
      ],
    ]

    const md = itemsToMarkdown(pages)
    expect(md).toContain('- Foo bar sample bullet item for the synthetic contract test.')
  })

  it('keeps a lettered sub-clause verbatim', () => {
    const pages: PdfTextItem[][] = [
      [
        makeItem({
          str: '(a) Foo bar sample lettered sub-clause for the synthetic contract test.',
          x: 0,
          y: 300,
          w: 400,
          fontSize: BODY_SIZE,
          hasEOL: true,
        }),
      ],
    ]

    const md = itemsToMarkdown(pages)
    expect(md).toContain('(a) Foo bar sample lettered sub-clause for the synthetic contract test.')
  })
})

describe('itemsToMarkdown: paragraph merging', () => {
  it('merges two stacked same-column lines and starts a new block after a large y-gap', () => {
    const pages: PdfTextItem[][] = [
      [
        makeItem({ str: 'First line of a sample paragraph about Company Alpha and its obligations.', x: 0, y: 300, w: 400, fontSize: BODY_SIZE, hasEOL: true }),
        makeItem({ str: 'continues here with more sample padding words for the test paragraph text.', x: 0, y: 288, w: 400, fontSize: BODY_SIZE, hasEOL: true }),
        // Большой разрыв по y (> 1.8*body) -> новый блок.
        makeItem({ str: 'A separate paragraph far below the first one in the sample document text.', x: 0, y: 200, w: 400, fontSize: BODY_SIZE, hasEOL: true }),
      ],
    ]

    const md = itemsToMarkdown(pages)
    const blocks = md.split('\n\n')

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe(
      'First line of a sample paragraph about Company Alpha and its obligations. continues here with more sample padding words for the test paragraph text.',
    )
    expect(blocks[1]).toBe('A separate paragraph far below the first one in the sample document text.')
  })

  it('does NOT merge two lines at the same yTop but different x0 (adjacent columns)', () => {
    const pages: PdfTextItem[][] = [
      [
        makeItem({ str: 'Left column body cell text for the sample contract padding here.', x: 0, y: 300, w: 200, fontSize: BODY_SIZE, hasEOL: true }),
        makeItem({ str: 'Right column body cell text for the sample contract padding here.', x: 300, y: 300, w: 200, fontSize: BODY_SIZE, hasEOL: true }),
      ],
    ]

    const md = itemsToMarkdown(pages)
    const blocks = md.split('\n\n')

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe('Left column body cell text for the sample contract padding here.')
    expect(blocks[1]).toBe('Right column body cell text for the sample contract padding here.')
  })
})

describe('itemsToMarkdown: two-column non-interleave regression', () => {
  it('does not interleave left and right column cells that share a y (signature block)', () => {
    // Порядок как у pdf.js: ячейка левой колонки, затем правой, построчно; строки
    // делят одну y. Старый код (глобальная сортировка по y, затем по x) склеивал
    // левую и правую ячейку в одну строку -> "PhoneMarker" оказывался между
    // токенами левой колонки. Порядок-сохраняющий разбор должен держать колонки
    // раздельно (каждая ячейка заканчивается hasEOL).
    const pages: PdfTextItem[][] = [
      [
        // Строка 1, y = 200
        makeItem({ str: 'Company', x: 50, y: 200, w: 45, hasEOL: false }),
        makeItem({ str: 'Alpha', x: 100, y: 200, w: 35, hasEOL: true }),
        makeItem({ str: 'PhoneMarker', x: 300, y: 200, w: 70, hasEOL: false }),
        makeItem({ str: 'One', x: 375, y: 200, w: 25, hasEOL: true }),
        // Строка 2, y = 185
        makeItem({ str: 'Party', x: 50, y: 185, w: 45, hasEOL: false }),
        makeItem({ str: 'Beta', x: 100, y: 185, w: 35, hasEOL: true }),
        makeItem({ str: 'EmailMarker', x: 300, y: 185, w: 70, hasEOL: false }),
        makeItem({ str: 'Two', x: 375, y: 185, w: 25, hasEOL: true }),
      ],
    ]

    const md = itemsToMarkdown(pages)
    const blocks = md.split('\n\n')

    // Левые ячейки остаются целыми и отдельными от правых.
    expect(blocks).toContain('Company Alpha')
    expect(blocks).toContain('PhoneMarker One')
    // Ни один блок/строка не смешивает токены разных колонок.
    for (const b of blocks) {
      expect(b.includes('Company') && b.includes('PhoneMarker')).toBe(false)
      expect(b.includes('Party') && b.includes('EmailMarker')).toBe(false)
    }
    // Правый токен не встроен между токенами левой колонки.
    expect(md).not.toMatch(/Company[^\n]*PhoneMarker[^\n]*Alpha/)
  })
})

describe('itemsToMarkdown: header/footer and page-number suppression', () => {
  it('drops a first line repeated across pages and a pure page-number line', () => {
    const makePage = (n: number): PdfTextItem[] => [
      makeItem({ str: 'Sample Contract Header', x: 0, y: 300, w: 200, fontSize: BODY_SIZE, hasEOL: true }),
      makeItem({
        str: `Body paragraph number ${n} for the synthetic sample contract padding text goes here.`,
        x: 0,
        y: 260,
        w: 400,
        fontSize: BODY_SIZE,
        hasEOL: true,
      }),
      makeItem({ str: String(n), x: 0, y: 20, w: 10, fontSize: BODY_SIZE, hasEOL: true }),
    ]

    const pages: PdfTextItem[][] = [makePage(1), makePage(2), makePage(3)]

    const md = itemsToMarkdown(pages, [1, 2, 3].map((pageNumber) => ({ bottom: 0, height: 320, pageNumber, totalPages: 3 })))

    expect(md).not.toContain('Sample Contract Header')
    expect(md).toContain('Body paragraph number 1')
    expect(md).toContain('Body paragraph number 2')
    expect(md).toContain('Body paragraph number 3')
    // Номера страниц не должны появляться как самостоятельные блоки.
    const blocks = md.split('\n\n')
    expect(blocks.some((b) => /^\d+$/.test(b))).toBe(false)
  })
})

describe('itemsToMarkdown: edge cases', () => {
  it('returns an empty string when there are no items', () => {
    expect(itemsToMarkdown([])).toBe('')
    expect(itemsToMarkdown([[]])).toBe('')
  })
})

describe('stripRepeatedLinesAndPageNumbers', () => {
  it('preserves amounts, bank accounts and page-like text in the body of OCR output', () => {
    const lines = ['Bank account:', '40702810900000012345', 'Payment amount:', '50000', 'Page 3 describes payment.', 'End of contract.']
    expect(stripRepeatedLinesAndPageNumbers([lines])).toEqual([lines])
    const numberedBody = ['Intro', '1', 'Page 2', 'Closing']
    expect(stripRepeatedLinesAndPageNumbers([numberedBody])).toEqual([numberedBody])
  })

  it('keeps numeric body lines even when their value matches a physical page number', () => {
    const page = ['Payment amount:', '1', '50000', '40702810900000012345', 'Closing.'].map((str, i) =>
      makeItem({ str, y: 600 - i * 30, hasEOL: true }),
    )
    const md = itemsToMarkdown([page], [{ bottom: 0, height: 800, pageNumber: 1, totalPages: 1 }])
    expect(md.split('\n\n')).toContain('1')
    expect(md).toContain('50000')
    expect(md).toContain('40702810900000012345')
  })

  it('keeps an amount at the page edge if it does not match the page index', () => {
    const page = [makeItem({ str: 'Amount payable', y: 100, hasEOL: true }), makeItem({ str: '5000', y: 20 })]
    expect(itemsToMarkdown([page], [{ bottom: 0, height: 800, pageNumber: 1, totalPages: 1 }])).toContain('5000')
  })
  it('drops repeated headers and explicit page labels, preserving unlocated numeric values', () => {
    const pages = [
      ['Sample Contract Header', 'Body paragraph number 1 for the synthetic sample text.', '12'],
      ['Sample Contract Header', 'Body paragraph number 2 for the synthetic sample text.', 'Page 3'],
      ['Sample Contract Header', 'Body paragraph number 3 for the synthetic sample text.', '14'],
    ]

    const result = stripRepeatedLinesAndPageNumbers(pages)

    expect(result).toEqual([
      ['Body paragraph number 1 for the synthetic sample text.', '12'],
      ['Body paragraph number 2 for the synthetic sample text.'],
      ['Body paragraph number 3 for the synthetic sample text.', '14'],
    ])
  })

  it('with fewer than 3 pages drops only explicit boundary labels and does not suppress repeats', () => {
    const pages = [
      ['Sample Contract Header', 'Body paragraph one for the synthetic sample text.', '1'],
      ['Sample Contract Header', 'Body paragraph two for the synthetic sample text.', 'Page 2'],
    ]

    const result = stripRepeatedLinesAndPageNumbers(pages)

    // Repeated header stays (only >=3 pages triggers repeat-suppression)...
    expect(result[0]).toEqual(['Sample Contract Header', 'Body paragraph one for the synthetic sample text.', '1'])
    expect(result[1]).toEqual(['Sample Contract Header', 'Body paragraph two for the synthetic sample text.'])
    // Bare numbers need geometry to distinguish page numbers from amounts.
    expect(result[0]).toContain('1')
    expect(result.flat()).not.toContain('Page 2')
  })

  it('does not mutate the input arrays', () => {
    const pages = [['Header', 'Body one.'], ['Header', 'Body two.'], ['Header', 'Body three.']]
    const snapshot = pages.map((p) => [...p])

    stripRepeatedLinesAndPageNumbers(pages)

    expect(pages).toEqual(snapshot)
  })
})
