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
  'contributor', 'contributors', 'participant', 'participants', 'collaborator',
  'collaborators', 'consignor', 'consignee', 'bailor', 'bailee',
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
  // причастия/прилагательные из юридических определений ("permitted
  // subcontractors", "Impacted Party", "natural person") — без них родовая
  // фраза не набирала allGeneric и ложняк проходил насквозь.
  'undersigned', 'signing',
  'permitted', 'impacted', 'natural', 'juridical', 'physical', 'authorized',
  'authorised', 'designated', 'approved', 'named', 'nominated', 'appointed',
  'potential', 'prospective', 'former', 'current', 'future', 'participating',
  'contracting', 'remaining', 'surviving', 'successor', 'underlying',
  'intended', 'eligible', 'qualified',
])

const CONNECTORS = new Set(['and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with'])

// Британский почтовый индекс (формат вида SW1A 1AA, EC1A 1BB). GLiNER иногда тегает
// индекс-хвост адреса как REG_NUMBER — это ложняк, отбрасываем.
const UK_POSTCODE = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/

// Дата целиком (dd.mm.yyyy / dd.mm.yy / yyyy-mm-dd / yyyy.mm.dd, разделители
// . / -, единообразные внутри одной даты — обратная ссылка на группу
// разделителя). В системе нет типа DATE (см. EntityType), значит дата не
// может быть валидной сущностью ни для одного из проверяемых типов —
// GLiNER иногда тегает её как REG_NUMBER или PERSON.
//
// День и месяц должны быть правдоподобны (день 1-31, месяц 1-12), иначе
// регномер вида "12.34.5678" (второй блок 34 — не день) ошибочно матчился
// как дата и терял recall. В day-first ветке порядок первых двух чисел не
// фиксирован (принимаем и европейский d.m, и американский m/d) — важно
// лишь, чтобы оба были в диапазоне 1-31 и хотя бы одно из них — в 1-12.
const GENERIC_DATE =
  /^\s*(?:(?:(?:0?[1-9]|1[0-2])([./-])(?:0?[1-9]|[12]\d|3[01])\1\d{2,4}|(?:0?[1-9]|[12]\d|3[01])([./-])(?:0?[1-9]|1[0-2])\2\d{2,4})|\d{4}([./-])(?:0?[1-9]|1[0-2])\3(?:0?[1-9]|[12]\d|3[01]))\s*$/

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

// Ведущая родовая обёртка reg-номера ("registration number 193394577",
// "Company registration no. 193...", "VAT No. GB12"). NER часто включает её в
// спан — отрезаем её и оставляем сам номер, требуя разделитель после каждого
// слова (сработает только когда дальше идёт номер). Собрано из GENERIC_REGNUM_WORDS.
const LEADING_REGNUM_GENERIC = new RegExp(
  `^(?:(?:${[...GENERIC_REGNUM_WORDS].join('|')})[\\s.,:#/&-]+)+`,
  'i',
)

// Мультиязычная NER-модель так же уверенно (0.8-0.95) тегает русские
// ролевые/родовые термины договора ("Заказчик", "Исполнитель", "Сторона",
// "третьи лица", "порядковый номер", "адрес электронной почты") как
// PERSON/COMPANY/REG_NUMBER/ADDRESS — это обозначения ролей, а не PII.
// Русские слова склоняются ("Заказчик/Заказчика/Заказчиком"), поэтому
// точное сравнение недостаточно. Гибрид: длинные однозначные корни матчим
// по префиксу (word.startsWith(stem)), короткие/неоднозначные — точным
// списком форм (иначе префикс «лиц» ошибочно поймал бы «лицензия», поэтому
// «лицо» — списком форм). RU_REGNUM_STEMS/RU_ADDRESS_STEMS тоже матчатся по
// префиксу: часть записей там — намеренно урезанные корни («электронн»,
// «почтов»), нужные, чтобы поймать «электронной», «почтовый» и т.п.
//
// ВАЖНО (утечка PII, найдена код-ревью): префиксное матчение работает только
// для МНОГОСЛОВНЫХ спанов — там его подстраховывает allGeneric (реальное имя
// содержит хотя бы одно НЕ-родовое слово, значит allGeneric не станет true
// целиком по случайности). Для ОДНОСЛОВНОГО спана (words.length === 1) это
// не так: allGeneric и hasRoleNoun схлопываются в одну и ту же проверку
// одного слова, и префикс типа «работник» ловит фамилию «Работников», «эл»
// ловит город «Электросталь», «сторон» — фамилию «Сторонин», «гарант» — бренд
// «Гарант». Поэтому однословный спан дропаем ТОЛЬКО по ТОЧНОЙ форме (exact-
// хелперы ниже), без префикса; префиксные RU_*_STEMS остаются в деле только
// для многословных спанов.

const RU_ROLE_STEMS = [
  'заказчик', 'исполнител', 'арендатор', 'субарендатор', 'арендодател',
  'поставщик', 'покупател', 'продавец', 'продавц', 'подрядчик',
  'субподрядчик', 'заёмщик', 'заемщик', 'кредитор', 'должник', 'поручител',
  'залогодател', 'залогодержател', 'посредник', 'принципал', 'доверител',
  'поверенн', 'представител', 'работник', 'сотрудник', 'соисполнител',
  'обладател', 'правообладател', 'пользовател', 'потребител', 'приобретател',
  'участник', 'учредител', 'акционер', 'руководител', 'директор', 'сторон',
  'гарант', 'контрагент',
]

// Точные формы ролевых слов — используются как есть для однословных спанов
// (без префикса, см. пояснение выше). Родительный падеж множественного числа
// на -ов/-ев («заказчиков», «работников», «директоров», «поставщиков» и т.п.)
// сюда НЕ включён: эти формы совпадают с русскими фамилиями от профессий
// («Работников», «Директоров») — включать их означало бы дропать реальные
// фамилии. По той же причине не включён «гарант» (бренд «Гарант»).
const RU_ROLE_FORMS = new Set([
  'лицо', 'лица', 'лицу', 'лицом', 'лице', 'лиц', 'лицам', 'лицами', 'лицах',
  'фио', 'общество', 'общества', 'обществу', 'обществом', 'обществе',
  'агент', 'агента', 'агенту', 'агентом', 'агенте', 'агенты', 'фирма',
  'фирмы', 'фирме', 'фирму', 'фирмой',
  'заказчик', 'заказчика', 'заказчику', 'заказчиком', 'заказчике', 'заказчики',
  'заказчикам', 'заказчиками', 'заказчиках',
  'исполнитель', 'исполнителя', 'исполнителю', 'исполнителем', 'исполнителе',
  'исполнители', 'исполнителям', 'исполнителями', 'исполнителях', 'исполнителей',
  'сторона', 'стороны', 'стороне', 'сторону', 'стороной', 'стороною', 'сторон',
  'сторонам', 'сторонами', 'сторонах',
  'арендатор', 'арендатора', 'арендатору', 'арендатором', 'арендаторе',
  'арендаторы', 'арендаторам', 'арендаторами', 'арендаторах',
  'субарендатор', 'субарендатора', 'субарендатору', 'субарендатором',
  'субарендаторе', 'субарендаторы', 'субарендаторам', 'субарендаторами',
  'субарендаторах',
  'арендодатель', 'арендодателя', 'арендодателю', 'арендодателем',
  'арендодателе', 'арендодатели', 'арендодателям', 'арендодателями',
  'арендодателях', 'арендодателей',
  'подрядчик', 'подрядчика', 'подрядчику', 'подрядчиком', 'подрядчике',
  'подрядчики', 'подрядчикам', 'подрядчиками', 'подрядчиках',
  'субподрядчик', 'субподрядчика', 'субподрядчику', 'субподрядчиком',
  'субподрядчике', 'субподрядчики', 'субподрядчикам', 'субподрядчиками',
  'субподрядчиках',
  'поставщик', 'поставщика', 'поставщику', 'поставщиком', 'поставщике',
  'поставщики', 'поставщикам', 'поставщиками', 'поставщиках',
  'покупатель', 'покупателя', 'покупателю', 'покупателем', 'покупателе',
  'покупатели', 'покупателям', 'покупателями', 'покупателях', 'покупателей',
  'продавец', 'продавца', 'продавцу', 'продавцом', 'продавце', 'продавцы',
  'продавцам', 'продавцами', 'продавцах',
  'представитель', 'представителя', 'представителю', 'представителем',
  'представителе', 'представители', 'представителям', 'представителями',
  'представителях', 'представителей',
  'работник', 'работника', 'работнику', 'работником', 'работнике',
  'работники', 'работникам', 'работниками', 'работниках',
  'сотрудник', 'сотрудника', 'сотруднику', 'сотрудником', 'сотруднике',
  'сотрудники', 'сотрудникам', 'сотрудниками', 'сотрудниках',
  'контрагент', 'контрагента', 'контрагенту', 'контрагентом', 'контрагенте',
  'контрагенты', 'контрагентам', 'контрагентами', 'контрагентах',
  'руководитель', 'руководителя', 'руководителю', 'руководителем',
  'руководителе', 'руководители', 'руководителям', 'руководителями',
  'руководителях', 'руководителей',

  // Украинские формы (буквы і/ї/є/ґ не входят в русский диапазон, но здесь
  // это неважно: набор используется как обычный Set строк, а не как regex —
  // добавляем те же самые точные формы для украинских ролевых терминов.
  // Родительный падеж мн.ч. на -ів/-ов сюда намеренно НЕ включён (см. пояснение
  // выше про RU_ROLE_STEMS) — он совпадает с украинскими фамилиями.
  'замовник', 'замовника', 'замовнику', 'замовником', 'замовники',
  'замовниками', 'замовниках',
  'виконавець', 'виконавця', 'виконавцю', 'виконавцем', 'виконавці',
  'виконавцями', 'виконавцях',
  'підрядник', 'підрядника', 'підряднику', 'підрядником', 'підрядники',
  'підрядниками', 'підрядниках',
  'субпідрядник', 'субпідрядника', 'субпідряднику', 'субпідрядником',
  'субпідрядники',
  'орендар', 'орендаря', 'орендарю', 'орендарем', 'орендарі', 'орендарями',
  'орендарях',
  'орендодавець', 'орендодавця', 'орендодавцю', 'орендодавцем', 'орендодавці',
  'постачальник', 'постачальника', 'постачальнику', 'постачальником',
  'постачальники',
  'покупець', 'покупця', 'покупцю', 'покупцем', 'покупці', 'покупцями',
  'продавець', 'продавця', 'продавцю', 'продавцем', 'продавці',
  'представник', 'представника', 'представнику', 'представником',
  'представники', 'представниками',
  'сторона', 'сторони', 'стороні', 'сторону', 'стороною', 'сторін',
  'сторонам', 'сторонами', 'сторонах',
  'особа', 'особи', 'особу', 'особою', 'особі', 'осіб', 'особам', 'особами',
  'особах',
  'товариство', 'товариства', 'товариству', 'товариством', 'товаристві',
  'підприємець', 'підприємця', 'підприємцю', 'підприємцем',
])

const RU_MODIFIER_STEMS = [
  'уполномоченн', 'ответственн', 'виновн', 'аффилированн', 'должностн',
  'физическ', 'юридическ', 'генеральн', 'ограниченн', 'соответствующ',
  'указанн', 'настоящ', 'названн', 'получивш', 'передающ', 'раскрывающ',
  'нарушивш', 'направивш', 'обязанн', 'уведомляющ', 'порядков',
  'регистрационн', 'идентификационн', 'ответственност',
  // Украинские корни модификаторов (для многословных «фізична особа»,
  // «юридична особа», «уповноважений представник» и т.п.).
  'фізичн', 'юридичн', 'уповноважен', 'відповідальн', 'наступн', 'зазначен',
  'відповідн',
]

const RU_MODIFIER_FORMS = new Set([
  'третий', 'третье', 'третья', 'третьи', 'третьих', 'третьим', 'третьими',
  'третьему', 'третьего', 'данный', 'данного', 'данному', 'данным',
  'данном', 'иной', 'иного', 'иному', 'иным', 'ином', 'прочий', 'прочие',
  'прочих',
])

const RU_DETERMINERS = new Set([
  'настоящий', 'настоящего', 'настоящему', 'настоящим', 'настоящем',
  'указанный', 'соответствующий', 'такой', 'такого', 'каждый', 'любой',
  'любого', 'другой', 'другого', 'свой', 'своего', 'его', 'её', 'ее',
  'их', 'этот', 'этого', 'этом', 'тот', 'того', 'сам', 'самого',
])

const RU_CONNECTORS = new Set([
  'с', 'и', 'или', 'по', 'для', 'от', 'за', 'при', 'между', 'а', 'но',
])

// Уже точные (несокращённые) формы — прежде матчились по префиксу, хотя
// префикс им не был нужен. Оставлены Set'ом и используются через .has() и
// для много-, и для однословных спанов.
const RU_REGNUM_EXACT = new Set([
  'номер', 'номера', 'номеру', 'номером', 'номере', 'реестровый', 'реестровым',
])

// Точные формы адресных слов — безопасны и для однословных спанов.
const RU_ADDRESS_EXACT = new Set([
  'адрес', 'адреса', 'адресу', 'адресом', 'адресе', 'местонахождения',
  'местонахождение', 'местонахождении', 'нахождения', 'почта', 'почты',
  'почте', 'почту', 'почтой',
])

// Урезанные корни ("почтов" → «почтовый/почтового/…», "электронн" →
// «электронной/электронного/…") — намеренно неоднозначны на однословном
// спане (раньше сюда же входило «эл», ловившее города «Электросталь»/
// «Элиста»/«Эльбрус» — реальная утечка PII), поэтому используются ТОЛЬКО
// для многословных спанов (см. RU_ROLE_STEMS выше и пояснение над ним).
const RU_ADDRESS_STEMS = ['почтов', 'электронн']

function startsWithAny(word: string, stems: string[]): boolean {
  return stems.some((stem) => word.startsWith(stem))
}

// --- Префиксные хелперы: только для МНОГОСЛОВНЫХ спанов ---

function ruIsRoleNoun(w: string): boolean {
  return RU_ROLE_FORMS.has(w) || startsWithAny(w, RU_ROLE_STEMS)
}

function ruIsGeneric(w: string): boolean {
  return (
    ruIsRoleNoun(w) ||
    RU_MODIFIER_FORMS.has(w) ||
    RU_DETERMINERS.has(w) ||
    RU_CONNECTORS.has(w) ||
    startsWithAny(w, RU_MODIFIER_STEMS)
  )
}

function ruIsRegnumGeneric(w: string): boolean {
  return RU_REGNUM_EXACT.has(w) || ruIsGeneric(w)
}

function ruIsAddressGeneric(w: string): boolean {
  return RU_ADDRESS_EXACT.has(w) || startsWithAny(w, RU_ADDRESS_STEMS) || ruIsGeneric(w)
}

// --- Exact-хелперы: только для ОДНОСЛОВНЫХ спанов (без префикса) ---

function ruIsGenericExact(w: string): boolean {
  return (
    RU_ROLE_FORMS.has(w) ||
    RU_MODIFIER_FORMS.has(w) ||
    RU_DETERMINERS.has(w) ||
    RU_CONNECTORS.has(w) ||
    RU_ADDRESS_EXACT.has(w) ||
    RU_REGNUM_EXACT.has(w)
  )
}

function ruIsRoleNounExact(w: string): boolean {
  return RU_ROLE_FORMS.has(w)
}

function ruIsAddressGenericExact(w: string): boolean {
  return RU_ADDRESS_EXACT.has(w) || ruIsGenericExact(w)
}

function ruIsRegnumGenericExact(w: string): boolean {
  return RU_REGNUM_EXACT.has(w) || ruIsGenericExact(w)
}

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

    // Дата, ошибочно помеченная любым из проверяемых типов ("05.06.2026" как
    // REG_NUMBER, "5/6/26" как PERSON). Тоже проверяем ДО шортката на цифры —
    // в дате они есть. В отличие от UK_POSTCODE, не привязано к типу REG_NUMBER.
    if (GENERIC_DATE.test(m.value)) continue

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

    // Обрезаем ведущую родовую обёртку у REG_NUMBER ("registration number
    // 193394577" → "193394577"): так же смещаем start, оставляя в спане только
    // сам номер. ДО шортката на цифры — иначе обёртка ушла бы в значение целиком.
    if (m.type === 'REG_NUMBER') {
      const t = LEADING_REGNUM_GENERIC.exec(m.value)
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

    // Однословный спан дропаем только по ТОЧНОЙ форме (без префикса): для
    // многословного allGeneric+hasRoleNoun защищено тем, что реальное имя
    // содержит хотя бы одно не-родовое слово, а на одном слове эта защита
    // исчезает — префикс типа «работник»/«гарант»/«эл» тогда ловил бы
    // реальные фамилии/бренды/города (см. пояснение над RU_ROLE_STEMS).
    const single = words.length === 1

    if (m.type === 'PERSON' || m.type === 'COMPANY') {
      // PERSON со суффиксом юрлица — это компания, ошибочно помеченная человеком.
      if (m.type === 'PERSON' && words.some((w) => COMPANY_SUFFIXES.has(w))) continue
      const allGeneric = words.every((w) => GENERIC_WORDS.has(w))
      const hasRoleNoun = words.some((w) => ROLE_NOUNS.has(w))
      if (allGeneric && hasRoleNoun) continue
      // Русская ветка (параллельно английской, через OR): те же критерии
      // «все слова родовые + есть ролевое существительное», но по
      // русскому словарю с учётом склонений.
      const allGenericRu = words.every(single ? ruIsGenericExact : ruIsGeneric)
      const hasRoleNounRu = words.some(single ? ruIsRoleNounExact : ruIsRoleNoun)
      if (allGenericRu && hasRoleNounRu) continue
      out.push(m)
      continue
    }

    if (m.type === 'REG_NUMBER') {
      const allGenericRegnum = words.every((w) => GENERIC_REGNUM_WORDS.has(w))
      if (allGenericRegnum) continue
      if (single ? ruIsRegnumGenericExact(words[0]) : words.every(ruIsRegnumGeneric)) continue
      out.push(m)
      continue
    }

    // ADDRESS
    const allGenericAddress = words.every((w) => GENERIC_ADDRESS_WORDS.has(w))
    if (allGenericAddress) continue
    if (single ? ruIsAddressGenericExact(words[0]) : words.every(ruIsAddressGeneric)) continue
    out.push(m)
  }
  return out
}
