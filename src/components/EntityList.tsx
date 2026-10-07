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

// Цветная метка повторяет подсветку типа в редакторе — так список служит легендой.
function TypeDot({ type }: { type: EntityType }) {
  return <span className="type-dot" style={{ background: `var(--ent-${type})` }} aria-hidden="true" />
}

function TypeSelect({ entity, onChangeType }: { entity: Entity; onChangeType: EntityListProps['onChangeType'] }) {
  return (
    <select
      aria-label="Тип"
      value={entity.type}
      onChange={(e) => onChangeType(entity.id, e.target.value as EntityType)}
    >
      {ALL_ENTITY_TYPES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  )
}

function EntityValue({ entity, value, onSelect }: { entity: Entity; value: string; onSelect?: (entity: Entity) => void }) {
  return (
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
  )
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
        <h3>Найденные данные</h3>
        <p className="text-muted">Ничего не найдено. Выделите текст в редакторе, чтобы добавить замену вручную.</p>
      </div>
    )
  }

  return (
    <div className="entity-pane">
      {/* Кандидаты идут первыми: они не заменяются, пока их не принять, и при
          длинном списке внизу их легко не заметить. */}
      {candidates.length > 0 && (
        <section className="candidates-section" id="candidates">
          <h3>Проверьте вручную ({candidates.length})</h3>
          <p className="candidates-hint">Эти фрагменты пока не заменяются. Примите или отклоните каждый.</p>
          {candidates.map((entity) => {
            const value = entityCurrentValue(sourceText, entity)
            return (
              <div className="entity-row candidate-row" key={entity.id}>
                <TypeDot type={entity.type} />
                <div className="entity-main">
                  <EntityValue entity={entity} value={value} onSelect={onSelect} />
                  {entity.candidateNote && <span className="candidate-note">{entity.candidateNote}</span>}
                  <div className="entity-meta">
                    <TypeSelect entity={entity} onChangeType={onChangeType} />
                    <button
                      type="button"
                      className="entity-accept"
                      title="Принять"
                      onClick={() => onAcceptCandidate?.(entity.id)}
                    >
                      Принять
                    </button>
                    <button
                      type="button"
                      className="entity-reject"
                      title="Отклонить"
                      onClick={() => onRejectCandidate?.(entity.id)}
                    >
                      Отклонить
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </section>
      )}

      <h3>Найденные данные ({confirmed.length})</h3>
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
              title="Заменять в итоговом тексте"
              aria-label={`Заменять «${truncate(value, 40)}»`}
            />
            {isMerging ? (
              <div className="entity-merge-edit">
                <span className="cell-placeholder">{entity.placeholder}</span>
                <span className="merge-arrow">→</span>
                <select
                  className="merge-target"
                  aria-label="Объединить с"
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
                  Объединить
                </button>
                <button
                  type="button"
                  className="entity-cancel"
                  onClick={() => {
                    setMergeSource(null)
                    setMergeTarget('')
                  }}
                >
                  Отмена
                </button>
              </div>
            ) : (
              <>
                <div className="entity-main">
                  <EntityValue entity={entity} value={value} onSelect={onSelect} />
                  <div className="entity-meta">
                    <TypeDot type={entity.type} />
                    <span className="cell-placeholder" title={entity.placeholder}>
                      {entity.placeholder}
                    </span>
                    <TypeSelect entity={entity} onChangeType={onChangeType} />
                    {/* «×» рисуется через ::before — e2e читают отсюда голое число */}
                    <span className="cell-count" title="Вхождений в тексте">
                      {entity.positions.length}
                    </span>
                    {canMerge && (
                      <button
                        type="button"
                        className="entity-merge"
                        title="Объединить с другой заменой того же типа"
                        onClick={() => {
                          setMergeSource(entity.id)
                          setMergeTarget('')
                        }}
                      >
                        Объединить
                      </button>
                    )}
                  </div>
                </div>
                <div className="entity-actions">
                  <button
                    type="button"
                    className="entity-delete"
                    onClick={() => onDelete(entity.id)}
                    title="Удалить"
                    aria-label={`Удалить «${truncate(value, 40)}»`}
                  >
                    ✕
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default EntityList
