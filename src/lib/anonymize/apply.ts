import type { Entity, EntityType } from './types'

// Replace every ACTIVE (anonymize:true) entity occurrence with its placeholder,
// splicing back-to-front so earlier offsets stay valid.
export function buildAnonymizedText(sourceText: string, entities: Entity[]): string {
  const repl: { start: number; end: number; placeholder: string }[] = []
  for (const e of entities) {
    if (!e.anonymize) continue
    for (const p of e.positions) repl.push({ start: p.start, end: p.end, placeholder: e.placeholder })
  }
  repl.sort((a, b) => b.start - a.start)
  let out = sourceText
  for (const r of repl) out = out.slice(0, r.start) + r.placeholder + out.slice(r.end)
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
      return { ...e, positions, occurrences: positions.length }
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
    id: placeholder,
    type,
    value: selected,
    placeholder,
    occurrences: positions.length,
    positions,
    anonymize: true,
    manual: true,
  }
  return [...working, newEntity]
}
