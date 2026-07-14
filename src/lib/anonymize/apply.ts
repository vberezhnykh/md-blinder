import type { Entity, EntityType } from './types'

// Replace every ACTIVE (anonymize:true) entity occurrence with its placeholder,
// splicing back-to-front so earlier offsets stay valid. This assumes positions
// are non-overlapping; as a safety net against a broken invariant (e.g. a
// hand-edited import), any replacement that overlaps the previously-accepted
// one (scanning right-to-left) is skipped rather than double-splicing.
export function buildAnonymizedText(sourceText: string, entities: Entity[]): string {
  const repl: { start: number; end: number; placeholder: string }[] = []
  for (const e of entities) {
    if (!e.anonymize) continue
    for (const p of e.positions) repl.push({ start: p.start, end: p.end, placeholder: e.placeholder })
  }
  repl.sort((a, b) => b.start - a.start)

  const accepted: typeof repl = []
  let prevStart = Infinity
  let droppedOverlap = false
  for (const r of repl) {
    if (r.end <= prevStart) {
      accepted.push(r)
      prevStart = r.start
    } else {
      droppedOverlap = true
    }
  }
  if (droppedOverlap) {
    console.warn('buildAnonymizedText: dropped overlapping replacement(s) to avoid double-splicing')
  }

  let out = sourceText
  for (const r of accepted) out = out.slice(0, r.start) + r.placeholder + out.slice(r.end)
  return out
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
