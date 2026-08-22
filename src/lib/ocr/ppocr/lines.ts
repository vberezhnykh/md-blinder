// Переход от рамок PP-OCR (четырёхугольники, возможно повёрнутые) к общему
// для движков представлению фрагмента текста. Порядок чтения и колонки —
// в ocr/pageText.ts, чтобы Tesseract и PP-OCR собирали страницу одинаково.
import { boxesToText as boxesToPageText, type TextBox } from '../pageText'
import type { Point } from './geometry'

export interface RecognizedBox {
  points: Point[]
  text: string
  confidence: number
}

export function toTextBox(box: RecognizedBox): TextBox {
  const xs = box.points.map((p) => p[0])
  const ys = box.points.map((p) => p[1])
  return {
    text: box.text,
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

export function boxesToText(boxes: RecognizedBox[], tolerance = 0.5): string {
  return boxesToPageText(boxes.map(toTextBox), tolerance)
}
