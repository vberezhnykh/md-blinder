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
  // Matches only upper-case IBANs ([A-Z]{2}\d{2}…); lower-case IBANs are not detected.
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
    // An all-letter candidate (no digits) that reads as an English word is almost
    // always a heading, not a BIC — e.g. ALL-CAPS "APPOINTMENT"/"TERMINATION",
    // whose chars 5–6 ("IN") are a valid ISO country code. Real BICs either carry
    // digits in the location/branch part or sit next to a SWIFT/BIC label. So
    // require that label context for ANY all-alpha code (8 OR 11 chars); the old
    // guard only covered 8-char codes and let 11-letter words through as SWIFT.
    const isAllAlpha = /^[A-Z]+$/.test(code)
    if (isAllAlpha) {
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

    // Двойная метка ("Address: Address: …", частая при извлечении из таблиц):
    // пропускаем внешнюю — внутреннюю поймает следующая итерация labelRe, дав
    // значение, начинающееся с самого адреса (а не со слова "Address"). Без
    // этого фрагмент "Address: 11 …" стартует раньше многострочного адреса и
    // блокирует его в resolveOverlaps.
    if (/^\s*(?:registered\s+office\s+|business\s+|legal\s+|postal\s+|residential\s+|correspondence\s+)?address\s*:/i.test(raw)) continue

    const cuts: number[] = []
    const fm = fieldRe.exec(raw)
    if (fm) cuts.push(fm.index)
    const cm = contactFieldRe.exec(raw)
    if (cm) cuts.push(cm.index)
    // Граница ячейки таблицы: docx-таблицы склеивают ряд в одну «строку» через
    // <br> и |, поэтому без этой обрезки адрес проглатывал бы весь ряд (телефон,
    // компанию, подпись-подчёркивания) — структурный ADDRESS перебивает PHONE и
    // др. в resolveOverlaps. Обрезаем по первому <br> / | / ряду подчёркиваний.
    const bm = /<br\s*\/?>|\||(?:\\?_){3,}/i.exec(raw)
    if (bm) cuts.push(bm.index)
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

// C2: US notice-block addresses that carry NO "Address:" label (SEC "If to:" /
// "Attn:" blocks), which the labeled detector above can't see and GLiNER-small
// misses. Anchored on the strong tail ", <state> <ZIP5>" (state = validated
// 2-letter USPS code OR full name) and a leading house number, so the whole
// span — "3900 Freedom Circle, Suite # 200, Santa Clara, CA 95054" — is caught
// while the specificity keeps prose false-positives low. Structural, so it wins
// overlaps against NER fragments in resolveOverlaps. Non-US addresses without a
// ZIP/state (e.g. Indian/Chinese) are out of scope here — left to NER/gray zone.
const US_STATE_NAMES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois',
  'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana',
  'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
  'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  'District of Columbia',
]
const US_STATE_ABBR = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]
// Full names first so a longer state name wins over a 2-letter prefix.
const US_STATE_ALT = [...US_STATE_NAMES, ...US_STATE_ABBR].join('|')
const US_ADDRESS_RE = new RegExp(
  String.raw`\b\d+\s+[^,\n]+(?:,\s*[^,\n]+){0,7}?,\s*(?:` + US_STATE_ALT + String.raw`)\s+\d{5}(?:-\d{4})?\b`,
  'g',
)

// Multi-line variant: PDF/docx extraction often splits a notice-block address
// across lines — "11 Hurley Street\n\n----------- Cambridge, MA 02141",
// "1300 Oakside Circle\nChanhassen, MN 55317" — which the single-line regex
// (its [^,\n] can't cross a newline) misses. Here the street line and the
// "City, <state> <ZIP>" line are joined across 1–3 line breaks plus any table
// separator noise (dashes/pipes/underscores). To keep false positives down the
// street line must contain a street-type suffix, so bare "500 units\n…" lines
// aren't swallowed. norm() in the harness collapses the separator noise, so the
// messy span still scores against the clean gold value.
const US_STREET_SUFFIX =
  String.raw`(?:street|st|avenue|ave|road|rd|circle|cir|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|parkway|pkwy|highway|hwy|square|sq|expressway|row|plaza|terrace|ter|trail|building|bldg|suite|ste|way)`
const US_ADDRESS_MULTILINE_RE = new RegExp(
  String.raw`\b\d+[ \t]+[^\n]{0,50}?\b` + US_STREET_SUFFIX +
    String.raw`\b[^\n]{0,30}?(?:[ \t\-|_*]*\n){1,3}[ \t\-|_*]*[A-Za-z][^,\n]{1,40},[ \t]*(?:` +
    US_STATE_ALT + String.raw`)[ \t]+\d{5}(?:-\d{4})?\b`,
  'gi',
)

function detectUsAddress(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  for (const re of [US_ADDRESS_RE, US_ADDRESS_MULTILINE_RE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const value = m[0].trim()
      matches.push({ type: 'ADDRESS', value, start: m.index, end: m.index + value.length })
    }
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
    ...detectUsAddress(text),
  ]
}
