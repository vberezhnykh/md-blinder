import type { Entity } from './types'
import { entityCurrentValue } from './apply'

export function csvEscape(field: string): string {
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
  const body = [header, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\r\n')
  // Excel (incl. Russian locale) needs an explicit separator hint to split columns correctly.
  return 'sep=,\r\n' + body
}
