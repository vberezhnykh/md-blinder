// ID_DOC — серия/номер ЛЮБОГО документа, удостоверяющего личность: паспорт
// (внутренний и заграничный), водительское удостоверение, вид на жительство,
// РВП, ID-карта, военный билет. Плюс код подразделения как часть паспортных
// данных. Тип намеренно общий: набор документов у сторон договора зависит от
// гражданства и статуса, и заводить отдельный плейсхолдер под каждый вид — это
// раскрывать в анонимизированном тексте, каким именно документом человек
// подтверждал личность.
//
// СНИЛС сюда НЕ входит: он идёт в REG_NUMBER вместе с ИНН физлица, ІПН и
// РНОКПП — это регистрационные номера в реестрах, а не документы.
//
// Список ниже — единственный источник правды: UI и экспорт читают его.
export type EntityType =
  | 'PERSON' | 'COMPANY' | 'ADDRESS' | 'REG_NUMBER' | 'ID_DOC'
  | 'IBAN' | 'SWIFT' | 'ACCOUNT' | 'CARD' | 'EMAIL' | 'PHONE' | 'URL' | 'OTHER'

export const ALL_ENTITY_TYPES: EntityType[] = [
  'PERSON', 'COMPANY', 'ADDRESS', 'REG_NUMBER', 'ID_DOC',
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
  relatedTo?: string      // id сущности, на которую похож кандидат (findRelatedOccurrences); причина «Похоже на [X]» вычисляется по нему
  dismissed?: boolean     // true = кандидат отклонён вручную; скрыт из UI
}

export interface AnonymizationResult {
  markdown: string        // text with placeholders substituted
  entities: Entity[]
}
