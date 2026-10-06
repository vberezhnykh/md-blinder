import type { Entity, EntityType } from './types'
import { findPlaceholderRanges, escapePlaceholderLiteral } from './placeholderGuard'
import { findImageRanges, IMAGE_REMOVED_MARKER } from './imageSafety'

// Replace every ACTIVE (anonymize:true) entity occurrence with its placeholder,
// preserving source offsets. Overlapping redactions are unioned so a broken
// invariant in imported data cannot expose the uncovered part of an entity.
export function buildAnonymizedText(sourceText: string, entities: Entity[]): string {
  return buildAnonymizedTextWithMap(sourceText, entities).text
}

export interface AnonSegment {
  outStart: number   // offset in anonymized text (inclusive)
  outEnd: number     // exclusive
  srcStart: number   // offset in source text
  srcEnd: number     // exclusive
  opaque: boolean    // true = inserted placeholder / escaped literal (no linear source mapping)
}

// Как buildAnonymizedText, но дополнительно возвращает карту сегментов
// исходник → результат. Порядок разрешения пересечений тот же, поэтому текст
// побайтово совпадает с buildAnonymizedText.
export function buildAnonymizedTextWithMap(
  sourceText: string,
  entities: Entity[],
): { text: string; segments: AnonSegment[] } {
  const repl: { start: number; end: number; placeholder: string }[] = []
  for (const image of findImageRanges(sourceText)) {
    repl.push({ ...image, placeholder: IMAGE_REMOVED_MARKER })
  }
  for (const e of entities) {
    if (!e.anonymize) continue
    for (const p of e.positions) repl.push({ start: p.start, end: p.end, placeholder: e.placeholder })
  }

  // B4: экранируем плейсхолдер-подобные литералы из исходника, чтобы в выводе
  // они не путались с настоящими плейсхолдерами. Пропускаем те, что перекрывают
  // активную сущность (маловероятно, но исключаем двойную замену).
  for (const rng of findPlaceholderRanges(sourceText)) {
    const overlapsEntity = entities.some(
      (e) => e.anonymize && e.positions.some((p) => rng.start < p.end && p.start < rng.end),
    )
    if (overlapsEntity) continue
    repl.push({ start: rng.start, end: rng.end, placeholder: escapePlaceholderLiteral(sourceText.slice(rng.start, rng.end)) })
  }

  // Union overlaps; images have priority over every entity/literal inside them.
  repl.sort((a, b) => a.start - b.start || b.end - a.end)
  const accepted: typeof repl = []
  let mergedOverlap = false
  for (const r of repl) {
    const prev = accepted[accepted.length - 1]
    if (prev && r.start < prev.end) {
      prev.end = Math.max(prev.end, r.end)
      if (r.placeholder === IMAGE_REMOVED_MARKER) prev.placeholder = IMAGE_REMOVED_MARKER
      mergedOverlap = true
    } else {
      accepted.push({ ...r })
    }
  }
  if (mergedOverlap) {
    console.warn('buildAnonymizedText: merged overlapping redactions to preserve coverage')
  }
  let out = ''
  let src = 0
  const segments: AnonSegment[] = []
  for (const r of accepted) {
    if (r.start > src) {
      segments.push({ outStart: out.length, outEnd: out.length + (r.start - src), srcStart: src, srcEnd: r.start, opaque: false })
      out += sourceText.slice(src, r.start)
    }
    segments.push({ outStart: out.length, outEnd: out.length + r.placeholder.length, srcStart: r.start, srcEnd: r.end, opaque: true })
    out += r.placeholder
    src = r.end
  }
  if (src < sourceText.length) {
    segments.push({ outStart: out.length, outEnd: out.length + (sourceText.length - src), srcStart: src, srcEnd: sourceText.length, opaque: false })
    out += sourceText.slice(src)
  }
  return { text: out, segments }
}

// Current original text of an entity = slice of its first occurrence in the live doc.
export function entityCurrentValue(sourceText: string, e: Entity): string {
  const p = e.positions[0]
  return p ? sourceText.slice(p.start, p.end) : e.value
}

// Next free number for a type, given existing entities (parse [TYPE_n] placeholders).
export function nextPlaceholderNumber(entities: Entity[], type: EntityType): number {
  let max = 0
  for (const e of entities) {
    if (e.type !== type) continue
    const m = e.placeholder.match(/_(\d+)\]$/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

// Create a manual entity spanning [from, to] of type `type`. "Absorption":
// any existing occurrence overlapping the selection is removed from its entity
// (and entities left with no occurrences are dropped), so the new entity cleanly
// takes over that span. Absorption happens ONLY at the explicit selection — auto-
// found exact duplicates elsewhere are added only when they don't overlap anything,
// so a short selection can't gut unrelated entities. Keeps all occurrences non-overlapping.
export function addEntityFromSelection(
  entities: Entity[],
  sourceText: string,
  from: number,
  to: number,
  type: EntityType,
): Entity[] {
  if (to <= from) return entities
  const selected = sourceText.slice(from, to)
  if (!selected) return entities

  const working = entities
    .map((e) => {
      const positions = e.positions.filter((p) => !(from < p.end && p.start < to))
      return { ...e, positions }
    })
    .filter((e) => e.positions.length > 0)

  const positions: { start: number; end: number }[] = [{ start: from, end: to }]
  let searchFrom = 0
  for (;;) {
    const found = sourceText.indexOf(selected, searchFrom)
    if (found === -1) break
    const foundEnd = found + selected.length
    searchFrom = foundEnd
    if (found === from) continue
    if (found < to && from < foundEnd) continue
    const overlapsWorking = working.some((e) =>
      e.positions.some((p) => found < p.end && p.start < foundEnd),
    )
    if (overlapsWorking) continue
    positions.push({ start: found, end: foundEnd })
  }
  positions.sort((a, b) => a.start - b.start)

  const placeholder = `[${type}_${nextPlaceholderNumber(working, type)}]`
  const newEntity: Entity = {
    id: crypto.randomUUID(),
    type,
    value: selected,
    placeholder,
    positions,
    anonymize: true,
    manual: true,
  }
  return [...working, newEntity]
}

// Attach one occurrence [from,to] to an EXISTING entity (by id) so it shares that
// entity's placeholder, instead of creating a new entity. The span is absorbed
// away from any OTHER entity that overlaps it. Union the entire affected ranges
// first, including active neighbours, so no already-redacted text becomes visible.
export function addOccurrenceToEntity(
  entities: Entity[],
  _sourceText: string,
  from: number,
  to: number,
  entityId: string,
): Entity[] {
  if (to <= from) return entities
  const target = entities.find((e) => e.id === entityId)
  if (!target) return entities

  let start = from
  let end = to
  let anonymize = target.anonymize
  // Union connected components once; repeatedly expanding the selection across
  // a chain of overlaps would otherwise require a quadratic number of sweeps.
  const spans = entities.flatMap((e) => e.positions.map((p) => ({ ...p, active: e.anonymize })))
    .sort((a, b) => a.start - b.start)
  const components: typeof spans = []
  for (const span of spans) {
    const previous = components[components.length - 1]
    if (previous && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end)
      previous.active ||= span.active
    } else components.push({ ...span })
  }
  for (const span of components) {
    if (span.start >= end) break
    if (start < span.end) {
      start = Math.min(start, span.start)
      end = Math.max(end, span.end)
      anonymize ||= span.active
    }
  }

  return entities.map((e) => {
    const positions = e.positions.filter((p) => !(start < p.end && p.start < end))
    if (e.id !== entityId) return positions.length === e.positions.length ? e : { ...e, positions }
    positions.push({ start, end })
    positions.sort((a, b) => a.start - b.start)
    return { ...e, positions, anonymize, ...(anonymize ? { candidate: false, dismissed: false } : {}) }
  }).filter((e) => e.positions.length > 0)
}

// Recolor an entity to a new type, recomputing its placeholder against the
// OTHER entities (so it never collides with an existing placeholder of the
// new type). The entity's `id` is stable and never changes here.
export function changeEntityType(entities: Entity[], id: string, newType: EntityType): Entity[] {
  if (!entities.some((e) => e.id === id)) return entities
  const others = entities.filter((e) => e.id !== id)
  const placeholder = `[${newType}_${nextPlaceholderNumber(others, newType)}]`
  return entities.map((e) => (e.id === id ? { ...e, type: newType, placeholder } : e))
}

// Принять кандидата «серой зоны»: снять флаг candidate, включить анонимизацию и
// пересчитать плейсхолдер против ПОДТВЕРЖДЁННЫХ (не-кандидатов) сущностей того же
// типа, чтобы нумерация подтверждённых оставалась плотной. id стабилен.
export function acceptCandidate(entities: Entity[], id: string): Entity[] {
  const target = entities.find((e) => e.id === id)
  if (!target || !target.candidate) return entities
  const others = entities.filter((e) => e.id !== id && !e.candidate)
  const placeholder = `[${target.type}_${nextPlaceholderNumber(others, target.type)}]`
  return entities.map((e) =>
    e.id === id ? { ...e, candidate: false, candidateNote: undefined, anonymize: true, placeholder } : e,
  )
}

// Fold the source entity's occurrences into the target entity (they become one,
// sharing the TARGET's type/value/placeholder). The source is removed. Positions
// are merged and overlapping ranges are unioned (not dropped — dropping would
// leave part of the source's original text unredacted in the export); touching-
// but-not-overlapping ranges stay separate. anonymize is the logical OR of both
// (fail-safe: merging an active source into an inactive target must not silently
// stop redacting the source's occurrences). No-op if ids are equal, either is
// missing, or the two entities have different types.
export function mergeEntities(entities: Entity[], sourceId: string, targetId: string): Entity[] {
  if (sourceId === targetId) return entities
  const source = entities.find((e) => e.id === sourceId)
  const target = entities.find((e) => e.id === targetId)
  if (!source || !target) return entities
  if (source.type !== target.type) return entities

  const merged = [...target.positions, ...source.positions].sort((a, b) => a.start - b.start || a.end - b.end)
  const positions: { start: number; end: number }[] = []
  let cur: { start: number; end: number } | null = null
  for (const next of merged) {
    if (cur === null) {
      cur = { ...next }
    } else if (next.start < cur.end) {
      cur = { start: cur.start, end: Math.max(cur.end, next.end) }
    } else {
      positions.push(cur)
      cur = { ...next }
    }
  }
  if (cur !== null) positions.push(cur)

  return entities
    .filter((e) => e.id !== sourceId)
    .map((e) => (e.id === targetId ? { ...e, positions, anonymize: target.anonymize || source.anonymize } : e))
}

// Схлопывает дыры в нумерации плейсхолдеров, остающиеся после удаления/слияния
// сущностей (напр. PERSON_1, PERSON_4 → PERSON_1, PERSON_2). Перенумерация идёт
// потипно и раздельно по двум группам: сначала подтверждённые (не кандидат и не
// отклонены), затем кандидаты/отклонённые — так сохраняется инвариант "номер
// кандидата всегда больше номеров подтверждённых сущностей того же типа" (см.
// комментарий в index.ts перед confirmedGroups/candidateGroups), и acceptCandidate
// не может словить коллизию. Внутри каждой группы относительный порядок по
// текущему номеру плейсхолдера сохраняется; сущности без разбираемого номера
// уходят в конец своей группы, сохраняя взаимный порядок. Порядок элементов в
// возвращаемом массиве не меняется — правится только поле placeholder. Возвращает
// тот же массив (===), если ни один плейсхолдер не поменялся, чтобы не плодить
// лишние ре-рендеры.
export function compactPlaceholderNumbers(entities: Entity[]): Entity[] {
  const parseNum = (placeholder: string): number | null => {
    const m = placeholder.match(/_(\d+)\]$/)
    return m ? Number(m[1]) : null
  }

  // Стабильно сортирует группу по разобранному номеру; сущности без номера — в конец.
  const sortByNumber = (group: Entity[]): Entity[] =>
    group
      .map((e, idx) => ({ e, idx, num: parseNum(e.placeholder) }))
      .sort((a, b) => {
        if (a.num === null && b.num === null) return a.idx - b.idx
        if (a.num === null) return 1
        if (b.num === null) return -1
        return a.num - b.num || a.idx - b.idx
      })
      .map((x) => x.e)

  const newPlaceholder = new Map<string, string>()
  const types = new Set(entities.map((e) => e.type))
  for (const type of types) {
    const ofType = entities.filter((e) => e.type === type)
    const main = ofType.filter((e) => !e.candidate && !e.dismissed)
    const rest = ofType.filter((e) => e.candidate || e.dismissed)

    let n = 1
    for (const e of sortByNumber(main)) newPlaceholder.set(e.id, `[${type}_${n++}]`)
    for (const e of sortByNumber(rest)) newPlaceholder.set(e.id, `[${type}_${n++}]`)
  }

  let changed = false
  const result = entities.map((e) => {
    const next = newPlaceholder.get(e.id)!
    if (next === e.placeholder) return e
    changed = true
    return { ...e, placeholder: next }
  })
  return changed ? result : entities
}

// Guard against stale persisted history docs that may contain duplicate ids
// (pre-fix bug: id was derived from placeholder). Keeps the first occurrence
// of each id and assigns a fresh UUID to any later duplicate.
export function dedupeEntityIds(entities: Entity[]): Entity[] {
  const seen = new Set<string>()
  return entities.map((e) => {
    if (seen.has(e.id)) return { ...e, id: crypto.randomUUID() }
    seen.add(e.id)
    return e
  })
}
