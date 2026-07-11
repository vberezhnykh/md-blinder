export type EntityType =
  | 'PERSON' | 'COMPANY' | 'ADDRESS' | 'REG_NUMBER'
  | 'IBAN' | 'SWIFT' | 'ACCOUNT' | 'CARD' | 'EMAIL' | 'PHONE' | 'OTHER'

export const ALL_ENTITY_TYPES: EntityType[] = [
  'PERSON', 'COMPANY', 'ADDRESS', 'REG_NUMBER',
  'IBAN', 'SWIFT', 'ACCOUNT', 'CARD', 'EMAIL', 'PHONE', 'OTHER',
]

export interface RawMatch {
  type: EntityType
  value: string   // exact matched substring
  start: number   // char offset in source markdown
  end: number     // exclusive
}

export interface Entity {
  id: string
  type: EntityType
  value: string          // canonical original value (first occurrence)
  placeholder: string    // e.g. [COMPANY_1]
  occurrences: number
  positions: { start: number; end: number }[]
  anonymize: boolean     // default true (Stage 5 will toggle)
  manual: boolean        // default false
}

export interface AnonymizationResult {
  markdown: string        // text with placeholders substituted
  entities: Entity[]
}
