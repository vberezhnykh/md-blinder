import { detectStructural } from './regexDetectors'
import { detectEntitiesNer } from './ner'
import { buildAnonymizedText } from './apply'
import { stitchAddressRuns } from './stitchAddress'
import { filterGenericNerMatches } from './nerFilter'
import type { AnonymizationResult, Entity, EntityType, RawMatch } from './types'

export interface AnonymizeProgress {
  stage: 'regex' | 'ner-load' | 'ner-detect'
  pct?: number
  chunk?: number
  chunks?: number
}

function normalizeValue(type: EntityType, value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (type === 'CARD' || type === 'IBAN' || type === 'ACCOUNT') {
    return trimmed.replace(/[\s-]/g, '').toUpperCase()
  }
  if (type === 'PERSON' || type === 'COMPANY' || type === 'ADDRESS' || type === 'EMAIL') {
    return trimmed.toLowerCase()
  }
  return trimmed
}

function overlaps(a: RawMatch, b: RawMatch): boolean {
  return a.start < b.end && b.start < a.end
}

function byStartThenLonger(a: RawMatch, b: RawMatch): number {
  if (a.start !== b.start) return a.start - b.start
  return b.end - b.start - (a.end - a.start)
}

// Structural (regex) matches are accepted first so they win any overlap
// against NER matches; within each pass, earlier/longer spans win.
function resolveOverlaps(structural: RawMatch[], ner: RawMatch[]): RawMatch[] {
  const accepted: RawMatch[] = []

  const tryAccept = (m: RawMatch) => {
    for (const acc of accepted) {
      if (overlaps(m, acc)) return
    }
    accepted.push(m)
  }

  for (const m of [...structural].sort(byStartThenLonger)) tryAccept(m)
  for (const m of [...ner].sort(byStartThenLonger)) tryAccept(m)

  return accepted.sort((a, b) => a.start - b.start)
}

export async function anonymizeMarkdown(
  markdown: string,
  onProgress?: (p: AnonymizeProgress) => void,
): Promise<{ result: AnonymizationResult; nerFailed: boolean }> {
  onProgress?.({ stage: 'regex' })
  const structural = detectStructural(markdown)

  let ner: RawMatch[] = []
  let nerFailed = false
  try {
    ner = await detectEntitiesNer(markdown, (p) =>
      onProgress?.({
        stage: p.stage === 'load' ? 'ner-load' : 'ner-detect',
        pct: p.pct,
        chunk: p.chunk,
        chunks: p.chunks,
      }),
    )
  } catch {
    nerFailed = true
    ner = []
  }

  const filteredNer = filterGenericNerMatches(ner)
  const stitchedNer = stitchAddressRuns(filteredNer, markdown)
  const accepted = resolveOverlaps(structural, stitchedNer)

  interface Group {
    type: EntityType
    firstValue: string
    firstStart: number
    positions: { start: number; end: number }[]
  }

  const groups = new Map<string, Group>()
  for (const m of accepted) {
    const key = `${m.type} ${normalizeValue(m.type, m.value)}`
    let group = groups.get(key)
    if (!group) {
      group = { type: m.type, firstValue: m.value, firstStart: m.start, positions: [] }
      groups.set(key, group)
    }
    group.positions.push({ start: m.start, end: m.end })
  }

  const orderedGroups = [...groups.values()].sort((a, b) => a.firstStart - b.firstStart)

  const typeCounters = new Map<EntityType, number>()
  const entities: Entity[] = orderedGroups.map((group) => {
    const n = (typeCounters.get(group.type) ?? 0) + 1
    typeCounters.set(group.type, n)
    const placeholder = `[${group.type}_${n}]`
    const positions = [...group.positions].sort((a, b) => a.start - b.start)
    return {
      id: placeholder,
      type: group.type,
      value: group.firstValue,
      placeholder,
      occurrences: positions.length,
      positions,
      anonymize: true,
      manual: false,
    }
  })

  const anonymized = buildAnonymizedText(markdown, entities)

  return { result: { markdown: anonymized, entities }, nerFailed }
}
