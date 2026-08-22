// Двуязычные договоры почти всегда свёрстаны таблицей в две колонки: слева
// русский текст пункта, справа его перевод. Как таблица это читается построчно
// («Настоящий Договор заключён | This Agreement is made»), и получается каша:
// в одной строке два языка, предложения оборваны, NER работает по обрывкам.
//
// Здесь такие таблицы распознаются и разворачиваются по колонкам: сначала
// целиком одна языковая версия, потом другая. Обычные таблицы (цены, реквизиты,
// спецификации) не трогаем — для них построчный порядок и есть правильный.

const CYRILLIC_RE = /[Ѐ-ӿ]/g
const LATIN_RE = /[A-Za-z]/g

export interface ScriptShare {
  cyrillic: number
  latin: number
  letters: number
}

export function scriptShare(text: string): ScriptShare {
  const cyrillic = text.match(CYRILLIC_RE)?.length ?? 0
  const latin = text.match(LATIN_RE)?.length ?? 0
  const letters = cyrillic + latin
  return {
    cyrillic: letters === 0 ? 0 : cyrillic / letters,
    latin: letters === 0 ? 0 : latin / letters,
    letters,
  }
}

export interface ParallelTableOptions {
  /** Минимальная средняя длина ячейки — отсекает таблицы-справочники. */
  minAverageCellLength?: number
  /** Минимальная доля «своего» алфавита в колонке. */
  minScriptShare?: number
  /** Минимум букв в колонке, иначе судить не о чем. */
  minLetters?: number
}

const DEFAULTS: Required<ParallelTableOptions> = {
  minAverageCellLength: 40,
  minScriptShare: 0.7,
  minLetters: 80,
}

/**
 * Две ли это параллельные языковые версии одного текста.
 *
 * Опознаём по языку колонок, а не по одной лишь геометрии: «Наименование |
 * Стоимость» — тоже две колонки, но разворачивать её по столбцам было бы
 * порчей документа. А вот колонка на кириллице напротив колонки на латинице,
 * обе с длинными кусками текста, — это именно перевод.
 *
 * Общая точка для всех трёх конвейеров: docx (таблица), текстовый PDF
 * (колонки на странице) и OCR (колонки, найденные по рамкам строк).
 */
export function looksLikeParallelColumns(
  leftText: string,
  rightText: string,
  averageBlockLength: number,
  options: ParallelTableOptions = {},
): boolean {
  const { minAverageCellLength, minScriptShare, minLetters } = { ...DEFAULTS, ...options }
  if (averageBlockLength < minAverageCellLength) return false

  const left = scriptShare(leftText)
  const right = scriptShare(rightText)
  if (left.letters < minLetters || right.letters < minLetters) return false

  return (
    (left.cyrillic >= minScriptShare && right.latin >= minScriptShare) ||
    (left.latin >= minScriptShare && right.cyrillic >= minScriptShare)
  )
}

/** Двуязычная ли это таблица параллельного текста (docx-конвейер). */
export function isParallelTextTable(
  rows: string[][],
  options: ParallelTableOptions = {},
): boolean {
  if (rows.length < 2) return false
  if (!rows.every((row) => row.length === 2)) return false

  const cells = rows.flat().filter((c) => c.trim() !== '')
  if (cells.length === 0) return false
  const averageLength = cells.reduce((sum, c) => sum + c.length, 0) / cells.length

  return looksLikeParallelColumns(
    rows.map((row) => row[0]).join('\n'),
    rows.map((row) => row[1]).join('\n'),
    averageLength,
    options,
  )
}

/**
 * Разворачивает таблицу в порядок «сначала левая колонка сверху вниз, потом
 * правая». Заголовочная строка (если она есть) остаётся первой в своей
 * колонке — она такая же часть языковой версии, как и всё остальное.
 */
export function unwrapColumns(rows: string[][]): string[] {
  const columns: string[] = []
  for (let col = 0; col < 2; col++) {
    for (const row of rows) {
      const cell = row[col]?.trim()
      if (cell) columns.push(cell)
    }
  }
  return columns
}
