import type { Entity } from './types'

export interface ExportGate {
  replaced: number       // сколько активных сущностей будет заменено в .md
  unreviewed: number     // сколько кандидатов «серой зоны» не просмотрено (B1–B3)
  needsConfirm: boolean  // требуется ли мягкое подтверждение экспорта
}

// B5: сводка полноты перед экспортом .md. Экспорт требует подтверждения, если
// остались непросмотренные кандидаты — кандидаты не анонимизируются автоматически,
// поэтому их наличие означает потенциальный пропуск ПД в выгружаемом файле.
export function computeExportGate(entities: Entity[]): ExportGate {
  const replaced = entities.filter((e) => e.anonymize && !e.candidate).length
  const unreviewed = entities.filter((e) => e.candidate).length
  return { replaced, unreviewed, needsConfirm: unreviewed > 0 }
}
