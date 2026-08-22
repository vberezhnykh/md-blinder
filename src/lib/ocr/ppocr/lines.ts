// Сборка распознанных кусков в текст страницы. Детектор возвращает рамки в
// произвольном порядке, а дальше по конвейеру идёт NER по строкам, которому
// нужен нормальный порядок чтения: сверху вниз, слева направо.
import type { Point } from './geometry'

export interface RecognizedBox {
  points: Point[]
  text: string
  confidence: number
}

interface Placed {
  box: RecognizedBox
  top: number
  bottom: number
  left: number
  centerY: number
  height: number
}

function place(box: RecognizedBox): Placed {
  const ys = box.points.map((p) => p[1])
  const xs = box.points.map((p) => p[0])
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return {
    box,
    top,
    bottom,
    left: Math.min(...xs),
    centerY: (top + bottom) / 2,
    height: bottom - top,
  }
}

/**
 * Группирует рамки в строки. Критерий — центр рамки попадает по вертикали
 * внутрь уже набранной строки с допуском в долю её высоты: у одной текстовой
 * строки базовые линии совпадают, а колонки таблицы честно расходятся по X и
 * остаются в той же строке (что правильно — это одна строка таблицы).
 */
export function groupIntoLines(boxes: RecognizedBox[], tolerance = 0.5): RecognizedBox[][] {
  const placed = boxes.map(place).sort((a, b) => a.centerY - b.centerY || a.left - b.left)
  const lines: Placed[][] = []
  for (const item of placed) {
    const current = lines[lines.length - 1]
    if (current) {
      const ref = current[current.length - 1]
      const limit = Math.max(ref.height, item.height) * tolerance
      if (Math.abs(item.centerY - ref.centerY) <= limit) {
        current.push(item)
        continue
      }
    }
    lines.push([item])
  }
  return lines.map((line) => line.sort((a, b) => a.left - b.left).map((p) => p.box))
}

/**
 * Текст страницы. Внутри строки куски разделяются пробелом: детектор режет
 * строку по словам/фрагментам, и без пробела «ИНН» и номер слипаются, что
 * ломает регулярки в детекторах структурных данных.
 */
export function boxesToText(boxes: RecognizedBox[], tolerance = 0.5): string {
  return groupIntoLines(boxes, tolerance)
    .map((line) =>
      line
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
    .join('\n')
}
