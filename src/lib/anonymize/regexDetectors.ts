import type { RawMatch } from './types'

export const ISO_COUNTRY_CODES = new Set([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
])

function mod97(numStr: string): number {
  let remainder = 0
  for (let i = 0; i < numStr.length; i++) {
    remainder = (remainder * 10 + Number(numStr[i])) % 97
  }
  return remainder
}

function isValidIban(candidate: string): boolean {
  if (!ISO_COUNTRY_CODES.has(candidate.slice(0, 2))) return false
  const rearranged = candidate.slice(4) + candidate.slice(0, 4)
  let numStr = ''
  for (const ch of rearranged) {
    if (ch >= 'A' && ch <= 'Z') {
      numStr += (ch.charCodeAt(0) - 55).toString()
    } else {
      numStr += ch
    }
  }
  return mod97(numStr) === 1
}

function luhnCheck(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

function detectEmail(text: string): RawMatch[] {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  const matches: RawMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    matches.push({ type: 'EMAIL', value: m[0], start: m.index, end: m.index + m[0].length })
  }
  return matches
}

function detectIban(text: string): RawMatch[] {
  const re = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g
  const matches: RawMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (isValidIban(m[0])) {
      matches.push({ type: 'IBAN', value: m[0], start: m.index, end: m.index + m[0].length })
    }
  }
  return matches
}

function detectCard(text: string): RawMatch[] {
  const re = /\b(?:\d[ -]?){13,19}\b/g
  const matches: RawMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const raw = m[0]
    const digits = raw.replace(/[ -]/g, '')
    if (digits.length < 13 || digits.length > 19) continue
    if (!luhnCheck(digits)) continue
    let end = m.index + raw.length
    let trimmed = raw
    while (trimmed.length && (trimmed[trimmed.length - 1] === ' ' || trimmed[trimmed.length - 1] === '-')) {
      trimmed = trimmed.slice(0, -1)
      end--
    }
    matches.push({ type: 'CARD', value: trimmed, start: m.index, end })
  }
  return matches
}

function detectSwift(text: string): RawMatch[] {
  const re = /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g
  const matches: RawMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const code = m[0]
    const country = code.slice(4, 6)
    if (!ISO_COUNTRY_CODES.has(country)) continue
    const hasBranch = code.length === 11
    const isAllAlpha = /^[A-Z]+$/.test(code)
    if (!hasBranch && isAllAlpha) {
      const hasContext = /(?:SWIFT|BIC)\b[^A-Za-z0-9]{0,10}$/i.test(text.slice(0, m.index))
      if (!hasContext) continue
    }
    matches.push({ type: 'SWIFT', value: code, start: m.index, end: m.index + code.length })
  }
  return matches
}

function isDateLike(s: string): boolean {
  const t = s.trim()
  // дд.мм.гггг / дд/мм/гг / дд-мм-гггг (одинаковый разделитель), месяц 1-2 цифры
  if (/^\d{1,2}([./-])\d{1,2}\1\d{2,4}$/.test(t)) return true
  // гггг-мм-дд / гггг.мм.дд
  if (/^\d{4}([./-])\d{1,2}\1\d{1,2}$/.test(t)) return true
  return false
}

function isCepLike(s: string): boolean {
  return /^\d{2}\.\d{3}-\d{3}$/.test(s.trim())
}

const PHONE_LABEL_SRC = 'tel|telephone|phone|mobile|cell|fax'

// Метка телефона непосредственно перед кандидатом (в пределах ~10 символов слева) —
// защищает 3-значную группировку ("Tel: 123 456 789") и разрешает контактную метку
// перед контактным номером без разделителей ("Tel: 0612345678").
function hasPhoneLabelBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 25), index)
  return new RegExp(`\\b(?:${PHONE_LABEL_SRC})\\b[\\s.:#]*$`, 'i').test(before)
}

// Денежная сумма без метки телефона: заканчивается на копейки/центы, ИЛИ похожа на
// группировку по тысячам (все группы после первой — ровно 3 цифры), ИЛИ ей
// предшествует денежный маркер ($ € £ / USD EUR GBP UAH RUB HUF).
function looksLikeMoneySum(raw: string, text: string, index: number): boolean {
  if (raw.includes('+') || /[()]/.test(raw)) return false
  if (hasPhoneLabelBefore(text, index)) return false

  if (/\.\d{2}$/.test(raw)) return true

  const groups = raw.split(/[\s.-]+/).filter(Boolean)
  if (groups.length >= 3 && groups.slice(1).every((g) => g.length === 3)) return true

  const before = text.slice(Math.max(0, index - 6), index)
  if (/(?:[$€£]|USD|EUR|GBP|UAH|RUB|HUF)\s?$/i.test(before)) return true

  return false
}

function detectPhone(text: string): RawMatch[] {
  const matches: RawMatch[] = []

  // Проход 1: номера с разделителями (пробел/точка/дефис/скобки), опциональный код страны.
  // Первая группа цифр обычно 2-5 цифр, НО если перед ней есть код страны (+36 …),
  // разрешаем 1-значный локальный/зоновый код (Будапешт "1" в "+36 1 234 5678") —
  // без кода страны 1-значная группа по-прежнему не считается началом номера.
  const sepRe =
    /(?:\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{1,5}|(?:\(\d{1,4}\)[\s.-]?)?\d{2,5})(?:[\s.-]\d{2,5}){1,4}/g
  const sepMatches: RawMatch[] = []
  let m: RegExpExecArray | null
  while ((m = sepRe.exec(text))) {
    const raw = m[0]
    if (isDateLike(raw)) continue
    if (isCepLike(raw)) continue
    const digits = raw.replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 15) continue
    if (looksLikeMoneySum(raw, text, m.index)) continue
    sepMatches.push({ type: 'PHONE', value: raw, start: m.index, end: m.index + raw.length })
  }
  matches.push(...sepMatches)

  // Проход 2: метка телефона + контактные цифры без разделителей ("Tel: 0612345678",
  // "Phone #: 12025550123"). Без метки голое число НЕ считается телефоном.
  const labelRe = new RegExp(`\\b(?:${PHONE_LABEL_SRC})\\b[\\s.:#]*(\\+?\\d{7,15})`, 'gi')
  let lm: RegExpExecArray | null
  while ((lm = labelRe.exec(text))) {
    const captured = lm[1]
    const groupStart = lm.index + lm[0].length - captured.length
    const groupEnd = groupStart + captured.length
    const digits = captured.replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 15) continue
    // Пропускаем, если пересекается с уже найденным матчем из прохода 1 (он приоритетнее).
    if (sepMatches.some((s) => groupStart < s.end && s.start < groupEnd)) continue
    matches.push({ type: 'PHONE', value: captured, start: groupStart, end: groupEnd })
  }

  return matches
}

function detectAccount(text: string): RawMatch[] {
  const re = /\b(?:account|acct|a\/c|iban)\s*(?:no\.?|number|#)?\s*[:.-]?\s*([A-Z0-9][A-Z0-9 -]{5,30}\d)/gi
  const matches: RawMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const group = m[1]
    const groupStart = m.index + m[0].indexOf(group)
    matches.push({ type: 'ACCOUNT', value: group, start: groupStart, end: groupStart + group.length })
  }
  return matches
}

// Адрес по метке: значение после "business address:" / "registered office address:" /
// "Address:" и т.п. Двоеточие ОБЯЗАТЕЛЬНО — это отсекает прозу вида "registered office
// address of the other Party". Значение берём до конца строки, затем обрезаем по
// ключевому слову следующего поля. GLiNER не тегирует адреса, начинающиеся со страны
// (Georgia, ... / Hungary, ...) — этот детектор ловит их детерминированно. Структурные
// матчи перебивают NER в resolveOverlaps, поэтому регексовый адрес поглощает NER-фрагменты.
function detectAddress(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  const labelRe =
    /\b(?:registered\s+office\s+|business\s+|legal\s+|postal\s+|residential\s+|correspondence\s+|registered\s+)?address\s*:/gi
  // Ключевые слова следующего поля в той же строке — по ним обрезаем хвост значения.
  const fieldRe =
    /,\s*(?:company\s+(?:registration|reg)\b|registration\s+(?:no|number)\b|reg\.?\s*(?:no|number)\b|CRN\b|VAT\b|represented\s+by\b|acting\b|director\b|tel\b|phone\b|fax\b|e-?mail\b|hereinafter\b)/i
  // Помеченное контактное поле (Phone #:, Tel:, Fax:, Email:) обрезаем даже БЕЗ
  // запятой перед ним: Stage 9 может склеить адрес и контакты в один абзац
  // ("... Example City Phone #: <номер>"), и без этой обрезки адрес проглатывал
  // бы телефон (структурный ADDRESS перебивает структурный PHONE).
  const contactFieldRe = /\s(?:telephone|tel|phone|fax|e-?mail|mobile|cell)\b[\s.]*[:#]/i

  let m: RegExpExecArray | null
  while ((m = labelRe.exec(text))) {
    // Не-адресные метки: "email address:", "e-mail address:", "IP address:", "web address:".
    const before = text.slice(Math.max(0, m.index - 8), m.index)
    if (/(?:e-?mail|ip|web|url)\s$/i.test(before)) continue

    const valueStart = m.index + m[0].length
    let lineEnd = text.indexOf('\n', valueStart)
    if (lineEnd === -1) lineEnd = text.length
    let raw = text.slice(valueStart, lineEnd)

    const cuts: number[] = []
    const fm = fieldRe.exec(raw)
    if (fm) cuts.push(fm.index)
    const cm = contactFieldRe.exec(raw)
    if (cm) cuts.push(cm.index)
    if (cuts.length) raw = raw.slice(0, Math.min(...cuts))

    const value = raw.trim()
    const leadWs = raw.length - raw.trimStart().length
    // Похоже на адрес: минимальная длина, есть цифра или запятая, не e-mail.
    if (value.length < 5) continue
    if (value.includes('@')) continue
    if (!/[\d,]/.test(value)) continue

    const start = valueStart + leadWs
    matches.push({ type: 'ADDRESS', value, start, end: start + value.length })
  }
  return matches
}

function detectRegNumber(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  const contextPatterns = [
    /\b(?:company\s+(?:registration\s+)?(?:no|number)|reg(?:istration)?\.?\s*no|CRN|registered\s+number)\b[\s:#.]*([A-Z0-9][A-Z0-9./-]{4,18}[A-Z0-9])/gi,
    /\bVAT(?:\s*(?:reg(?:istration)?|no|number|id))?\b[\s:#.]*([A-Z]{0,2}[\d][\d ]{6,14}\d)/gi,
  ]
  for (const re of contextPatterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const group = m[1]
      const groupStart = m.index + m[0].indexOf(group)
      matches.push({ type: 'REG_NUMBER', value: group, start: groupStart, end: groupStart + group.length })
    }
  }
  const einRe = /\b\d{2}-\d{7}\b/g
  let m: RegExpExecArray | null
  while ((m = einRe.exec(text))) {
    matches.push({ type: 'REG_NUMBER', value: m[0], start: m.index, end: m.index + m[0].length })
  }
  // CNPJ (бразильский рег. номер юрлица), формат ##.###.###/####-##. С июля 2026
  // первые 12 позиций могут быть буквами или цифрами (алфавитно-цифровой CNPJ),
  // последние 2 — всегда контрольные цифры. Формат очень специфичный (точки +
  // слэш + дефис в фиксированных позициях), поэтому проверку контрольной суммы не
  // делаем — это сохраняет recall на номерах с опечатками/OCR-ошибками.
  const cnpjRe = /\b[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2}\b/g
  let c: RegExpExecArray | null
  while ((c = cnpjRe.exec(text))) {
    matches.push({ type: 'REG_NUMBER', value: c[0], start: c.index, end: c.index + c[0].length })
  }
  return matches
}

export function detectStructural(text: string): RawMatch[] {
  return [
    ...detectEmail(text),
    ...detectIban(text),
    ...detectCard(text),
    ...detectSwift(text),
    ...detectPhone(text),
    ...detectAccount(text),
    ...detectRegNumber(text),
    ...detectAddress(text),
  ]
}
