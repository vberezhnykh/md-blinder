import { detectStructuralAsync } from './structuralClient'
import { detectEntitiesNer, type NerProgress } from './ner'
import { filterGenericNerMatches } from './nerFilter'
import { stitchAddressRuns } from './stitchAddress'
import { buildAnonymizedTextWithMap, mapAnonRangeToSource, nextPlaceholderNumber } from './apply'
import { normalizeValue } from './normalizeValue'
import type { Entity, EntityType, RawMatch } from './types'

export interface SecondPassResult {
  entities: Entity[]
  nerFailed: boolean
}

// B2 «контрольный проход». Прогоняет весь конвейер детекции по УЖЕ анонимизированному
// тексту (плейсхолдеры игнорируются), пересчитывает находки обратно в офсеты
// исходника и возвращает НОВЫЕ сущности-кандидаты — пропуски первого прохода.
// Ничего не анонимизирует автоматически: всё уходит в «серую зону» (B1) на проверку.
export async function runSecondPass(
  sourceText: string,
  entities: Entity[],
  onProgress?: (p: NerProgress) => void,
  signal?: AbortSignal,
): Promise<SecondPassResult> {
  signal?.throwIfAborted()
  if (!sourceText) return { entities: [], nerFailed: false }
  const { text: anon, segments } = buildAnonymizedTextWithMap(sourceText, entities)

  const structural = await detectStructuralAsync(anon, signal)
  let ner: RawMatch[] = []
  let nerFailed = false
  try {
    ner = await detectEntitiesNer(anon, onProgress, signal)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && error.name === 'AbortError') throw error
    nerFailed = true
    ner = []
  }
  signal?.throwIfAborted()
  const nerFiltered = stitchAddressRuns(filterGenericNerMatches(ner), anon)

  // Пересчёт находок в исходные офсеты; отбрасываем то, что задевает плейсхолдеры.
  const mapped: RawMatch[] = []
  for (const m of [...structural, ...nerFiltered]) {
    const src = mapAnonRangeToSource(m.start, m.end, segments)
    if (!src) continue
    mapped.push({ ...m, start: src.start, end: src.end, value: sourceText.slice(src.start, src.end) })
  }

  // Уже покрытые позиции (существующие сущности, включая кандидатов) — не пропуски.
  // Deduplicate positions, not values: knowing a name once does not protect its
  // other occurrences. Dismissed positions remain claimed so decisions persist.
  const claimed = entities.flatMap((e) => e.positions)

  interface G { type: EntityType; firstValue: string; firstStart: number; positions: { start: number; end: number }[] }
  const groups = new Map<string, G>()
  for (const m of mapped) {
    if (claimed.some((p) => m.start < p.end && p.start < m.end)) continue
    const key = `${m.type} ${normalizeValue(m.type, m.value)}`
    let g = groups.get(key)
    if (!g) {
      g = { type: m.type, firstValue: m.value, firstStart: m.start, positions: [] }
      groups.set(key, g)
    }
    // непересекающиеся позиции внутри группы
    if (!g.positions.some((p) => m.start < p.end && p.start < m.end)) {
      g.positions.push({ start: m.start, end: m.end })
      claimed.push({ start: m.start, end: m.end })
      g.firstStart = Math.min(g.firstStart, m.start)
    }
  }

  // Нумерация плейсхолдеров — продолжаем счётчик существующих сущностей по типу.
  const working = [...entities]
  const result: Entity[] = []
  for (const g of [...groups.values()].sort((a, b) => a.firstStart - b.firstStart)) {
    const placeholder = `[${g.type}_${nextPlaceholderNumber(working, g.type)}]`
    const entity: Entity = {
      id: crypto.randomUUID(),
      type: g.type,
      value: g.firstValue,
      placeholder,
      positions: [...g.positions].sort((a, b) => a.start - b.start),
      anonymize: false,
      manual: false,
      candidate: true,
      candidateNote: 'Найдено на контрольном проходе',
    }
    working.push(entity)
    result.push(entity)
  }
  return { entities: result, nerFailed }
}
