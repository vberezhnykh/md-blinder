import type { RawMatch } from './types'

// Детекторы, перенесенные из Microsoft Presidio (predefined_recognizers,
// коммит d884790). Взяты форматы и правила проверки тех идентификаторов, которые
// встречаются в договорах и не покрыты остальными детекторами.
// License: presidio.LICENSE (MIT, Copyright (c) Presidio Contributors).
//
// В Presidio слабые шаблоны добирают уверенность контекстными словами рядом с
// совпадением. У нас нет оценки уверенности для структурных находок, поэтому
// шаблон, который без контекста дает ложные срабатывания (налоговый номер SARS,
// IPv4), требует метку перед значением, а остальные принимаются только после
// полной проверки формата.

function luhnValid(digits: string): boolean {
  let sum = 0
  const parity = digits.length % 2
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[i])
    if (i % 2 === parity) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

function push(matches: RawMatch[], type: RawMatch['type'], text: string, start: number, end: number) {
  matches.push({ type, value: text.slice(start, end), start, end })
}

// ЮАР, ID-номер: YYMMDD SSSS C A Z — дата рождения, порядковый номер,
// гражданство (0 гражданин, 1 постоянный резидент, 2 беженец), устаревшая
// цифра 8/9 и контрольная цифра Luhn. Дата не может быть в будущем.
export function isZaIdNumber(digits: string, today = new Date()): boolean {
  if (!/^\d{13}$/.test(digits)) return false
  if (!'012'.includes(digits[10]) || !'89'.includes(digits[11])) return false
  const yy = Number(digits.slice(0, 2))
  const month = Number(digits.slice(2, 4))
  const day = Number(digits.slice(4, 6))
  const pivot = today.getFullYear() % 100
  const year = (yy > pivot ? 1900 : 2000) + yy
  const birth = new Date(Date.UTC(year, month - 1, day))
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return false
  if (birth.getTime() > today.getTime()) return false
  return luhnValid(digits)
}

function detectZaIdNumber(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  // Кроме слитной записи из Presidio принимаем принятую группировку 6-4-3.
  const re = /(?<![\d-])(?:\d{13}|\d{6} \d{4} \d{3})(?![\d-])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (isZaIdNumber(m[0].replace(/ /g, ''))) push(matches, 'ID_DOC', text, m.index, m.index + m[0].length)
  }
  return matches
}

// ЮАР, регистрационный номер компании CIPC: YYYY/NNNNNN/NN, у старых форм —
// префикс вида CK1995/012345. Год не позже текущего.
function detectZaCompanyRegistration(text: string, today = new Date()): RawMatch[] {
  const matches: RawMatch[] = []
  const thisYear = today.getFullYear()
  const re = /\b(?:(?:CK|NR|K|T|W|B|M|N)(\d{4})\/\d{6}|(\d{4})\/\d{6}\/\d{2})\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const year = Number(m[1] ?? m[2])
    if (year >= 1800 && year <= thisYear) push(matches, 'REG_NUMBER', text, m.index, m.index + m[0].length)
  }
  return matches
}

// ЮАР, налоговый номер SARS: 10 цифр, первая 0, 1, 2, 3 или 9 (VAT начинается
// с 4 и ловится меткой VAT). Сам по себе шаблон слишком общий, поэтому только
// после метки.
function detectZaTaxNumber(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  const re = /\b(?:income\s+tax|tax\s+ref(?:erence)?|taxpayer(?:\s+ref(?:erence)?)?|tax|SARS|ITR)(?:\s+(?:reference|registration|ref|number|no))*\.?[\s:#.]*([01239]\d{9})\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length - m[1].length
    push(matches, 'REG_NUMBER', text, start, start + m[1].length)
  }
  return matches
}

// США, SSN: средний по надежности шаблон Presidio (3-2-4 с одним видом
// разделителя) и его правила отсева заведомо недействительных номеров.
function isValidUsSsn(raw: string): boolean {
  const delimiters = new Set(raw.replace(/\d/g, ''))
  if (delimiters.size > 1) return false
  const digits = raw.replace(/\D/g, '')
  if (/^(\d)\1*$/.test(digits)) return false
  if (digits.slice(3, 5) === '00' || digits.slice(5) === '0000') return false
  if (digits.startsWith('000') || digits.startsWith('666')) return false
  return !['123456789', '987654320', '078051120'].includes(digits)
}

function detectUsSsn(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  const re = /(?<![\d-])\d{3}[- .]\d{2}[- .]\d{4}(?![\d-])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (isValidUsSsn(m[0])) push(matches, 'REG_NUMBER', text, m.index, m.index + m[0].length)
  }
  return matches
}

// Великобритания, National Insurance Number. Только заглавные буквы: в прозе
// строчные сочетания вида «ab 12 34 56 c» дали бы ложные срабатывания.
function detectUkNino(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  const re = /\b(?!BG|GB|NK|KN|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) push(matches, 'REG_NUMBER', text, m.index, m.index + m[0].length)
  return matches
}

// IP-адреса. IPv4 неотличим от многоуровневой нумерации пунктов («12.1.3.4»),
// поэтому требует метку IP рядом. У IPv6 обязательны «::» или восемь групп,
// поэтому время вида 10:30 под шаблон не попадает.
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4_SRC = `${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}(?:/(?:3[0-2]|[12]?\\d))?`
const IPV6_RE = /(?<![\w:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}|:(?::[0-9A-Fa-f]{1,4}){1,7})(?:\/(?:12[0-8]|1[01]\d|[1-9]?\d))?(?![\w:]|\.\d)/g

function detectIpAddress(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  const v4 = new RegExp(`\\bIP(?:v4)?(?:\\s+address(?:es)?)?\\b[^\\n\\d]{0,24}?(${IPV4_SRC})(?![\\d.])`, 'gi')
  let m: RegExpExecArray | null
  while ((m = v4.exec(text))) {
    const start = m.index + m[0].length - m[1].length
    push(matches, 'OTHER', text, start, start + m[1].length)
    // Перечисление «IP addresses 10.0.0.1, 10.0.0.2 and 10.0.0.3»: адреса после
    // первого в том же списке принадлежат той же метке.
    const list = new RegExp(`^(?:\\s*(?:,|;|and|or|и|или)\\s*)(${IPV4_SRC})(?![\\d.])`, 'i')
    let cursor = start + m[1].length
    let next: RegExpExecArray | null
    while ((next = list.exec(text.slice(cursor)))) {
      const s = cursor + next[0].length - next[1].length
      push(matches, 'OTHER', text, s, s + next[1].length)
      cursor = s + next[1].length
    }
    v4.lastIndex = cursor
  }
  IPV6_RE.lastIndex = 0
  while ((m = IPV6_RE.exec(text))) {
    if (m[0] === '::' || !/[0-9A-Fa-f]{2}/.test(m[0])) continue
    push(matches, 'OTHER', text, m.index, m.index + m[0].length)
  }
  return matches
}

// UUID версий 1–8 с корректным вариантом. Нулевой UUID — служебное значение.
function detectUuid(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  const re = /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-([0-9A-Fa-f])[0-9A-Fa-f]{3}-([0-9A-Fa-f])[0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (!'12345678'.includes(m[1]) || !'89abAB'.includes(m[2])) continue
    push(matches, 'OTHER', text, m.index, m.index + m[0].length)
  }
  return matches
}

export function detectPresidioIds(text: string): RawMatch[] {
  return [
    ...detectZaIdNumber(text),
    ...detectZaCompanyRegistration(text),
    ...detectZaTaxNumber(text),
    ...detectUsSsn(text),
    ...detectUkNino(text),
    ...detectIpAddress(text),
    ...detectUuid(text),
  ]
}
