import { detectStructural } from './regexDetectors'
import { detectEntitiesNer, type NerProgress } from './ner'
import { filterGenericNerMatches } from './nerFilter'
import { stitchAddressRuns } from './stitchAddress'
import { buildAnonymizedTextWithMap, mapAnonRangeToSource, nextPlaceholderNumber } from './apply'
import { normalizeValue } from './index'
import type { Entity, EntityType, RawMatch } from './types'

// B2 «контрольный проход». Прогоняет весь конвейер детекции по УЖЕ анонимизированному
// тексту (плейсхолдеры игнорируются), пересчитывает находки обратно в офсеты
// исходника и возвращает НОВЫЕ сущности-кандидаты — пропуски первого прохода.
// Ничего не анонимизирует автоматически: всё уходит в «серую зону» (B1) на проверку.
export async function runSecondPass(
  sourceText: string,
  entities: Entity[],
  onProgress?: (p: NerProgress) => void,
): Promise<Entity[]> {
  if (!sourceText) return []
  const { text: anon, segments } = buildAnonymizedTextWithMap(sourceText, entities)

  const structural = detectStructural(anon)
  let ner: RawMatch[] = []
  try {
    ner = await detectEntitiesNer(anon, onProgress)
  } catch {
    ner = []
  }
  const nerFiltered = stitchAddressRuns(filterGenericNerMatches(ner), anon)

  // Пересчёт находок в исходные офсеты; отбрасываем то, что задевает плейсхолдеры.
  const mapped: RawMatch[] = []
  for (const m of [...structural, ...nerFiltered]) {
    const src = mapAnonRangeToSource(m.start, m.end, segments)
    if (!src) continue
    mapped.push({ ...m, start: src.start, end: src.end, value: sourceText.slice(src.start, src.end) })
  }

  // Уже покрытые позиции (существующие сущности, включая кандидатов) — не пропуски.
  const overlapsExisting = (s: number, e: number): boolean =>
    entities.some((x) => x.positions.some((p) => s < p.end && p.start < e))
  // Значения, уже известные как сущность того же типа — не дублируем (шум); их
  // повторные вхождения — забота B3 (родственные вхождения), не B2.
  const knownKeys = new Set(entities.map((x) => `${x.type} ${normalizeValue(x.type, x.value)}`))

  interface G { type: EntityType; firstValue: string; firstStart: number; positions: { start: number; end: number }[] }
  const groups = new Map<string, G>()
  for (const m of mapped) {
    if (overlapsExisting(m.start, m.end)) continue
    const key = `${m.type} ${normalizeValue(m.type, m.value)}`
    if (knownKeys.has(key)) continue
    let g = groups.get(key)
    if (!g) {
      g = { type: m.type, firstValue: m.value, firstStart: m.start, positions: [] }
      groups.set(key, g)
    }
    // непересекающиеся позиции внутри группы
    if (!g.positions.some((p) => m.start < p.end && p.start < m.end)) {
      g.positions.push({ start: m.start, end: m.end })
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
  return result
}
