import { WORD_RE } from './chunkText'
import type { EntityType, RawMatch } from '../lib/anonymize/types'

// Чистая логика планирования NER-батчей: дедуп идентичных чанков + сортировка
// по длине перед нарезкой на батчи. Никакого импорта gliner — тестируется без
// модели.

export interface Chunk {
  text: string
  base: number
}

// Считает «слова» тем же регекспом, что использует (пропатченный)
// словоделитель gliner (см. WORD_RE в chunkText.ts), чтобы сортировка по
// длине отражала реальную нагрузку на модель (O(words²)-ish), а не просто
// длину строки в символах.
export function countWords(text: string): number {
  let count = 0
  WORD_RE.lastIndex = 0
  while (WORD_RE.exec(text)) count++
  return count
}

export interface PlanResult {
  batches: string[][]
  occurrences: Map<string, Chunk[]>
}

// Группирует чанки по ТОЧНОМУ тексту (без trim/нормализации — это другой вход
// модели) — типовые повторяющиеся фрагменты договора гоняются через
// инференс один раз, результат размножается на все вхождения. Уникальные
// тексты сортируются по числу слов по возрастанию (вторично — по длине
// строки, для стабильности при равном числе слов), чтобы внутри батча было
// меньше паддинга до самого длинного чанка. Сортировка стабильна, поэтому
// результат детерминирован.
export function planBatches(chunks: Chunk[], batchSize: number): PlanResult {
  const occurrences = new Map<string, Chunk[]>()
  for (const chunk of chunks) {
    const list = occurrences.get(chunk.text)
    if (list) list.push(chunk)
    else occurrences.set(chunk.text, [chunk])
  }

  const uniqueTexts = [...occurrences.keys()].sort((a, b) => {
    const wa = countWords(a)
    const wb = countWords(b)
    if (wa !== wb) return wa - wb
    return a.length - b.length
  })

  const batches: string[][] = []
  for (let i = 0; i < uniqueTexts.length; i += batchSize) {
    batches.push(uniqueTexts.slice(i, i + batchSize))
  }

  return { batches, occurrences }
}

// Один элемент результата gliner.inference() для одного текста батча.
export interface NerItem {
  label: string
  start: number
  end: number
  spanText: string
  score: number
}

// Разворачивает результат инференса по уникальному тексту обратно на ВСЕ его
// вхождения: офсеты считаются от base каждого конкретного вхождения (не
// представителя), иначе у дублей совпадут матчи с неверными координатами.
export function expandBatchResult(
  batchTexts: string[],
  batchResult: NerItem[][],
  occurrences: Map<string, Chunk[]>,
  mapLabel: (label: string) => EntityType | null,
): RawMatch[] {
  const matches: RawMatch[] = []
  batchTexts.forEach((text, j) => {
    const items = batchResult[j] ?? []
    const occs = occurrences.get(text) ?? []
    for (const occ of occs) {
      for (const item of items) {
        const type = mapLabel(item.label)
        if (!type) continue
        matches.push({
          type,
          value: occ.text.slice(item.start, item.end),
          start: occ.base + item.start,
          end: occ.base + item.end,
          score: item.score,
        })
      }
    }
  })
  return matches
}
