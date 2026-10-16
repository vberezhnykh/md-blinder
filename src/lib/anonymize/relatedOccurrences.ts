import { nextPlaceholderNumber } from './apply'
import { normalizeValue } from './normalizeValue'
import { maskImagesForDetection } from './imageSafety'
import type { Entity } from './types'

// B3: поиск «родственных» вхождений подтверждённых сущностей — недетектированных
// форм того же ПД (фамилия без имени, инициалы+фамилия, косвенные падежи для
// кириллицы, название компании без ОПФ/аббревиатура, переформатированные
// email/телефон). Всё найденное уходит в «серую зону» (B1) как кандидат со
// ссылкой relatedTo на исходную сущность; причина «Похоже на [PLACEHOLDER]»
// вычисляется при показе (candidateReason), чтобы метка не устаревала после
// перенумерации. Ничего не анонимизируется автоматически.

const LEGAL_FORMS = new Set([
  'ltd', 'limited', 'llc', 'llp', 'inc', 'incorporated', 'plc', 'corp',
  'corporation', 'co', 'company', 'gmbh', 'kft', 'ag', 'sa', 'bv', 'nv', 'oy',
  'ab', 'as', 'spa', 'srl', 'pllc', 'pc',
  'ооо', 'оао', 'зао', 'пао', 'ао', 'нко', 'нао', 'пк',
  'тов', 'пат', 'прат', 'пп', 'фоп', 'кп', 'дп',
])

const QUOTE_RE = /[«»"“”„'‘’`]/g
const CYR_RE = /[Ѐ-ӿ]/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Граница «слова» с поддержкой кириллицы (JS \b — только ASCII).
function boundedWord(inner: string): string {
  return `(?<![\\p{L}\\p{N}])(?:${inner})(?![\\p{L}\\p{N}])`
}

interface Form { pattern: RegExp; minLen: number }

function wordForm(word: string, minLen = 4): Form {
  return { pattern: new RegExp(boundedWord(escapeRegExp(word)), 'giu'), minLen }
}

function splitWords(value: string): string[] {
  return value
    .replace(QUOTE_RE, ' ')
    .split(/[\s,./\\]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
}

function isInitialToken(w: string): boolean {
  return /^\p{L}\.?$/u.test(w)
}

// Простая таблица суффиксов косвенных падежей кириллической фамилии (без
// морфоанализа). Над-генерация допустима — всё уходит в кандидаты на проверку.
function cyrillicDeclensions(surname: string): string[] {
  const forms = new Set<string>()
  if (/(?:ский|цкий|ой|ый|ий)$/u.test(surname)) {
    const stem = surname.replace(/(?:ий|ый|ой)$/u, '')
    for (const suf of ['ого', 'ому', 'ым', 'ом', 'ая', 'ой', 'ую']) forms.add(stem + suf)
  } else {
    for (const suf of ['а', 'у', 'ом', 'ым', 'е', 'ой', 'ых', 'ову', 'ове']) forms.add(surname + suf)
  }
  forms.delete(surname)
  return [...forms].filter((f) => f.length >= 4)
}

function initialsForms(words: string[]): Form[] {
  const names = words.filter((w) => !isInitialToken(w) && w.length >= 2)
  if (names.length < 2) return []
  const forms: Form[] = []
  const push = (initialWords: string[], surname: string, initialsFirst: boolean) => {
    if (initialWords.length === 0) return
    const inits = initialWords.map((w) => `${escapeRegExp(w[0])}\\.?`).join('\\s*')
    const sur = escapeRegExp(surname)
    const inner = initialsFirst ? `${inits}\\s*${sur}` : `${sur}\\s*${inits}`
    forms.push({ pattern: new RegExp(boundedWord(inner), 'giu'), minLen: surname.length })
  }
  // первое слово как фамилия (рус. порядок «Фамилия Имя Отчество»)
  push(names.slice(1), names[0], true)
  push(names.slice(1), names[0], false)
  // последнее слово как фамилия (зап. порядок «Имя … Фамилия»)
  push(names.slice(0, -1), names[names.length - 1], true)
  push(names.slice(0, -1), names[names.length - 1], false)
  return forms
}

function personForms(value: string): Form[] {
  const words = splitWords(value)
  const names = words.filter((w) => !isInitialToken(w))
  const forms: Form[] = []
  // Порядок важен: сначала длинные формы (инициалы+фамилия), затем склонения,
  // затем одиночные слова — чтобы «И.И. Иванов» застолбил спан раньше, чем голое
  // «Иванов» перехватит подстроку внутри него.
  forms.push(...initialsForms(words))
  for (const w of names) {
    if (CYR_RE.test(w)) for (const d of cyrillicDeclensions(w)) forms.push(wordForm(d))
  }
  for (const w of names) {
    if (w.length >= 4) forms.push(wordForm(w))
  }
  return forms
}

// Слова названия компании без ОПФ и кавычек: «ООО «Гамма Плюс»» → ['Гамма', 'Плюс'].
export function companyCoreWords(value: string): string[] {
  return splitWords(value).filter((w) => !LEGAL_FORMS.has(w.toLowerCase().replace(/\.$/, '')))
}

function companyForms(value: string): Form[] {
  const core = companyCoreWords(value)
  const forms: Form[] = []
  // Полная «ядровая» фраза (без ОПФ/кавычек) — первой, чтобы застолбить спан.
  if (core.length >= 2) {
    const phrase = core.join(' ')
    if (phrase.toLowerCase() !== value.toLowerCase()) {
      forms.push({ pattern: new RegExp(boundedWord(core.map(escapeRegExp).join('\\s+')), 'giu'), minLen: 4 })
    }
    const acronym = core.map((w) => w[0]).join('')
    if (acronym.length >= 2) forms.push({ pattern: new RegExp(boundedWord(escapeRegExp(acronym)), 'giu'), minLen: 2 })
  }
  if (core.length >= 1 && core[0].length >= 4) forms.push(wordForm(core[0]))
  return forms
}

function emailForms(value: string): Form[] {
  const flexible = escapeRegExp(value).replace(/@/g, '\\s*@\\s*').replace(/\\\./g, '\\s*\\.\\s*')
  return [{ pattern: new RegExp(flexible, 'giu'), minLen: 4 }]
}

function phoneForms(value: string): Form[] {
  const core = value.replace(/[^\d+]/g, '').replace(/^\+/, '')
  if (core.length < 7) return []
  const sep = '[\\s\\-().]*'
  const body = core.split('').map(escapeRegExp).join(sep)
  return [{ pattern: new RegExp(`(?<!\\d)\\+?${sep}${body}(?!\\d)`, 'g'), minLen: 7 }]
}

function formsFor(entity: Entity): Form[] {
  const exact = [wordForm(entity.value, 2)]
  switch (entity.type) {
    case 'PERSON': return [...exact, ...personForms(entity.value)]
    case 'COMPANY': return [...exact, ...companyForms(entity.value)]
    case 'EMAIL': return [...exact, ...emailForms(entity.value)]
    case 'PHONE': return [...exact, ...phoneForms(entity.value)]
    default: return exact
  }
}

export function findRelatedOccurrences(sourceText: string, entities: Entity[]): Entity[] {
  const sources = entities.filter((e) => !e.candidate && !e.dismissed && e.anonymize)
  const searchableText = maskImagesForDetection(sourceText)
  const claimed: { start: number; end: number }[] = entities.flatMap((e) =>
    e.positions.map((p) => ({ start: p.start, end: p.end })),
  )
  const working: Entity[] = [...entities]
  const result: Entity[] = []

  interface G {
    type: Entity['type']
    relatedTo: string
    firstValue: string
    firstStart: number
    positions: { start: number; end: number }[]
  }
  const groups = new Map<string, G>()

  for (const src of sources) {
    for (const form of formsFor(src)) {
      form.pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = form.pattern.exec(searchableText)) !== null) {
        const text = m[0]
        if (text.length === 0) {
          form.pattern.lastIndex++
          continue
        }
        const start = m.index
        const end = start + text.length
        if (text.length < form.minLen) continue
        if (claimed.some((c) => start < c.end && c.start < end)) continue
        const key = `${src.type} ${normalizeValue(src.type, text)}`
        let g = groups.get(key)
        if (!g) {
          g = { type: src.type, relatedTo: src.id, firstValue: text, firstStart: start, positions: [] }
          groups.set(key, g)
        }
        g.positions.push({ start, end })
        g.firstStart = Math.min(g.firstStart, start)
        claimed.push({ start, end })
      }
    }
  }

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
      relatedTo: g.relatedTo,
    }
    working.push(entity)
    result.push(entity)
  }
  return result
}
