import { buildAnonymizedText, entityCurrentValue } from './apply'
import { csvEscape } from './csv'
import type { Entity } from './types'

export interface BatchExportDoc {
  name: string
  sourceText: string
  entities: Entity[]
}

// Документы пакета одним Markdown-файлом. Заголовки нейтральные: имя файла
// часто содержит название стороны («Договор с Гаммой.docx»), поэтому в
// обезличенный текст оно не попадает.
export function batchToMarkdown(docs: BatchExportDoc[]): string {
  return docs
    .map((doc, i) => `# Документ ${i + 1}\n\n${buildAnonymizedText(doc.sourceText, doc.entities).trim()}\n`)
    .join('\n---\n\n')
}

// Общая таблица замен пакета: одна строка на метку, все исходные формы и
// документы, где метка встречается. Содержит исходные данные.
export function batchEntitiesToCsv(docs: BatchExportDoc[]): string {
  interface Row { placeholder: string; type: string; values: string[]; docs: string[]; count: number }
  const rows = new Map<string, Row>()
  docs.forEach((doc, i) => {
    const label = `Документ ${i + 1} (${doc.name})`
    for (const e of doc.entities) {
      if (!e.anonymize) continue
      let row = rows.get(e.placeholder)
      if (!row) {
        row = { placeholder: e.placeholder, type: e.type, values: [], docs: [], count: 0 }
        rows.set(e.placeholder, row)
      }
      const forms = new Set([entityCurrentValue(doc.sourceText, e), ...e.positions.map((p) => doc.sourceText.slice(p.start, p.end))])
      for (const form of forms) if (!row.values.includes(form)) row.values.push(form)
      if (!row.docs.includes(label)) row.docs.push(label)
      row.count += e.positions.length
    }
  })
  const num = (p: string) => Number(p.match(/_(\d+)\]$/)?.[1] ?? 0)
  const sorted = [...rows.values()].sort((a, b) => a.type.localeCompare(b.type) || num(a.placeholder) - num(b.placeholder))
  const header = ['Плейсхолдер', 'Тип', 'Оригинальные значения', 'Документы', 'Вхождений']
  const body = [header, ...sorted.map((r) => [r.placeholder, r.type, r.values.join('; '), r.docs.join('; '), String(r.count)])]
    .map((row) => row.map(csvEscape).join(','))
    .join('\r\n')
  return 'sep=,\r\n' + body
}
