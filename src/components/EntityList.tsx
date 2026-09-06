import { useMemo, useState } from 'react'
import { entityCurrentValue } from '../lib/anonymize/apply'
import { ALL_ENTITY_TYPES, type Entity, type EntityType } from '../lib/anonymize/types'

interface EntityListProps {
  entities: Entity[]
  sourceText: string
  onToggle: (id: string) => void
  onChangeType: (id: string, type: EntityType) => void
  onDelete: (id: string) => void
  onSelect?: (entity: Entity) => void
  onAcceptCandidate?: (id: string) => void
  onRejectCandidate?: (id: string) => void
  onMergeEntity?: (sourceId: string, targetId: string) => void
}

function minStart(e: Entity): number {
  return e.positions.length ? Math.min(...e.positions.map((p) => p.start)) : Infinity
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function EntityList({
  entities,
  sourceText,
  onToggle,
  onChangeType,
  onDelete,
  onSelect,
  onAcceptCandidate,
  onRejectCandidate,
  onMergeEntity,
}: EntityListProps) {
  const [mergeSource, setMergeSource] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const { confirmed, candidates, byType } = useMemo(() => {
    const confirmed: Entity[] = []
    const candidates: Entity[] = []
    const byType = new Map<EntityType, Entity[]>()
    for (const entity of entities) {
      if (entity.dismissed) continue
      if (entity.candidate) {
        candidates.push(entity)
      } else {
        confirmed.push(entity)
        const group = byType.get(entity.type)
        if (group) group.push(entity)
        else byType.set(entity.type, [entity])
      }
    }
    confirmed.sort((a, b) => minStart(a) - minStart(b))
    candidates.sort((a, b) => minStart(a) - minStart(b))
    return { confirmed, candidates, byType }
  }, [entities])

  if (!confirmed.length && !candidates.length) {
    return (
      <div className="entity-pane">
        <h3>Сущности</h3>
        <p className="text-muted">Сущности не найдены.</p>
      </div>
    )
  }

  return (
    <div className="entity-pane">
      <h3>Сущности ({confirmed.length})</h3>
      {confirmed.map((entity) => {
        const value = entityCurrentValue(sourceText, entity)
        const sameType = byType.get(entity.type)!
        const canMerge = sameType.length >= 2 && !!onMergeEntity
        const isMerging = mergeSource === entity.id
        return (
          <div className="entity-row" key={entity.id}>
            <input
              type="checkbox"
              checked={entity.anonymize}
              onChange={() => onToggle(entity.id)}
              title="Анонимизировать"
            />
            {isMerging ? (
              <div className="entity-merge-edit">
                <span className="cell-placeholder">{entity.placeholder}</span>
                <span className="merge-arrow">→</span>
                <select
                  className="merge-target"
                  value={mergeTarget}
                  onChange={(e) => setMergeTarget(e.target.value)}
                >
                  <option value="">объединить с…</option>
                  {sameType
                    .filter((t) => t.id !== entity.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.placeholder} · {truncate(entityCurrentValue(sourceText, t), 24)}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="entity-accept"
                  title="Объединить"
                  disabled={!mergeTarget}
                  onClick={() => {
                    onMergeEntity?.(entity.id, mergeTarget)
                    setMergeSource(null)
                    setMergeTarget('')
                  }}
                >
                  ✓
                </button>
                <button
                  type="button"
                  className="entity-delete"
                  title="Отмена"
                  onClick={() => {
                    setMergeSource(null)
                    setMergeTarget('')
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                <div className="entity-main">
                  <span
                    className="cell-value"
                    title={`${value}\n(показать в тексте)`}
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
                    {value}
                  </span>
                  <div className="entity-meta">
                    <span className="cell-placeholder" title={entity.placeholder}>
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
                    {/* «×» рисуется через ::before — e2e читают отсюда голое число */}
                    <span className="cell-count" title="Вхождений в тексте">
                      {entity.positions.length}
                    </span>
                  </div>
                </div>
                <div className="entity-actions">
                  {canMerge && (
                    <button
                      type="button"
                      className="entity-merge"
                      title="Объединить с другой сущностью"
                      aria-label="Объединить"
                      onClick={() => {
                        setMergeSource(entity.id)
                        setMergeTarget('')
                      }}
                    >
                      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
                        <path d="M3 2v2.5c0 1.9 1.6 3.5 3.5 3.5H13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M3 14v-2.5C3 9.6 4.6 8 6.5 8H13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M10.5 5.5L13 8l-2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    className="entity-delete"
                    onClick={() => onDelete(entity.id)}
                    title="Удалить"
                  >
                    ✕
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}
      {candidates.length > 0 && (
        <div className="candidates-section">
          <h3>Проверьте вручную ({candidates.length})</h3>
          {candidates.map((entity) => {
              const value = entityCurrentValue(sourceText, entity)
              return (
                <div className="entity-row candidate-row" key={entity.id}>
                  <div className="entity-main">
                    <span
                      className="cell-value"
                      title={`${value}\n(показать в тексте)`}
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
                      {value}
                    </span>
                    <div className="entity-meta">
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
                    </div>
                  </div>
                  <div className="entity-actions">
                    <button
                      type="button"
                      className="entity-accept"
                      title="Принять"
                      onClick={() => onAcceptCandidate?.(entity.id)}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="entity-delete"
                      title="Отклонить"
                      onClick={() => onRejectCandidate?.(entity.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}

export default EntityList
