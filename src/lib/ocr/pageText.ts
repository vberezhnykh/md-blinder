// Сборка распознанных кусков в текст страницы — общая для обоих OCR-движков.
// И Tesseract, и PP-OCR отдают набор фрагментов с координатами; порядок чтения
// из них надо восстанавливать одинаково, иначе двуязычный договор в одном
// движке читается по колонкам, а в другом поперёк.
import { looksLikeParallelColumns } from '../parallelTable'

export interface TextBox {
  text: string
  left: number
  right: number
  top: number
  bottom: number
}

// Строки в колонке короче, чем ячейка таблицы в docx: колонка договора — это
// ~35 символов в строке. Порог длины здесь только отсекает совсем куцые
// подписи; основную работу делает проверка алфавитов (см. parallelTable.ts).
const COLUMN_OPTIONS = { minAverageCellLength: 20 }

/**
 * Группирует фрагменты в строки. Критерий — центр фрагмента попадает по
 * вертикали внутрь уже набранной строки с допуском в долю её высоты: у одной
 * текстовой строки базовые линии совпадают, а колонки расходятся по X и
 * остаются в той же строке (что правильно для таблицы данных).
 */
export function groupIntoLines(boxes: TextBox[], tolerance = 0.5): TextBox[][] {
  const centerY = (b: TextBox) => (b.top + b.bottom) / 2
  const sorted = [...boxes].sort((a, b) => centerY(a) - centerY(b) || a.left - b.left)
  const lines: TextBox[][] = []
  for (const box of sorted) {
    const current = lines[lines.length - 1]
    if (current) {
      const ref = current[current.length - 1]
      const limit = Math.max(ref.bottom - ref.top, box.bottom - box.top) * tolerance
      if (Math.abs(centerY(box) - centerY(ref)) <= limit) {
        current.push(box)
        continue
      }
    }
    lines.push([box])
  }
  return lines.map((line) => [...line].sort((a, b) => a.left - b.left))
}

/**
 * Ищет вертикальный «жёлоб» — полосу по всей высоте страницы, которую не
 * пересекает ни один фрагмент. Двухколоночная вёрстка (договор с переводом)
 * даёт такой жёлоб; сплошной текст — нет.
 */
export function findGutter(boxes: TextBox[], minRelativeWidth = 0.03): number | null {
  if (boxes.length < 4) return null
  const spans = [...boxes].sort((a, b) => a.left - b.left)

  const pageLeft = spans[0].left
  const pageRight = Math.max(...spans.map((s) => s.right))
  const pageWidth = pageRight - pageLeft
  if (pageWidth <= 0) return null

  let best: { center: number; width: number } | null = null
  let covered = spans[0].right
  for (const span of spans) {
    if (span.left > covered) {
      const width = span.left - covered
      const center = covered + width / 2
      const position = (center - pageLeft) / pageWidth
      // Поля страницы и абзацный отступ тоже дают пустоту, поэтому жёлоб ищем
      // только в середине и требуем заметной ширины.
      if (position > 0.2 && position < 0.8 && width / pageWidth >= minRelativeWidth) {
        if (!best || width > best.width) best = { center, width }
      }
    }
    covered = Math.max(covered, span.right)
  }
  return best?.center ?? null
}

function textOf(lines: TextBox[][]): string {
  return lines
    .map((line) => line.map((b) => b.text.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n')
}

function splitIntoColumns(
  lines: TextBox[][],
  boxes: TextBox[],
): { left: TextBox[][]; right: TextBox[][] } | null {
  const gutter = findGutter(boxes)
  if (gutter === null) return null

  const isLeft = (box: TextBox) => (box.left + box.right) / 2 < gutter
  const left = lines.map((line) => line.filter(isLeft)).filter((l) => l.length)
  const right = lines.map((line) => line.filter((b) => !isLeft(b))).filter((l) => l.length)
  if (left.length === 0 || right.length === 0) return null

  const leftText = textOf(left)
  const rightText = textOf(right)
  const averageBlockLength =
    (leftText.length + rightText.length) / Math.max(left.length + right.length, 1)

  return looksLikeParallelColumns(leftText, rightText, averageBlockLength, COLUMN_OPTIONS)
    ? { left, right }
    : null
}

/**
 * Текст страницы. Внутри строки куски разделяются пробелом: детектор режет
 * строку по словам/фрагментам, и без пробела «ИНН» и номер слипаются, что
 * ломает регулярки в детекторах структурных данных.
 *
 * Двухколоночный двуязычный договор читается по колонкам, а не построчно:
 * иначе в одной строке оказываются обе языковые версии вперемешку, предложения
 * рвутся, и NER работает по обрывкам. Признак «это перевод, а не таблица
 * данных» — общий с docx-конвейером, см. parallelTable.ts.
 */
export function boxesToText(boxes: TextBox[], tolerance = 0.5): string {
  const lines = groupIntoLines(boxes, tolerance)
  const columns = splitIntoColumns(lines, boxes)
  return columns ? `${textOf(columns.left)}\n${textOf(columns.right)}` : textOf(lines)
}
