import type { Entity } from '../lib/anonymize/types'
import { ENTITY_TYPE_LABELS } from '../lib/anonymize/types'
import { entityCurrentValue } from '../lib/anonymize/apply'

function ReplacementTable({ entities, sourceText }: { entities: Entity[]; sourceText: string }) {
  const active = entities.filter((e) => e.anonymize)
  if (active.length === 0) return null

  return (
    <div className="replacement-table-wrap">
      <table className="replacement-table">
        <thead>
          <tr>
            <th>Замена</th>
            <th>Тип</th>
            <th>Исходный текст</th>
            <th>Вхождений</th>
          </tr>
        </thead>
        <tbody>
          {active.map((entity) => (
            <tr key={entity.id}>
              <td className="cell-placeholder">{entity.placeholder}</td>
              <td>
                <span className="type-dot" style={{ background: `var(--ent-${entity.type})` }} aria-hidden="true" />
                {ENTITY_TYPE_LABELS[entity.type]}
              </td>
              <td className="cell-value" title={entityCurrentValue(sourceText, entity)}>
                {entityCurrentValue(sourceText, entity)}
              </td>
              <td>{entity.positions.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ReplacementTable
