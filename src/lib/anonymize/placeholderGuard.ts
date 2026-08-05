import { ALL_ENTITY_TYPES } from './types'

// Защита от коллизии плейсхолдеров (ТЗ этап 5, B4): если ИСХОДНЫЙ документ уже
// содержит строки вида [PERSON_1], они неотличимы от наших плейсхолдеров в
// экспортируемом .md и сломали бы будущую деанонимизацию. Обнаруживаем их и
// обратимо экранируем нулевой шириной пробелом после «[».
//
// Список типов берём из ALL_ENTITY_TYPES, а не дублируем строкой: раньше это был
// literal, и новый тип сущности молча выпадал из защиты — плейсхолдер нового типа
// в исходнике не экранировался.
const TYPES = ALL_ENTITY_TYPES.join('|')
const ZW = '​'

function placeholderRegex(): RegExp {
  return new RegExp(`\\[(?:${TYPES})_\\d+\\]`, 'g')
}

export function findPlaceholderRanges(text: string): { start: number; end: number }[] {
  const re = placeholderRegex()
  const out: { start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length })
  return out
}

export function hasPlaceholderCollision(text: string): boolean {
  return placeholderRegex().test(text)
}

// Вставляет ZWSP после «[», разрывая совпадение с плейсхолдер-паттерном. Обратимо.
export function escapePlaceholderLiteral(literal: string): string {
  return '[' + ZW + literal.slice(1)
}

// Убирает ZWSP сразу после «[» — обратная операция.
export function unescapePlaceholders(text: string): string {
  return text.split('[' + ZW).join('[')
}
