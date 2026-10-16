import { nextPlaceholderNumber } from './apply'
import { maskImagesForDetection } from './imageSafety'
import { normalizeValue } from './normalizeValue'
import { companyCoreWords } from './relatedOccurrences'
import type { Entity, EntityType } from './types'

// Пакет — несколько документов, которые обезличиваются согласованно: одно и то
// же значение (сторона договора, реквизит) получает одну и ту же метку во всех
// документах пакета. Например, в договорах «Альфа — Бета» и «Бета — Гамма»
// «Бета» везде становится [COMPANY_2].
//
// Метки хранятся в самих документах, отдельного словаря нет. Словарь пакета
// каждый раз выводится из разметки остальных документов: значение связано с
// меткой, если совпадает нормализованная форма любого из вхождений. Поэтому
// правки разметки в одном документе (объединение, новые вхождения) сразу
// учитываются при согласовании остальных.

export interface BatchMember {
  sourceText: string
  entities: Entity[]
}

const MIN_SEED_LENGTH = 3

function isMain(e: Entity): boolean {
  return !e.candidate && !e.dismissed
}

function placeholderNumber(placeholder: string): number | null {
  const m = placeholder.match(/_(\d+)\]$/)
  return m ? Number(m[1]) : null
}

function keyOf(type: EntityType, text: string): string {
  return `${type} ${normalizeValue(type, text)}`
}

// Нормализованные формы всех вхождений сущности, в порядке появления в тексте.
function entityKeys(e: Entity, sourceText: string): string[] {
  const keys = new Set<string>()
  for (const p of [...e.positions].sort((a, b) => a.start - b.start)) {
    keys.add(keyOf(e.type, sourceText.slice(p.start, p.end)))
  }
  return [...keys]
}

// Запасной ключ для компаний: название без ОПФ и кавычек, чтобы «ООО «Гамма»»
// в одном договоре и «Гамма» в другом считались одной стороной.
function companyCoreKeys(e: Entity, sourceText: string): string[] {
  if (e.type !== 'COMPANY') return []
  const keys = new Set<string>()
  for (const p of e.positions) {
    const core = companyCoreWords(sourceText.slice(p.start, p.end)).join(' ').toLowerCase()
    if (core.length >= MIN_SEED_LENGTH) keys.add(core)
  }
  return [...keys]
}

interface Dictionary {
  byKey: Map<string, string>
  // null — запасной ключ ведет к разным меткам, такая связь не используется.
  byCore: Map<string, string | null>
  usedPlaceholders: Set<string>
}

function buildDictionary(members: BatchMember[]): Dictionary {
  const byKey = new Map<string, string>()
  const byCore = new Map<string, string | null>()
  const usedPlaceholders = new Set<string>()
  for (const member of members) {
    for (const e of member.entities) {
      if (!isMain(e)) continue
      usedPlaceholders.add(e.placeholder)
      for (const key of entityKeys(e, member.sourceText)) {
        if (!byKey.has(key)) byKey.set(key, e.placeholder)
      }
      for (const core of companyCoreKeys(e, member.sourceText)) {
        const known = byCore.get(core)
        if (known === undefined) byCore.set(core, e.placeholder)
        else if (known !== e.placeholder) byCore.set(core, null)
      }
    }
  }
  return { byKey, byCore, usedPlaceholders }
}

// Порядок по номеру метки; сущности без номера в конце, взаимный порядок сохраняется.
function byPlaceholderNumber(list: Entity[]): Entity[] {
  return list
    .map((e, idx) => ({ e, idx, num: placeholderNumber(e.placeholder) }))
    .sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity) || a.idx - b.idx)
    .map((x) => x.e)
}

// Согласует метки документа с остальными документами пакета:
// 1. значение, которое уже есть в другом документе, получает его метку;
// 2. остальные сохраняют свою метку, если ее не занимает другое значение пакета;
// 3. иначе получают наименьший свободный в пакете номер;
// 4. кандидаты и отклоненные нумеруются после всех занятых номеров, как в
//    compactPlaceholderNumbers, чтобы принятие кандидата не давало коллизий.
// Две сущности документа никогда не получают одну метку: если пользователь
// разделил значения в этом документе, разделение сохраняется.
// Возвращает тот же массив, если ни одна метка не изменилась.
export function reconcileBatchPlaceholders(entities: Entity[], sourceText: string, others: BatchMember[]): Entity[] {
  if (others.length === 0) return entities
  const dict = buildDictionary(others)
  const assigned = new Map<string, string>()
  const taken = new Set<string>()
  const main = byPlaceholderNumber(entities.filter(isMain))

  for (const e of main) {
    let linked = entityKeys(e, sourceText)
      .map((key) => dict.byKey.get(key))
      .find((p) => p !== undefined && !taken.has(p))
    if (!linked) {
      linked = companyCoreKeys(e, sourceText)
        .map((core) => dict.byCore.get(core))
        .find((p): p is string => typeof p === 'string' && !taken.has(p))
    }
    if (linked) {
      assigned.set(e.id, linked)
      taken.add(linked)
    }
  }

  for (const e of main) {
    if (assigned.has(e.id)) continue
    const own = e.placeholder
    if (placeholderNumber(own) !== null && !taken.has(own) && !dict.usedPlaceholders.has(own)) {
      assigned.set(e.id, own)
      taken.add(own)
    }
  }

  const isUsed = (placeholder: string) => taken.has(placeholder) || dict.usedPlaceholders.has(placeholder)
  for (const e of main) {
    if (assigned.has(e.id)) continue
    let n = 1
    while (isUsed(`[${e.type}_${n}]`)) n++
    const fresh = `[${e.type}_${n}]`
    assigned.set(e.id, fresh)
    taken.add(fresh)
  }

  const rest = entities.filter((e) => !isMain(e))
  const maxUsed = new Map<EntityType, number>()
  for (const p of [...taken, ...dict.usedPlaceholders]) {
    const m = p.match(/^\[([A-Z_]+)_(\d+)\]$/)
    if (m) maxUsed.set(m[1] as EntityType, Math.max(maxUsed.get(m[1] as EntityType) ?? 0, Number(m[2])))
  }
  for (const e of byPlaceholderNumber(rest)) {
    const n = (maxUsed.get(e.type) ?? 0) + 1
    maxUsed.set(e.type, n)
    assigned.set(e.id, `[${e.type}_${n}]`)
  }

  let changed = false
  const result = entities.map((e) => {
    const next = assigned.get(e.id) ?? e.placeholder
    if (next === e.placeholder) return e
    changed = true
    return { ...e, placeholder: next }
  })
  return changed ? result : entities
}

// Согласует весь пакет по порядку: каждый документ — с уже согласованными
// предыдущими. Документы без изменений возвращаются теми же объектами.
export function alignBatch<T extends BatchMember>(docs: T[]): T[] {
  const aligned: T[] = []
  for (const doc of docs) {
    const entities = reconcileBatchPlaceholders(doc.entities, doc.sourceText, aligned)
    aligned.push(entities === doc.entities ? doc : { ...doc, entities })
  }
  return aligned
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Ищет в новом документе точные формы значений, которые пользователь уже
// подтвердил в других документах пакета, и размечает их, даже если NER их здесь
// не нашел. Совпадение проверяется с границами слов и по нормализованной форме.
// Найденное вхождение:
// - добавляется к сущности документа с той же формой;
// - или принимает непроверенного кандидата, который ровно его покрывает;
// - или становится новой сущностью (метку выставит reconcileBatchPlaceholders).
// Вхождения, пересекающие другую разметку, пропускаются.
export function seedFromBatch(sourceText: string, entities: Entity[], others: BatchMember[]): Entity[] {
  if (others.length === 0) return entities
  const forms = new Map<string, { type: EntityType; text: string }>()
  for (const member of others) {
    for (const e of member.entities) {
      if (!isMain(e) || !e.anonymize) continue
      for (const p of e.positions) {
        const text = member.sourceText.slice(p.start, p.end).trim()
        if (text.length < MIN_SEED_LENGTH) continue
        const formKey = `${e.type} ${text.toLowerCase()}`
        if (!forms.has(formKey)) forms.set(formKey, { type: e.type, text })
      }
    }
  }
  if (forms.size === 0) return entities

  const searchable = maskImagesForDetection(sourceText)
  const working = entities.map((e) => ({ ...e, positions: [...e.positions] }))
  const claimed = working.flatMap((e) => e.positions.map((p) => ({ ...p })))
  const created = new Map<string, Entity>()
  let changed = false

  // Длинные формы первыми: «ООО «Гамма»» занимает место раньше, чем «Гамма».
  const ordered = [...forms.values()].sort((a, b) => b.text.length - a.text.length)
  for (const form of ordered) {
    const key = keyOf(form.type, form.text)
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(form.text)}(?![\\p{L}\\p{N}])`, 'giu')
    for (const m of searchable.matchAll(pattern)) {
      const start = m.index
      const end = start + m[0].length
      if (keyOf(form.type, sourceText.slice(start, end)) !== key) continue
      const overlapping = claimed.filter((c) => start < c.end && c.start < end)
      if (overlapping.length > 0) {
        const candidate = working.find((e) => e.candidate && !e.dismissed && e.type === form.type &&
          e.positions.some((p) => p.start === start && p.end === end))
        if (candidate && overlapping.length === 1) {
          candidate.candidate = false
          candidate.candidateNote = undefined
          candidate.relatedTo = undefined
          candidate.anonymize = true
          changed = true
        }
        continue
      }
      const owner = working.find((e) => isMain(e) && e.type === form.type && entityKeys(e, sourceText).includes(key))
        ?? created.get(key)
      if (owner) {
        owner.positions.push({ start, end })
      } else {
        const entity: Entity = {
          id: crypto.randomUUID(),
          type: form.type,
          value: sourceText.slice(start, end),
          placeholder: `[${form.type}_${nextPlaceholderNumber(working, form.type)}]`,
          positions: [{ start, end }],
          anonymize: true,
          manual: false,
        }
        created.set(key, entity)
        working.push(entity)
      }
      claimed.push({ start, end })
      changed = true
    }
  }
  if (!changed) return entities
  for (const e of working) e.positions.sort((a, b) => a.start - b.start)
  return working
}
