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

// Подписи типов для интерфейса. Коды остаются только внутри меток замены
// ([PERSON_1]) и в CSV, где они служат идентификаторами.
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  PERSON: 'Человек',
  COMPANY: 'Компания',
  ADDRESS: 'Адрес',
  REG_NUMBER: 'Рег. номер',
  ID_DOC: 'Документ',
  IBAN: 'IBAN',
  SWIFT: 'SWIFT/BIC',
  ACCOUNT: 'Счет',
  CARD: 'Карта',
  EMAIL: 'Email',
  PHONE: 'Телефон',
  URL: 'Сайт',
  OTHER: 'Другое',
}

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
  dismissed?: boolean     // true = кандидат отклонён вручную; скрыт из UI
}

export interface AnonymizationResult {
  markdown: string        // text with placeholders substituted
  entities: Entity[]
}
