// Классификация страниц PDF на 'text' (есть текстовый слой) и 'ocr' (скан —
// текстовый слой пуст или почти пуст). Чистая функция: на вход — только числа
// (non-whitespace длина текста страницы), без импортов pdf.js — переиспользуется
// и тестируется без браузера.
export function classifyPdfPages(pageNonWsCounts: number[], threshold = 8): ('text' | 'ocr')[] {
  return pageNonWsCounts.map((count) => (count < threshold ? 'ocr' : 'text'))
}
