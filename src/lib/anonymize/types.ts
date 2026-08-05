// PASSPORT — данные документа, удостоверяющего личность (серия/номер паспорта
// любой страны, код подразделения). СНИЛС сюда НЕ входит: он идёт в REG_NUMBER
// вместе с ИНН физлица, ІПН и РНОКПП — это регистрационные номера в реестрах, а
// не документы. Если понадобится развести их по разным плейсхолдерам, достаточно
// завести отдельный тип здесь: список ниже — единственный источник правды, UI и
// экспорт читают его.
export type EntityType =
  | 'PERSON' | 'COMPANY' | 'ADDRESS' | 'REG_NUMBER' | 'PASSPORT'
  | 'IBAN' | 'SWIFT' | 'ACCOUNT' | 'CARD' | 'EMAIL' | 'PHONE' | 'URL' | 'OTHER'

export const ALL_ENTITY_TYPES: EntityType[] = [
  'PERSON', 'COMPANY', 'ADDRESS', 'REG_NUMBER', 'PASSPORT',
  'IBAN', 'SWIFT', 'ACCOUNT', 'CARD', 'EMAIL', 'PHONE', 'URL', 'OTHER',
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
