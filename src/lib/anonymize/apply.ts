import type { Entity, EntityType } from './types'
import { findPlaceholderRanges, escapePlaceholderLiteral } from './placeholderGuard'

// Replace every ACTIVE (anonymize:true) entity occurrence with its placeholder,
// splicing back-to-front so earlier offsets stay valid. This assumes positions
// are non-overlapping; as a safety net against a broken invariant (e.g. a
// hand-edited import), any replacement that overlaps the previously-accepted
// one (scanning right-to-left) is skipped rather than double-splicing.
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

// Как buildAnonymizedText, но дополнительно возвращает карту сегментов для
// обратного пересчёта офсетов (нужно контрольному проходу B2). Порядок разрешения
// пересечений тот же (скан справа-налево, побеждает больший start), поэтому текст
// побайтово совпадает с buildAnonymizedText.
export function buildAnonymizedTextWithMap(
  sourceText: string,
  entities: Entity[],
): { text: string; segments: AnonSegment[] } {
  const repl: { start: number; end: number; placeholder: string }[] = []
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

  // Разрешение пересечений — тот же алгоритм, что в старой buildAnonymizedText
  // (скан по убыванию start, побеждает уже принятый = с большим start).
  repl.sort((a, b) => b.start - a.start)
  const acceptedDesc: typeof repl = []
  let prevStart = Infinity
  let droppedOverlap = false
  for (const r of repl) {
    if (r.end <= prevStart) {
      acceptedDesc.push(r)
      prevStart = r.start
    } else {
      droppedOverlap = true
    }
  }
  if (droppedOverlap) {
    console.warn('buildAnonymizedText: dropped overlapping replacement(s) to avoid double-splicing')
  }

  const accepted = acceptedDesc.slice().sort((a, b) => a.start - b.start)
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

// Пересчёт диапазона из анонимизированного текста обратно в исходный. Возвращает
// null, если диапазон не помещается целиком в один verbatim-сегмент (т.е. задевает
// плейсхолдер) — такие находки контрольный проход игнорирует.
export function mapAnonRangeToSource(
  start: number,
  end: number,
  segments: AnonSegment[],
): { start: number; end: number } | null {
  for (const s of segments) {
    if (s.opaque) continue
    if (start >= s.outStart && end <= s.outEnd) {
      return { start: s.srcStart + (start - s.outStart), end: s.srcStart + (end - s.outStart) }
    }
  }
  return null
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
