// Общая обвязка над Tesseract.js: распознавание страницы и приведение его
// строк к TextBox. Живёт отдельно от ocrPdf.ts, чтобы бенчмарк (ocr/bench.ts)
// мерил ровно тот же путь, каким страницу читает приложение.
import type { Page, Worker } from 'tesseract.js'
import { boxesToText, type TextBox } from './pageText'

/**
 * Слова Tesseract (blocks -> paragraphs -> lines -> words) в общем виде TextBox.
 *
 * Именно слова, а не строки: на двухколоночном договоре Tesseract сам считает
 * строкой всю ширину страницы — русский пункт и его перевод вместе, — и рамка
 * такой «строки» перекрывает жёлоб между колонками. По словам жёлоб виден, и
 * дальше страница собирается тем же кодом, что и для PP-OCR.
 */
export function tesseractWordBoxes(blocks: Page['blocks']): TextBox[] {
  const boxes: TextBox[] = []
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text.trim()
          if (!text) continue
          boxes.push({
            text,
            left: word.bbox.x0,
            right: word.bbox.x1,
            top: word.bbox.y0,
            bottom: word.bbox.y1,
          })
        }
      }
    }
  }
  return boxes
}

/**
 * Распознаёт страницу и собирает текст в порядке чтения.
 *
 * blocks запрашиваются ради координат: готовый data.text склеен в порядке
 * самого Tesseract, а на двухколоночном договоре он читает поперёк —
 * «ДОГОВОР ПОСТАВКИ SUPPLY AGREEMENT». Порядок собираем сами, тем же кодом,
 * что и для PP-OCR (см. pageText.ts). Если координат вдруг нет, откатываемся
 * на исходный текст движка.
 */
export async function recognizePageWithTesseract(
  worker: Worker,
  canvas: HTMLCanvasElement,
): Promise<string> {
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })
  const boxes = tesseractWordBoxes(data.blocks)
  return boxes.length > 0 ? boxesToText(boxes) : data.text
}
