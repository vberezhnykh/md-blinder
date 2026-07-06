import { entityCurrentValue } from '../lib/anonymize/apply'
import { ALL_ENTITY_TYPES, type Entity, type EntityType } from '../lib/anonymize/types'

interface EntityListProps {
  entities: Entity[]
  sourceText: string
  onToggle: (id: string) => void
  onChangeType: (id: string, type: EntityType) => void
  onDelete: (id: string) => void
  onSelect?: (entity: Entity) => void
}

function minStart(e: Entity): number {
  return e.positions.length ? Math.min(...e.positions.map((p) => p.start)) : Infinity
}

function EntityList({ entities, sourceText, onToggle, onChangeType, onDelete, onSelect }: EntityListProps) {
  if (!entities.length) {
    return (
      <div className="entity-pane">
        <h3>Сущности</h3>
        <p className="text-muted">Сущности не найдены.</p>
      </div>
    )
  }

  const sorted = [...entities].sort((a, b) => minStart(a) - minStart(b))

  return (
    <div className="entity-pane">
      <h3>Сущности ({entities.length})</h3>
      {sorted.map((entity) => {
        const value = entityCurrentValue(sourceText, entity)
        return (
          <div className="entity-row" key={entity.id}>
            <input
              type="checkbox"
              checked={entity.anonymize}
              onChange={() => onToggle(entity.id)}
              title="Анонимизировать"
            />
            <span
              className="cell-placeholder"
              title="Показать в тексте"
              role="button"
              tabIndex={0}
              onClick={() => onSelect?.(entity)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect?.(entity)
                }
              }}
            >
              {entity.placeholder}
            </span>
            <select
              value={entity.type}
              onChange={(e) => onChangeType(entity.id, e.target.value as EntityType)}
            >
              {ALL_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="cell-value" title={value}>
              {value}
            </span>
            <span className="cell-count">{entity.positions.length}</span>
            <button
              type="button"
              className="entity-delete"
              onClick={() => onDelete(entity.id)}
              title="Удалить"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default EntityList
