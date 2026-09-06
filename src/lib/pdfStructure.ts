// Реконструкция структурированного Markdown из текстового слоя PDF.
// Модуль чистый: на вход — нормализованные текстовые элементы pdf.js
// (см. PdfTextItem), на выход — строка Markdown. Никаких импортов pdf.js —
// это позволяет тестировать логику без браузера/воркера.

export interface PdfTextItem {
  str: string
  x: number // левый край (pdf user space, transform[4])
  y: number // baseline y (transform[5]); БОЛЬШЕ y = выше на странице
  w: number // ширина элемента
  fontSize: number // эффективный размер глифа
  fontName: string
  hasEOL: boolean
}

interface Line {
  text: string
  fontSize: number // максимальный fontSize среди элементов строки
  x0: number // минимальный x
  yTop: number // максимальный y
}

export interface PdfPageLayout {
  bottom: number
  height: number
  pageNumber: number
  totalPages: number
}

const PAGE_NUMBER_RE = /^[\s\-–—]*(\d{1,4})[\s\-–—]*$/
const PAGE_WORD_RE = /^(?:page|страница|сторінка)\s+\d{1,4}(?:\s+(?:of|из|з)\s+\d{1,4})?$/i
const NUMBERED_CLAUSE_RE = /^\d+(?:\.\d+)*\.?\)?\s+\S/
const BULLET_RE = /^[•▪◦‣·]\s+/
const DASH_BULLET_RE = /^[-–—]\s+\S/
const LETTERED_RE = /^\(?[a-z]\)\s+/i
const ROMAN_RE = /^\(?[ivxlcdm]+\)\s+/i

// 1. Определяем "тело" документа — размер шрифта, которым набран основной
// текст. Берём тот округлённый (до 0.5) размер, суммарная длина строк
// которого максимальна.
function detectBodySize(pages: PdfTextItem[][]): number {
  const totals = new Map<number, number>()
  for (const page of pages) {
    for (const item of page) {
      if (!item.str.trim()) continue
      const rounded = Math.round(item.fontSize * 2) / 2
      totals.set(rounded, (totals.get(rounded) ?? 0) + item.str.length)
    }
  }

  let bodySize = 0
  let best = -1
  for (const [size, len] of totals) {
    if (len > best) {
      best = len
      bodySize = size
    }
  }
  return bodySize
}

// 2. Разбиение элементов на визуальные строки С СОХРАНЕНИЕМ порядка pdf.js.
// НЕ пересортировываем глобально по y и НЕ сортируем внутри строки по x: порядок
// от pdf.js уже отражает порядок чтения, а любая пересортировка перемешивает
// двухколоночные блоки (подписи сторон) построчно. Новая строка — когда у
// предыдущего элемента был hasEOL, либо y заметно упал (перевод на строку ниже,
// если pdf.js не выставил hasEOL). Текст строки собираем с учётом пробелов по
// x-зазору между соседними по порядку элементами.
function buildLines(items: PdfTextItem[], bodySize: number): Line[] {
  const rawLines: PdfTextItem[][] = []
  let prev: PdfTextItem | null = null
  for (const item of items) {
    if (!item.str) continue
    const current = rawLines[rawLines.length - 1]
    const breakLine =
      !current ||
      (prev !== null && prev.hasEOL) ||
      (prev !== null && prev.y - item.y > 0.6 * Math.max(bodySize, item.fontSize))
    if (breakLine) rawLines.push([item])
    else current.push(item)
    prev = item
  }

  const lines: Line[] = []
  for (const lineItems of rawLines) {
    let text = ''
    let maxFontSize = 0
    let x0 = Infinity
    let yTop = -Infinity

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i]
      maxFontSize = Math.max(maxFontSize, item.fontSize)
      x0 = Math.min(x0, item.x)
      yTop = Math.max(yTop, item.y)

      if (i === 0) {
        text = item.str
        continue
      }

      const p = lineItems[i - 1]
      const gap = item.x - (p.x + p.w)
      const threshold = 0.25 * Math.max(bodySize, p.fontSize)
      const alreadyHasSpace = /\s$/.test(text) || /^\s/.test(item.str)
      if (gap > threshold && !alreadyHasSpace) {
        text += ' '
      }
      text += item.str
    }

    text = text.replace(/\s+/g, ' ').trim()
    if (!text) continue

    lines.push({ text, fontSize: maxFontSize, x0, yTop })
  }

  return lines
}

// Нормализация строки для сравнения хедеров/футеров: без регистра, без
// ведущих/замыкающих цифр и пробелов (нумерация страниц меняется от страницы
// к странице, но сам текст хедера — нет).
function normalizeForRepeat(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/^[\d\s]+/, '')
    .replace(/[\d\s]+$/, '')
    .trim()
}

// Общее ядро подавления повторяющихся первой/последней строки страницы.
// Параметризовано доступом к тексту, чтобы работать как с внутренним типом
// Line (текстовые PDF), так и с обычными строками (OCR-конвейер).
function suppressRepeatedFirstLast<T>(pagesLines: T[][], getText: (item: T) => string): void {
  const threshold = Math.ceil(pagesLines.length * 0.5)

  const countOccurrences = (pick: (lines: T[]) => T | undefined): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const lines of pagesLines) {
      const line = pick(lines)
      if (!line) continue
      const norm = normalizeForRepeat(getText(line))
      if (!norm) continue
      counts.set(norm, (counts.get(norm) ?? 0) + 1)
    }
    return counts
  }

  const firstCounts = countOccurrences((lines) => lines[0])
  const lastCounts = countOccurrences((lines) => lines[lines.length - 1])

  for (const lines of pagesLines) {
    if (lines.length === 0) continue

    const first = lines[0]
    const firstNorm = normalizeForRepeat(getText(first))
    const dropFirst = firstNorm && (firstCounts.get(firstNorm) ?? 0) >= threshold

    const last = lines[lines.length - 1]
    const lastNorm = normalizeForRepeat(getText(last))
    const dropLast = lines.length > 1 && lastNorm && (lastCounts.get(lastNorm) ?? 0) >= threshold

    // Удаляем с конца, чтобы не сдвинуть индекс первой строки.
    if (dropLast) lines.splice(lines.length - 1, 1)
    if (dropFirst) lines.splice(0, 1)
  }
}

// Without geometry, only an explicit page label at a page boundary is safe
// to remove. A bare number can be an amount or a complete bank account.
function stripExplicitPageLabels<T>(pagesLines: T[][], getText: (item: T) => string): void {
  for (const lines of pagesLines) {
    if (lines.length > 1 && PAGE_WORD_RE.test(getText(lines[lines.length - 1]))) lines.pop()
    if (lines.length > 1 && PAGE_WORD_RE.test(getText(lines[0]))) lines.shift()
  }
}

// 3. Подавление повторяющихся колонтитулов и номеров страниц (текстовый PDF).
function stripHeadersFooters(pagesLines: Line[][], layouts?: PdfPageLayout[]): void {
  for (let pageIndex = 0; pageIndex < pagesLines.length; pageIndex++) {
    const layout = layouts?.[pageIndex]
    if (!layout) continue
    const lines = pagesLines[pageIndex]
    for (const index of [lines.length - 1, 0]) {
      const line = lines[index]
      if (!line || lines.length <= 1) continue
      const match = PAGE_NUMBER_RE.exec(line.text)
      const relativeY = (line.yTop - layout.bottom) / layout.height
      if (match && (relativeY < 0.08 || relativeY > 0.92)
        && Number(match[1]) === layout.pageNumber && Number(match[1]) <= layout.totalPages) {
        lines.splice(index, 1)
      }
    }
  }
  if (pagesLines.length >= 3) suppressRepeatedFirstLast(pagesLines, (l) => l.text)
  stripExplicitPageLabels(pagesLines, (l) => l.text)
}

// Публичный чистый эквивалент для построчного текста (используется OCR-
// конвейером в ocrPdf.ts, где нет координат строк). Числовые строки всегда
// сохраняются: без геометрии нельзя отличить сумму от номера страницы.
export function stripRepeatedLinesAndPageNumbers(pages: string[][]): string[][] {
  const working = pages.map((lines) => [...lines])
  if (working.length >= 3) suppressRepeatedFirstLast(working, (t) => t)
  stripExplicitPageLabels(working, (t) => t)
  return working
}

function isAllCapsShort(text: string): boolean {
  if (text.length > 60) return false
  const hasUpper = /[A-ZА-ЯЁ]/.test(text)
  const hasLower = /[a-zа-яё]/.test(text)
  return hasUpper && !hasLower
}

type Block = string

// 4. Классификация строк и сборка блоков Markdown.
function linesToBlocks(pagesLines: Line[][], bodySize: number): Block[] {
  const blocks: Block[] = []
  let buffer: string[] = []
  let bufferLastLine: Line | null = null

  const flushParagraph = () => {
    if (buffer.length) {
      blocks.push(buffer.join(' '))
      buffer = []
      bufferLastLine = null
    }
  }

  for (const lines of pagesLines) {
    for (const line of lines) {
      const { text } = line

      // Заголовок: заметно крупнее тела ИЛИ короткая строка КАПСОМ.
      const isBigHeading = line.fontSize >= bodySize * 1.15
      if (isBigHeading || isAllCapsShort(text)) {
        flushParagraph()
        let level = '###'
        if (line.fontSize >= bodySize * 1.6) level = '#'
        else if (line.fontSize >= bodySize * 1.3) level = '##'
        else if (!isBigHeading) level = '##' // капс-эвристика на размере тела
        blocks.push(`${level} ${text}`)
        continue
      }

      // Нумерованный пункт — сохраняем как есть, без перенумерации.
      if (NUMBERED_CLAUSE_RE.test(text)) {
        flushParagraph()
        blocks.push(text)
        continue
      }

      // Маркированный список.
      if (BULLET_RE.test(text)) {
        flushParagraph()
        blocks.push(`- ${text.replace(BULLET_RE, '')}`)
        continue
      }
      if (DASH_BULLET_RE.test(text)) {
        flushParagraph()
        blocks.push(`- ${text.replace(/^[-–—]\s+/, '')}`)
        continue
      }

      // Буквенный/римский подпункт — тоже дословно.
      if (LETTERED_RE.test(text) || ROMAN_RE.test(text)) {
        flushParagraph()
        blocks.push(text)
        continue
      }

      // Обычный текст абзаца. Склеиваем строку с буфером только если она идёт
      // СТРОГО НИЖЕ предыдущей (положительный вертикальный зазор в пределах одной
      // межстрочной высоты) И в той же колонке (близкий левый край x0). Гард по
      // колонке не даёт склеить ячейки соседних колонок (подписи сторон), у
      // которых почти одинаковый yTop, но разный x0.
      const vGap = bufferLastLine ? bufferLastLine.yTop - line.yTop : Infinity
      const sameColumn = bufferLastLine ? Math.abs(bufferLastLine.x0 - line.x0) <= 2 * bodySize : false
      const canContinue =
        buffer.length > 0 &&
        bufferLastLine !== null &&
        vGap > 0.2 * bodySize &&
        vGap <= 1.8 * bodySize &&
        sameColumn

      if (canContinue && bufferLastLine) {
        const prevText = buffer[buffer.length - 1]
        const endsHyphenated = /[a-zа-яё][-‐]$/.test(prevText)
        const startsLower = /^[a-zа-яё]/.test(text)
        if (endsHyphenated && startsLower) {
          buffer[buffer.length - 1] = prevText.slice(0, -1) + text
        } else {
          buffer.push(text)
        }
      } else {
        flushParagraph()
        buffer.push(text)
      }
      bufferLastLine = line
    }

    // Абзацы не переносятся через границу страницы.
    flushParagraph()
  }

  flushParagraph()
  return blocks
}

export function itemsToMarkdown(pages: PdfTextItem[][], layouts?: PdfPageLayout[]): string {
  const bodySize = detectBodySize(pages)
  if (bodySize === 0) return ''

  const pagesLines = pages.map((items) => buildLines(items, bodySize))
  stripHeadersFooters(pagesLines, layouts)

  const blocks = linesToBlocks(pagesLines, bodySize)

  return blocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
