import { detectStructural } from './regexDetectors'
import { detectEntitiesNer } from './ner'
import { buildAnonymizedText } from './apply'
import { stitchAddressRuns } from './stitchAddress'
import { filterGenericNerMatches } from './nerFilter'
import { NER_CONFIRM_THRESHOLD, NER_GRAY_ZONE_LOW } from './config'
import type { AnonymizationResult, Entity, EntityType, RawMatch } from './types'

export interface AnonymizeProgress {
  stage: 'regex' | 'ner-download' | 'ner-init' | 'ner-warmup' | 'ner-detect'
  pct?: number
  cached?: boolean
  ep?: 'webgpu' | 'wasm'
  chunk?: number
  chunks?: number
  batch?: number
  batches?: number
  batchChunks?: number
  elapsedMs?: number
}

export function normalizeValue(type: EntityType, value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (type === 'CARD' || type === 'IBAN' || type === 'ACCOUNT') {
    return trimmed.replace(/[\s-]/g, '').toUpperCase()
  }
  if (type === 'PERSON' || type === 'COMPANY' || type === 'ADDRESS' || type === 'EMAIL') {
    return trimmed.toLowerCase()
  }
  if (type === 'PHONE') {
    return trimmed.replace(/[\s\-().]/g, '')
  }
  if (type === 'REG_NUMBER' || type === 'SWIFT') {
    return trimmed.replace(/[\s-]/g, '').toUpperCase()
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

// Матч "серой зоны" — NER отдал скор ниже порога подтверждения. Структурные
// (regex) матчи и ручные добавления не несут score ⇒ всегда подтверждённые.
function isConfirmedLevel(m: RawMatch): boolean {
  return !(typeof m.score === 'number' && m.score < NER_CONFIRM_THRESHOLD)
}

// Максимум ОПРЕДЕЛЁННЫХ скоров (для отображения в UI). В отличие от stitchAddress,
// undefined здесь просто игнорируется, а не "побеждает".
function maxDefinedScore(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
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
      onProgress?.({ ...p, stage: `ner-${p.stage}` as AnonymizeProgress['stage'] }),
    )
  } catch {
    nerFailed = true
    ner = []
  }

  const filteredNer = filterGenericNerMatches(ner)
  const stitchedNer = stitchAddressRuns(filteredNer, markdown)
  // Защита: матч с уверенностью ниже минимума серой зоны отбрасывается (в норме
  // такого не бывает — worker уже фильтрует по этому порогу).
  const accepted = resolveOverlaps(structural, stitchedNer).filter(
    (m) => !(typeof m.score === 'number' && m.score < NER_GRAY_ZONE_LOW),
  )

  interface Group {
    type: EntityType
    firstValue: string
    firstStart: number
    positions: { start: number; end: number }[]
    confirmed: boolean
    maxScore: number | undefined
  }

  const groups = new Map<string, Group>()
  for (const m of accepted) {
    const key = `${m.type} ${normalizeValue(m.type, m.value)}`
    let group = groups.get(key)
    if (!group) {
      group = {
        type: m.type,
        firstValue: m.value,
        firstStart: m.start,
        positions: [],
        confirmed: isConfirmedLevel(m),
        maxScore: m.score,
      }
      groups.set(key, group)
    }
    group.confirmed = group.confirmed || isConfirmedLevel(m)
    group.maxScore = maxDefinedScore(group.maxScore, m.score)
    group.positions.push({ start: m.start, end: m.end })
  }

  // Поглощение вложенных ADDRESS-спанов: NER на разных вхождениях отдаёт адрес
  // разной длины ("ROOM C05" против "ROOM C05, FLAT A, …"). Если нормализованное
  // значение одного адреса — подстрока другого, сливаем короткий в длинный
  // (объединяя позиции), чтобы не плодить дубль-сущности и фрагменты-extra.
  const addrGroups = [...groups.values()]
    .filter((g) => g.type === 'ADDRESS')
    .sort((a, b) => b.firstValue.length - a.firstValue.length) // длинные первыми
  const absorbed = new Set<Group>()
  for (let i = 0; i < addrGroups.length; i++) {
    const long = addrGroups[i]
    if (absorbed.has(long)) continue
    const longNorm = normalizeValue('ADDRESS', long.firstValue)
    for (let j = i + 1; j < addrGroups.length; j++) {
      const short = addrGroups[j]
      if (absorbed.has(short)) continue
      const shortNorm = normalizeValue('ADDRESS', short.firstValue)
      // Никогда не сливаем кандидата «серой зоны» в подтверждённый адрес (и наоборот) —
      // это молча повысило бы/понизило бы уверенность объединённой сущности.
      if (longNorm.includes(shortNorm) && long.confirmed === short.confirmed) {
        // Вливаем только непересекающиеся позиции, чтобы не получить две замены
        // на одном месте (splice в buildAnonymizedText их бы задвоил).
        for (const sp of short.positions) {
          if (!long.positions.some((lp) => sp.start < lp.end && lp.start < sp.end)) {
            long.positions.push(sp)
          }
        }
        long.firstStart = Math.min(long.firstStart, short.firstStart)
        absorbed.add(short)
      }
    }
  }
  for (const g of absorbed) groups.delete(`${g.type} ${normalizeValue(g.type, g.firstValue)}`)

  // Подтверждённые сущности нумеруются первыми, кандидаты «серой зоны» — следом,
  // по общему счётчику на тип. Так номер плейсхолдера кандидата всегда больше
  // номеров подтверждённых сущностей того же типа — принятие кандидата (B1)
  // никогда не коллизирует с уже существующим плейсхолдером.
  const confirmedGroups = [...groups.values()]
    .filter((g) => g.confirmed)
    .sort((a, b) => a.firstStart - b.firstStart)
  const candidateGroups = [...groups.values()]
    .filter((g) => !g.confirmed)
    .sort((a, b) => a.firstStart - b.firstStart)

  const typeCounters = new Map<EntityType, number>()
  const nextPlaceholder = (type: EntityType): string => {
    const n = (typeCounters.get(type) ?? 0) + 1
    typeCounters.set(type, n)
    return `[${type}_${n}]`
  }

  const confirmedEntities: Entity[] = confirmedGroups.map((group) => ({
    id: crypto.randomUUID(),
    type: group.type,
    value: group.firstValue,
    placeholder: nextPlaceholder(group.type),
    positions: [...group.positions].sort((a, b) => a.start - b.start),
    anonymize: true,
    manual: false,
    score: group.maxScore,
  }))

  const candidateEntities: Entity[] = candidateGroups.map((group) => ({
    id: crypto.randomUUID(),
    type: group.type,
    value: group.firstValue,
    placeholder: nextPlaceholder(group.type),
    positions: [...group.positions].sort((a, b) => a.start - b.start),
    anonymize: false,
    manual: false,
    candidate: true,
    candidateNote: 'Низкая уверенность модели',
    score: group.maxScore,
  }))

  const entities: Entity[] = [...confirmedEntities, ...candidateEntities]

  const anonymized = buildAnonymizedText(markdown, entities)

  return { result: { markdown: anonymized, entities }, nerFailed }
}
