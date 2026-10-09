import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { candidateReason, entityCurrentValue } from '../lib/anonymize/apply'
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
  onSetAnonymize?: (ids: string[], anonymize: boolean) => void
  highlightedId?: string | null
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
  onSetAnonymize,
  highlightedId = null,
}: EntityListProps) {
  const paneRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<EntityType>>(new Set())
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
    for (const group of byType.values()) group.sort((a, b) => minStart(a) - minStart(b))
    return { confirmed, candidates, byType }
  }, [entities])
  // Группы идут в постоянном порядке типов, внутри группы — по месту в тексте.
  const groups = ALL_ENTITY_TYPES.filter((t) => byType.has(t)).map((t) => ({ type: t, items: byType.get(t)! }))

  // Панель прилипает к верху окна и прокручивается сама. Пока страница не
  // прокручена, ее верх ниже панели действий, и с фиксированной высотой низ
  // списка уходил за край окна. Подгоняем высоту так, чтобы панель
  // заканчивалась у нижнего края окна и любая строка была досягаема.
  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const fit = () => {
      if (getComputedStyle(pane).position !== 'sticky') {
        pane.style.maxHeight = ''
        return
      }
      const top = Math.max(pane.getBoundingClientRect().top, 12)
      pane.style.maxHeight = `${Math.max(240, window.innerHeight - top - 12)}px`
    }
    fit()
    window.addEventListener('scroll', fit, { passive: true })
    window.addEventListener('resize', fit)
    return () => {
      window.removeEventListener('scroll', fit)
      window.removeEventListener('resize', fit)
    }
  }, [])

  // Прокручиваем только панель и только если строка не видна: scrollIntoView
  // сдвинул бы всю страницу вместе с редактором под курсором. Видимой считается
  // часть панели внутри окна — пока страница не прокручена, низ панели за экраном.
  useEffect(() => {
    const pane = paneRef.current
    if (!pane || !highlightedId) return
    // Строка свернутой группы не отрисована — тогда показываем заголовок группы.
    const type = entities.find((e) => e.id === highlightedId)?.type
    const row = pane.querySelector<HTMLElement>(`[data-entity-id="${CSS.escape(highlightedId)}"]`)
      ?? (type ? pane.querySelector<HTMLElement>(`[data-group-type="${type}"]`) : null)
    if (!row) return
    const paneBox = pane.getBoundingClientRect()
    let top = Math.max(paneBox.top, 0)
    const bottom = Math.min(paneBox.bottom, window.innerHeight)
    const rowBox = row.getBoundingClientRect()
    // Сверху строку может закрывать прилипший заголовок ее группы.
    const header = row.closest('.entity-group')?.querySelector<HTMLElement>('.entity-group-header')
    if (header && header !== row) top += header.offsetHeight
    if (rowBox.top < top) pane.scrollTop -= top - rowBox.top + 8
    else if (rowBox.bottom > bottom) pane.scrollTop += rowBox.bottom - bottom + 8
  // entities намеренно не в зависимостях: прокрутка нужна при смене наведения,
  // а не при каждой правке разметки.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedId])

  if (!confirmed.length && !candidates.length) {
    return (
      <div className="entity-pane" ref={paneRef}>
        <h3>Найденные данные</h3>
        <p className="text-muted">Ничего не найдено. Выделите текст в редакторе, чтобы добавить замену вручную.</p>
      </div>
    )
  }

  return (
    <div className="entity-pane" ref={paneRef}>
      {/* Кандидаты идут первыми: они не заменяются, пока их не принять, и при
          длинном списке внизу их легко не заметить. */}
      {candidates.length > 0 && (
        <section className="candidates-section" id="candidates">
          <h3>Проверьте вручную ({candidates.length})</h3>
          <p className="candidates-hint">Эти фрагменты пока не заменяются. Примите или отклоните каждый.</p>
          {candidates.map((entity) => {
            const value = entityCurrentValue(sourceText, entity)
            const reason = candidateReason(entities, entity)
            return (
              <div
                className={`entity-row candidate-row${entity.id === highlightedId ? ' is-highlighted' : ''}`}
                key={entity.id}
                data-entity-id={entity.id}
              >
                <TypeDot type={entity.type} />
                <div className="entity-main">
                  <EntityValue entity={entity} value={value} onSelect={onSelect} />
                  {reason && <span className="candidate-note">{reason}</span>}
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
      {groups.map(({ type, items }) => {
        const active = items.filter((e) => e.anonymize).length
        const isCollapsed = collapsed.has(type)
        const groupHighlighted = isCollapsed && items.some((e) => e.id === highlightedId)
        return (
          <section
            className="entity-group"
            key={type}
            style={{ '--group-color': `var(--ent-${type})` } as CSSProperties}
          >
            <div
              className={`entity-group-header${groupHighlighted ? ' is-highlighted' : ''}`}
              data-group-type={type}
            >
              <input
                type="checkbox"
                checked={active === items.length}
                ref={(el) => { if (el) el.indeterminate = active > 0 && active < items.length }}
                onChange={() => onSetAnonymize?.(items.map((e) => e.id), active < items.length)}
                title="Заменять все значения этого типа"
                aria-label={`Заменять все ${type}`}
              />
              <button
                type="button"
                className="entity-group-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(type)) next.delete(type)
                  else next.add(type)
                  return next
                })}
              >
                <span className="entity-group-chevron" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                <span className="entity-group-name">{type}</span>
                <span className="entity-group-count">
                  {active === items.length ? items.length : `${active} из ${items.length}`}
                </span>
              </button>
            </div>
            {!isCollapsed && <div className="entity-group-items">{items.map((entity) => {
              const value = entityCurrentValue(sourceText, entity)
              const sameType = byType.get(entity.type)!
              const canMerge = sameType.length >= 2 && !!onMergeEntity
              const isMerging = mergeSource === entity.id
              return (
                <div
                  className={`entity-row${entity.id === highlightedId ? ' is-highlighted' : ''}`}
                  key={entity.id}
                  data-entity-id={entity.id}
                >
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
            })}</div>}
          </section>
        )
      })}
    </div>
  )
}

export default EntityList
