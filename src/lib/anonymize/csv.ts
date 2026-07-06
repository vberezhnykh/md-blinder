import type { Entity } from './types'
import { entityCurrentValue } from './apply'

function csvEscape(field: string): string {
  let f = field
  if (/^[=+\-@\t\r]/.test(f)) f = `'${f}`
  if (/["\n\r,]/.test(f)) {
    return `"${f.replace(/"/g, '""')}"`
  }
  return f
}

export function entitiesToCsv(entities: Entity[], sourceText: string): string {
  const header = ['Плейсхолдер', 'Тип', 'Оригинальное значение', 'Вхождений']
  const rows = entities.filter((e) => e.anonymize).map((e) => [
    e.placeholder,
    e.type,
    entityCurrentValue(sourceText, e),
    String(e.positions.length),
  ])
  return [header, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\r\n')
}
