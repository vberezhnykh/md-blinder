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

// СНИЛС «123-456-789 01» по форме неотличим от телефона: 11 цифр с
// разделителями, мимо всех фильтров detectPhone. detectSnils отдаёт РОВНО тот же
// спан, а при совпадающих границах resolveOverlaps разруливал бы конфликт
// порядком элементов в массиве — то есть случайно. Гасим здесь явно, тем же
// приёмом, что даты и CEP.
function isSnilsLike(s: string): boolean {
  return /^\d{3}-\d{3}-\d{3}[\s-]\d{2}$/.test(s.trim())
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
    if (isSnilsLike(raw)) continue
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

// Российские структурные идентификаторы: ИНН/ОГРН(ИП)/КПП.
// ВАЖНО: метки — кириллица, а \b в JS определяет границу слова только по ASCII
// (все кириллические буквы для \b — «не-слово», как и пробел), поэтому перед
// " КПП 123…" граница \bКПП не сработает (и пробел, и «К» — оба \W). Вместо
// этого используем lookbehind/lookahead по буквенным классам (кириллица+латиница).
const NOT_LETTER_BEFORE = '(?<![А-Яа-яЁёA-Za-z])'
const NOT_LETTER_AFTER = '(?![А-Яа-яЁёA-Za-z])'

function detectRussianIds(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  // Диапазоны, уже эмитнутые combined-паттерном ("ИНН / КПП …") — простые
  // паттерны ниже пропускают пересекающиеся матчи, чтобы не задвоить КПП.
  const consumed: { start: number; end: number }[] = []
  const overlaps = (s: number, e: number) => consumed.some((c) => s < c.end && c.start < e)

  // Совмещённая форма "ИНН / КПП 7736321479 / 773601001" (иногда с табуляцией
  // вместо пробела): простые паттерны её не берут, т.к. после "ИНН" идёт "/ КПП",
  // а не цифры. Флаг d + m.indices даёт точные офсеты обеих захваченных групп.
  const combinedRe = new RegExp(
    NOT_LETTER_BEFORE + 'ИНН\\s*\\/\\s*КПП' + NOT_LETTER_AFTER + '[\\s:№.]*(\\d{12}|\\d{10})\\s*\\/\\s*(\\d{9})(?!\\d)',
    'gid',
  )
  let cm: RegExpExecArray | null
  while ((cm = combinedRe.exec(text))) {
    const indices = (cm as RegExpExecArray & { indices: Array<[number, number] | undefined> }).indices
    const innRange = indices[1]
    const kppRange = indices[2]
    if (!innRange || !kppRange) continue
    const [innStart, innEnd] = innRange
    const [kppStart, kppEnd] = kppRange
    matches.push({ type: 'REG_NUMBER', value: cm[1], start: innStart, end: innEnd })
    matches.push({ type: 'REG_NUMBER', value: cm[2], start: kppStart, end: kppEnd })
    consumed.push({ start: innStart, end: innEnd }, { start: kppStart, end: kppEnd })
  }

  // ИНН: 10 цифр (юрлицо) или 12 (физлицо/ИП). 12 ставим ПЕРЕД 10 в альтернации,
  // иначе 12-значный ИНН обрежется до первых 10 цифр.
  const innRe = new RegExp(NOT_LETTER_BEFORE + 'ИНН' + NOT_LETTER_AFTER + '[\\s:№.\\/-]*(\\d{12}|\\d{10})(?!\\d)', 'gi')
  let im: RegExpExecArray | null
  while ((im = innRe.exec(text))) {
    const group = im[1]
    const groupStart = im.index + im[0].indexOf(group)
    const groupEnd = groupStart + group.length
    if (overlaps(groupStart, groupEnd)) continue
    matches.push({ type: 'REG_NUMBER', value: group, start: groupStart, end: groupEnd })
  }

  // ОГРНИП (15 цифр) проверяем ПЕРЕД ОГРН (13, изредка тоже 15 — иногда ОГРН
  // пишут и для ИП), иначе метка "ОГРН" съест префикс у "ОГРНИП".
  const ogrnipRe = new RegExp(NOT_LETTER_BEFORE + 'ОГРНИП' + NOT_LETTER_AFTER + '[\\s:№.\\/-]*(\\d{15})(?!\\d)', 'gi')
  let opm: RegExpExecArray | null
  while ((opm = ogrnipRe.exec(text))) {
    const group = opm[1]
    const groupStart = opm.index + opm[0].indexOf(group)
    const groupEnd = groupStart + group.length
    if (overlaps(groupStart, groupEnd)) continue
    matches.push({ type: 'REG_NUMBER', value: group, start: groupStart, end: groupEnd })
    consumed.push({ start: groupStart, end: groupEnd })
  }

  const ogrnRe = new RegExp(NOT_LETTER_BEFORE + 'ОГРН' + NOT_LETTER_AFTER + '[\\s:№.\\/-]*(\\d{15}|\\d{13})(?!\\d)', 'gi')
  let om: RegExpExecArray | null
  while ((om = ogrnRe.exec(text))) {
    const group = om[1]
    const groupStart = om.index + om[0].indexOf(group)
    const groupEnd = groupStart + group.length
    if (overlaps(groupStart, groupEnd)) continue
    matches.push({ type: 'REG_NUMBER', value: group, start: groupStart, end: groupEnd })
  }

  // КПП: 9 цифр.
  const kppRe = new RegExp(NOT_LETTER_BEFORE + 'КПП' + NOT_LETTER_AFTER + '[\\s:№.\\/-]*(\\d{9})(?!\\d)', 'gi')
  let km: RegExpExecArray | null
  while ((km = kppRe.exec(text))) {
    const group = km[1]
    const groupStart = km.index + km[0].indexOf(group)
    const groupEnd = groupStart + group.length
    if (overlaps(groupStart, groupEnd)) continue
    matches.push({ type: 'REG_NUMBER', value: group, start: groupStart, end: groupEnd })
  }

  return matches
}

// Украинские структурные идентификаторы: ЄДРПОУ/ІПН/РНОКПП.
// В отличие от русских меток, украинские метки содержат буквы і/ї/є/ґ, которых
// нет в диапазоне А-Яа-яЁё, поэтому lookbehind/lookahead по этому диапазону
// (как в NOT_LETTER_BEFORE/NOT_LETTER_AFTER выше) их не покрывает: перед "і" в
// "…ЄДРПОУі" граница не сработала бы. Вместо диапазона используем Unicode-класс
// \p{L} (флаг u) — он покрывает вообще все буквы (рус/укр/лат), а не только
// перечисленные явно.
const UA_NOT_LETTER_BEFORE = '(?<!\\p{L})'
const UA_NOT_LETTER_AFTER = '(?!\\p{L})'

function detectUkrainianIds(text: string): RawMatch[] {
  const matches: RawMatch[] = []

  // ЄДРПОУ: 8 цифр. Якорь — само слово "ЄДРПОУ"; префикс "код"/"код за" перед
  // ним необязателен ("ЄДРПОУ 12345678", "код за ЄДРПОУ 12345678" — в обоих
  // случаях после метки идут только разделители и число).
  const edrpouRe = new RegExp(
    UA_NOT_LETTER_BEFORE + 'ЄДРПОУ' + UA_NOT_LETTER_AFTER + '[\\s:№#.-]*(\\d{8})(?!\\d)',
    'giu',
  )
  let m: RegExpExecArray | null
  while ((m = edrpouRe.exec(text))) {
    const group = m[1]
    const groupStart = m.index + m[0].indexOf(group)
    matches.push({ type: 'REG_NUMBER', value: group, start: groupStart, end: groupStart + group.length })
  }

  // ІПН: 10 цифр (физлицо) либо 12 (ІПН/ПДВ юрлица). 12 ставим ПЕРЕД 10 в
  // альтернации — иначе 12-значный номер обрежется до первых 10 цифр.
  const ipnRe = new RegExp(
    UA_NOT_LETTER_BEFORE + 'ІПН' + UA_NOT_LETTER_AFTER + '[\\s:№#.-]*(\\d{12}|\\d{10})(?!\\d)',
    'giu',
  )
  while ((m = ipnRe.exec(text))) {
    const group = m[1]
    const groupStart = m.index + m[0].indexOf(group)
    matches.push({ type: 'REG_NUMBER', value: group, start: groupStart, end: groupStart + group.length })
  }

  // РНОКПП (реєстраційний номер облікової картки платника податків) — 10 цифр,
  // аналог ІПН физлица под другим названием.
  const rnokppRe = new RegExp(
    UA_NOT_LETTER_BEFORE + 'РНОКПП' + UA_NOT_LETTER_AFTER + '[\\s:№#.-]*(\\d{10})(?!\\d)',
    'giu',
  )
  while ((m = rnokppRe.exec(text))) {
    const group = m[1]
    const groupStart = m.index + m[0].indexOf(group)
    matches.push({ type: 'REG_NUMBER', value: group, start: groupStart, end: groupStart + group.length })
  }

  return matches
}

// Российские банковские счета (р/с, к/с, расчётный/корр. счёт) — ровно 20 цифр.
// Метки — кириллица, поэтому та же оговорка про \b, что и в detectRussianIds:
// используем буквенные lookbehind/lookahead вместо \b.
function detectRussianAccounts(text: string): RawMatch[] {
  const re =
    /(?<![А-Яа-яЁёA-Za-z])(?:р\/с|к\/с|р\/сч|расч[ёе]тн[а-яё]*\s+сч[ёе]т[а-яё]*|корр[а-яё.]*\s*сч[ёе]т[а-яё]*)(?![А-Яа-яЁёA-Za-z])[\s:№./-]*(\d{20})(?!\d)/gi
  const matches: RawMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const group = m[1]
    const groupStart = m.index + m[0].indexOf(group)
    matches.push({ type: 'ACCOUNT', value: group, start: groupStart, end: groupStart + group.length })
  }
  return matches
}

// СНИЛС — 11 цифр, канонично «123-456-789 01». Два пути: по метке (тогда
// принимаем и слитную запись) и по самому дефисному формату, который достаточно
// специфичен, чтобы стоять без метки.
//
// Контрольную сумму не проверяем — та же логика, что и с CNPJ выше: формат и так
// узкий, а сверка контрольного числа резала бы recall на номерах с опечатками и
// ошибками OCR. Для анонимизации ложноположительное срабатывание дешевле пропуска.
//
// Тип REG_NUMBER, а не отдельный: СНИЛС стоит в одном ряду с ИНН физлица, ІПН и
// РНОКПП, которые уже размечаются так же.
function detectSnils(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  const consumed: { start: number; end: number }[] = []

  const labelledRe = new RegExp(
    NOT_LETTER_BEFORE + 'СНИЛС' + NOT_LETTER_AFTER +
      '[\\s:№#.-]*(\\d{3}\\s?-\\s?\\d{3}\\s?-\\s?\\d{3}[\\s-]?\\d{2}|\\d{11})(?!\\d)',
    'gi',
  )
  let m: RegExpExecArray | null
  while ((m = labelledRe.exec(text))) {
    const group = m[1]
    const start = m.index + m[0].indexOf(group)
    const end = start + group.length
    matches.push({ type: 'REG_NUMBER', value: group, start, end })
    consumed.push({ start, end })
  }

  // Голый дефисный формат без метки. Не берём слитные 11 цифр — они неотличимы
  // от телефона и любого другого длинного числа.
  const bareRe = /(?<!\d)\d{3}-\d{3}-\d{3}[\s-]\d{2}(?!\d)/g
  while ((m = bareRe.exec(text))) {
    const start = m.index
    const end = start + m[0].length
    if (consumed.some((c) => start < c.end && c.start < end)) continue
    matches.push({ type: 'REG_NUMBER', value: m[0], start, end })
  }

  return matches
}

// Слова, которые допустимо встретить между меткой «паспорт» и самим номером.
// Всё, чего здесь нет, обрывает разбор — так «паспорт сделки», «паспорт
// объекта», «паспорт качества» не превращаются в персональные данные.
const PASSPORT_FILLER_WORDS = new Set([
  'серия', 'серии', 'серию', 'сер', 'серія', 'серії', 'номер', 'номера', 'нр',
  'no', 'nr', 'number', 'series', 'id', 'док', 'документ',
  'гражданина', 'гражданки', 'громадянина', 'громадянки',
  'рф', 'рб', 'россии', 'российской', 'федерации', 'украины', 'україни',
  'казахстана', 'республики', 'беларусь', 'узбекистана', 'таджикистана',
])

// Определения, после которых «паспорт» означает документ на вещь, а не на
// человека. Метка ловится вместе с ними (они стоят ПЕРЕД словом, поэтому
// разбором «что идёт после метки» не отсекаются).
const PASSPORT_NOT_ID_BEFORE =
  /(?:техническ|кадастров|санитарн|ветеринарн|энергетическ|качеств|безопасност|заводск|электронн)\p{L}*\s+$/iu

// Паспорта. Единственный надёжный якорь — метка: номер паспорта почти в любой
// стране это просто буквенно-цифровая строка, и детектор «по форме» собрал бы
// половину документа. Поэтому разбор всегда начинается со слова
// «паспорт»/«passport», а значение берётся из того, что идёт следом.
//
// Разбираем не одним мега-регексом, а сканом токенов после метки: это даёт
// поддержку любой страны без перечисления форматов и, главное, корректно ведёт
// себя с разорванной записью. «паспорт 4506 123456» — один спан на обе группы;
// «паспорт серия 4506 номер 123456» — два отдельных спана, слово «номер» между
// ними остаётся в тексте, а не уезжает под плейсхолдер.
//
// Дата и орган выдачи («выдан 12.05.2010 ОВД…») в спан не попадают: «выдан» не
// служебное слово, скан на нём останавливается.
function detectPassport(text: string): RawMatch[] {
  const matches: RawMatch[] = []

  const labelRe =
    /(?<!\p{L})(?:закордонн\p{L}*\s+|заграничн\p{L}*\s+|загран)?(?:паспорт\p{L}*|passport)(?!\p{L})/giu
  let lm: RegExpExecArray | null
  while ((lm = labelRe.exec(text))) {
    if (PASSPORT_NOT_ID_BEFORE.test(text.slice(Math.max(0, lm.index - 24), lm.index))) continue

    const windowStart = lm.index + lm[0].length
    const window = text.slice(windowStart, windowStart + 70)

    // Токены: число (возможно с внутренними пробелами), слово, разделитель.
    const tokenRe = /(\d[\d\s]*\d|\d)|(\p{L}+)|([:№#.,/\\-]+)|(\S)/gu
    const runs: { start: number; end: number }[] = []
    let digitCount = 0
    let pendingPrefix: { start: number; end: number } | null = null
    let t: RegExpExecArray | null
    while ((t = tokenRe.exec(window))) {
      const [raw, digits, word, sep] = t
      if (sep) {
        pendingPrefix = null
        continue
      }
      if (word) {
        // Короткая ЗАГЛАВНАЯ группа букв перед цифрами — буквенная серия
        // (украинский «АВ 123456», загранпаспорта). Держим её до следующего
        // токена: если дальше цифры, она войдёт в спан, иначе разбор оборвётся.
        if (/^[A-ZА-ЯЁІЇЄҐ]{1,3}$/u.test(raw)) {
          pendingPrefix = { start: t.index, end: t.index + raw.length }
          continue
        }
        if (PASSPORT_FILLER_WORDS.has(raw.toLowerCase())) {
          pendingPrefix = null
          continue
        }
        break
      }
      if (digits) {
        const trimmed = raw.trimEnd()
        const start = pendingPrefix ? pendingPrefix.start : t.index
        const end = t.index + trimmed.length
        digitCount += trimmed.replace(/\D/g, '').length
        // Смежные группы («4506 123456») склеиваем в один спан: между ними
        // только пробел, значит это одна запись номера.
        const last = runs[runs.length - 1]
        if (last && !pendingPrefix && window.slice(last.end, t.index).trim() === '') {
          last.end = end
        } else {
          runs.push({ start, end })
        }
        pendingPrefix = null
        if (runs.length >= 3) break
        continue
      }
      break
    }

    // Слишком короткое число после метки («паспорт № 5») — это не номер паспорта.
    if (digitCount < 6) continue
    for (const r of runs) {
      matches.push({
        type: 'PASSPORT',
        value: window.slice(r.start, r.end),
        start: windowStart + r.start,
        end: windowStart + r.end,
      })
    }
  }

  // Код подразделения — часть паспортных данных, метка однозначная.
  const subdivisionRe = /(?<!\p{L})код\s+подразделения(?!\p{L})[\s:№#.-]*(\d{3}\s?-?\s?\d{3})(?!\d)/giu
  let sm: RegExpExecArray | null
  while ((sm = subdivisionRe.exec(text))) {
    const group = sm[1]
    const start = sm.index + sm[0].indexOf(group)
    matches.push({ type: 'PASSPORT', value: group, start, end: start + group.length })
  }

  return matches
}

// Домены верхнего уровня для «голых» адресов без схемы и без www. Список, а не
// «любые 2-24 буквы»: иначе детектор принимает за сайт имена файлов
// («приложение.doc», «акт.pdf») и сокращения с точкой.
const URL_TLDS =
  'com|net|org|ru|su|ua|by|kz|kg|uz|am|az|ge|md|lv|lt|ee|uk|de|fr|es|it|nl|be|at|ch|pl|cz|sk|hu|ro|bg|rs|si|hr|gr|pt|se|no|fi|dk|ie|tr|il|ae|sa|cn|jp|kr|in|sg|hk|us|ca|mx|br|au|nz|za|eu|io|co|me|tv|cc|ws|info|biz|pro|name|online|site|store|shop|tech|app|dev|cloud|group|agency|legal|law|digital|media|team|world|space|website|link|xyz'

const URL_DOMAIN_SRC = `[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9-]{1,63})*\\.(?:${URL_TLDS})`
const URL_PATH_SRC = '(?:/[^\\s<>()\\[\\]"\'«»]*)?'

// Сайты. Три уровня уверенности, от самого надёжного к самому рискованному:
// схема (https://…), префикс www., и наконец голый домен по списку TLD.
//
// У голого домена есть дополнительное условие — он должен быть записан в
// исходнике строчными буквами. Это дёшево отсекает случайные совпадения вроде
// «Ltd.Co» и «АО.Ру», не трогая реальные адреса: в реквизитах их пишут строчными.
// Цена — пропуск «Example.com» с заглавной в начале предложения; такие случаи
// добираются меткой («Сайт: Example.com») и серой зоной.
//
// Почтовые адреса не задеваются: lookbehind отсекает позицию после «@», а даже
// если бы совпало — EMAIL начинается раньше и выигрывает в resolveOverlaps.
function detectWebsite(text: string): RawMatch[] {
  const matches: RawMatch[] = []
  const consumed: { start: number; end: number }[] = []

  const push = (raw: string, rawStart: number) => {
    // Хвостовая пунктуация — часть предложения, а не адреса.
    const value = raw.replace(/[.,;:!?)»"'\]]+$/, '')
    if (!value) return
    const start = rawStart
    const end = start + value.length
    if (consumed.some((c) => start < c.end && c.start < end)) return
    matches.push({ type: 'URL', value, start, end })
    consumed.push({ start, end })
  }

  const schemeRe = /(?<![\w@])https?:\/\/[^\s<>()[\]"'«»]+/gi
  let m: RegExpExecArray | null
  while ((m = schemeRe.exec(text))) push(m[0], m.index)

  const wwwRe = new RegExp(`(?<![\\w@./-])www\\.[a-z0-9-]+(?:\\.[a-z0-9-]+)+${URL_PATH_SRC}`, 'gi')
  while ((m = wwwRe.exec(text))) push(m[0], m.index)

  // По метке — регистр значения уже неважен, метка сама по себе достаточный сигнал.
  const labelledRe = new RegExp(
    `(?<!\\p{L})(?:веб-?сайт|сайт|website|web-?site|url|домен)(?!\\p{L})[\\s:№#-]*` +
      `((?:https?://)?${URL_DOMAIN_SRC}${URL_PATH_SRC})(?![\\w-])`,
    'giu',
  )
  while ((m = labelledRe.exec(text))) {
    const group = m[1]
    push(group, m.index + m[0].indexOf(group))
  }

  const bareRe = new RegExp(`(?<![\\w@./-])${URL_DOMAIN_SRC}${URL_PATH_SRC}(?![\\w-])`, 'gi')
  while ((m = bareRe.exec(text))) {
    if (m[0] !== m[0].toLowerCase()) continue
    push(m[0], m.index)
  }

  return matches
}

export function detectStructural(text: string): RawMatch[] {
  return [
    ...detectEmail(text),
    ...detectIban(text),
    ...detectRussianIds(text),
    ...detectRussianAccounts(text),
    ...detectUkrainianIds(text),
    ...detectSnils(text),
    ...detectPassport(text),
    ...detectWebsite(text),
    ...detectCard(text),
    ...detectSwift(text),
    ...detectPhone(text),
    ...detectAccount(text),
    ...detectRegNumber(text),
    ...detectAddress(text),
    ...detectUsAddress(text),
  ]
}
