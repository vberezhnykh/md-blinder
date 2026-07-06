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
])

const GENERIC_MODIFIERS = new Set([
  'service', 'services', 'end', 'third', 'non', 'defaulting', 'disclosing',
  'receiving', 'violating', 'breaching', 'indemnifying', 'prevailing',
  'terminating', 'requesting', 'providing', 'purchasing', 'selling',
  'paying', 'performing', 'affected', 'data', 'sub', 'co', 'joint',
  'general', 'managing', 'executive', 'senior', 'junior', 'primary',
  'secondary', 'ultimate', 'immediate', 'main', 'registered', 'additional',
  'new', 'existing', 'relevant', 'respective', 'applicable', 'other',
])

const CONNECTORS = new Set(['and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with'])

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
  return matches.filter((m) => {
    if (
      m.type !== 'PERSON' &&
      m.type !== 'COMPANY' &&
      m.type !== 'ADDRESS' &&
      m.type !== 'REG_NUMBER'
    ) {
      return true
    }

    const words = stripLeadingDeterminers(splitWords(m.value))
    if (words.length === 0) return false

    if (/\d/.test(m.value)) return true

    if (m.type === 'PERSON' || m.type === 'COMPANY') {
      const allGeneric = words.every((w) => GENERIC_WORDS.has(w))
      const hasRoleNoun = words.some((w) => ROLE_NOUNS.has(w))
      if (allGeneric && hasRoleNoun) return false
      return true
    }

    if (m.type === 'REG_NUMBER') {
      const allGenericRegnum = words.every((w) => GENERIC_REGNUM_WORDS.has(w))
      if (allGenericRegnum) return false
      return true
    }

    // ADDRESS
    const allGenericAddress = words.every((w) => GENERIC_ADDRESS_WORDS.has(w))
    if (allGenericAddress) return false
    return true
  })
}
