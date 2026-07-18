import type { RawMatch } from './types'

// Браузерная NER-модель часто ловит определяемые «ролевые» термины договора
// ("Director", "Client", "Service Provider", "disclosing Party", "registered
// office address") как PERSON/COMPANY/ADDRESS, хотя это не конфиденциальные
// данные, а обозначения ролей. Аналогично метка REG_NUMBER иногда ловит саму
// родовую фразу ("Company registration number", "VAT number") без каких-либо
// цифр. Отбрасываем такие матчи, требуя, чтобы в спане был хотя бы один
// настоящий (не-родовой) токен, — так реальные имена, компании (например
// "John Smith", "Acme Ltd", "Baker & Partners") и настоящие рег. номера
// (содержащие цифры) остаются.
// Прочие структурные матчи (EMAIL/IBAN/SWIFT/ACCOUNT/CARD/PHONE) проходят насквозь.

const DETERMINERS = new Set([
  'the', 'a', 'an', 'such', 'any', 'each', 'every', 'either', 'both', 'this',
  'that', 'these', 'those', 'said', 'its', 'their', 'our', 'your', 'his',
  'her', 'other', 'another', 'same', 'sole', 'aforesaid', 'aforementioned',
  'relevant', 'respective', 'applicable',
])

const ROLE_NOUNS = new Set([
  'party', 'parties', 'client', 'clients', 'customer', 'customers',
  'supplier', 'suppliers', 'vendor', 'vendors', 'contractor', 'contractors',
  'subcontractor', 'subcontractors', 'employer', 'employers', 'employee',
  'employees', 'seller', 'sellers', 'buyer', 'buyers', 'purchaser',
  'purchasers', 'licensor', 'licensors', 'licensee', 'licensees', 'lessor',
  'lessee', 'landlord', 'tenant', 'tenants', 'guarantor', 'borrower',
  'lender', 'agent', 'agents', 'principal', 'manufacturer', 'manufacturers',
  'distributor', 'distributors', 'provider', 'providers', 'user', 'users',
  'recipient', 'recipients', 'discloser', 'disclosee', 'beneficiary',
  'affiliate', 'affiliates', 'representative', 'representatives', 'officer',
  'officers', 'director', 'directors', 'manager', 'managers', 'shareholder',
  'shareholders', 'member', 'members', 'partner', 'partners', 'signatory',
  'signatories', 'counterparty', 'company', 'corporation', 'entity',
  'entities', 'individual', 'person', 'persons', 'holder', 'holders',
  'owner', 'owners', 'operator', 'consumer', 'developer',
  // C2: role/defined terms GLiNER over-tags as PERSON/COMPANY on SEC contracts.
  'consultant', 'consultants', 'counsel', 'sponsor', 'sponsors', 'promoter',
  'promoters', 'endorser', 'endorsers', 'appointee', 'appointees', 'addressee',
  'addressees', 'spokesperson', 'staff', 'personnel', 'force', 'agency',
  'agencies', 'trustee', 'trustees', 'nominee', 'nominees', 'assignee',
  'assignor', 'franchisor', 'franchisee', 'payer', 'payee', 'obligor',
  'obligee', 'indemnitor', 'indemnitee', 'attorney', 'advisor', 'adviser',
  'auditor', 'accountant', 'broker', 'dealer', 'reseller', 'integrator',
  // standalone titles (also stripped when leading a name via LEADING_TITLE);
  // as bare spans they read as roles, not PII.
  'ceo', 'cfo', 'cto', 'coo', 'chairman', 'chairperson', 'chairwoman',
  'president', 'secretary', 'treasurer', 'mr', 'mrs', 'ms', 'dr', 'prof',
])

const GENERIC_MODIFIERS = new Set([
  'service', 'services', 'end', 'third', 'non', 'defaulting', 'disclosing',
  'receiving', 'violating', 'breaching', 'indemnifying', 'prevailing',
  'terminating', 'requesting', 'providing', 'purchasing', 'selling',
  'paying', 'performing', 'affected', 'data', 'sub', 'co', 'joint',
  'general', 'managing', 'executive', 'senior', 'junior', 'primary',
  'secondary', 'ultimate', 'immediate', 'main', 'registered', 'additional',
  'new', 'existing', 'relevant', 'respective', 'applicable', 'other',
  // C2: modifiers that combine with role nouns into defined-term FPs
  // ("Notifying Party", "Agency sales force", "Vice President").
  'notifying', 'appointing', 'endorsing', 'sponsoring', 'promoting', 'sales',
  'marketing', 'technical', 'financial', 'legal', 'commercial', 'operational',
  'administrative', 'corporate', 'vice', 'deputy', 'assistant', 'acting',
  'interim', 'regional', 'local', 'national', 'international', 'global',
])

const CONNECTORS = new Set(['and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with'])

// Британский почтовый индекс (формат вида SW1A 1AA, EC1A 1BB). GLiNER иногда тегает
// индекс-хвост адреса как REG_NUMBER — это ложняк, отбрасываем.
const UK_POSTCODE = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/

// Суффиксы юрлиц: PERSON-спан, содержащий такой токен, — это компания, ошибочно
// помеченная человеком (обычно OCR-склейка двух названий: "ACME LIMITED GLOBEX LLC").
// Компании ловятся отдельно, поэтому такой PERSON отбрасываем.
const COMPANY_SUFFIXES = new Set([
  'ltd', 'limited', 'llc', 'llp', 'ltda', 'inc', 'incorporated', 'plc',
  'gmbh', 'kft', 'corp', 'corporation',
])

// Ведущий титул/должность перед именем ("Director John Smith"). Требует
// разделитель после титула, поэтому срабатывает только когда дальше есть имя.
const LEADING_TITLE =
  /^(?:(?:director|manager|mr|mrs|ms|dr|prof|ceo|cfo|cto|coo|chairman|chairperson|chairwoman|president|secretary|treasurer)\.?[\s,]+)+/i

const GENERIC_WORDS = new Set<string>([
  ...DETERMINERS,
  ...ROLE_NOUNS,
  ...GENERIC_MODIFIERS,
  ...CONNECTORS,
])

const GENERIC_ADDRESS_WORDS = new Set([
  'registered', 'office', 'offices', 'address', 'addresses', 'principal',
  'place', 'business', 'head', 'correspondence', 'service', 'home',
  'postal', 'physical', 'mailing', 'billing', 'shipping', 'delivery',
  'main', 'seat', 'premises', 'location', 'locations', 'headquarters',
  'hq', 'of', 'and', 'the', 'its', 'their', 'our',
])

const GENERIC_REGNUM_WORDS = new Set([
  'company', 'companies', 'registration', 'registered', 'number', 'no', 'nos',
  'reg', 'vat', 'tax', 'id', 'identification', 'identifier', 'code', 'corporate',
  'corporation', 'incorporation', 'business', 'license', 'licence', 'permit',
  'certificate', 'ein', 'crn', 'tin', 'nif', 'cnpj', 'of', 'and', 'the', 'its',
  'their', 'our',
])

function splitWords(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/[\s\-/&,.]+/)
    .filter((w) => w.length > 0)
}

function stripLeadingDeterminers(words: string[]): string[] {
  let i = 0
  while (i < words.length && DETERMINERS.has(words[i])) i++
  return words.slice(i)
}

export function filterGenericNerMatches(matches: RawMatch[]): RawMatch[] {
  const out: RawMatch[] = []
  for (const m0 of matches) {
    let m = m0
    if (
      m.type !== 'PERSON' &&
      m.type !== 'COMPANY' &&
      m.type !== 'ADDRESS' &&
      m.type !== 'REG_NUMBER'
    ) {
      out.push(m)
      continue
    }

    // Индекс, ошибочно помеченный REG_NUMBER (формат "SW1A 1AA"). Проверяем ДО
    // раннего пропуска «в спане есть цифра» — в индексе цифры есть.
    if (m.type === 'REG_NUMBER' && UK_POSTCODE.test(m.value.trim())) continue

    // Обрезаем ведущий титул/должность у PERSON ("Director John Smith" →
    // "John Smith"): смещаем start на длину совпадения, чтобы позиции остались
    // валидными и спан слился с уже найденным именем.
    if (m.type === 'PERSON') {
      const t = LEADING_TITLE.exec(m.value)
      if (t && t[0].length < m.value.length) {
        const cut = t[0].length
        m = { ...m, value: m.value.slice(cut), start: m.start + cut }
      }
    }

    const words = stripLeadingDeterminers(splitWords(m.value))
    if (words.length === 0) continue

    if (/\d/.test(m.value)) {
      out.push(m)
      continue
    }

    if (m.type === 'PERSON' || m.type === 'COMPANY') {
      // PERSON со суффиксом юрлица — это компания, ошибочно помеченная человеком.
      if (m.type === 'PERSON' && words.some((w) => COMPANY_SUFFIXES.has(w))) continue
      const allGeneric = words.every((w) => GENERIC_WORDS.has(w))
      const hasRoleNoun = words.some((w) => ROLE_NOUNS.has(w))
      if (allGeneric && hasRoleNoun) continue
      out.push(m)
      continue
    }

    if (m.type === 'REG_NUMBER') {
      const allGenericRegnum = words.every((w) => GENERIC_REGNUM_WORDS.has(w))
      if (allGenericRegnum) continue
      out.push(m)
      continue
    }

    // ADDRESS
    const allGenericAddress = words.every((w) => GENERIC_ADDRESS_WORDS.has(w))
    if (allGenericAddress) continue
    out.push(m)
  }
  return out
}
