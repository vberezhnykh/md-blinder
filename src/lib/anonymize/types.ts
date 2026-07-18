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
  score?: number   // NER confidence (undefined for structural regex matches)
}

export interface Entity {
  id: string
  type: EntityType
  value: string          // canonical original value (first occurrence)
  placeholder: string    // e.g. [COMPANY_1]
  positions: { start: number; end: number }[]
  anonymize: boolean     // default true (Stage 5 will toggle)
  manual: boolean        // default false
  score?: number          // уверенность NER репрезентативного матча (undefined для структурных/ручных)
  candidate?: boolean     // true = непроверенный кандидат «серой зоны»; не идёт в вывод, пока не принят
  candidateNote?: string  // причина попадания в кандидаты, показывается в UI
  dismissed?: boolean     // true = кандидат отклонён вручную; скрыт из UI и пропускается контрольным проходом
}

export interface AnonymizationResult {
  markdown: string        // text with placeholders substituted
  entities: Entity[]
}
