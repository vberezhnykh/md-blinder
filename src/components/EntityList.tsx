import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { entityCurrentValue } from '../lib/anonymize/apply'
import { ALL_ENTITY_TYPES, type Entity, type EntityType } from '../lib/anonymize/types'
import { ChevronDownIcon } from './icons'

interface EntityListProps {
  entities: Entity[]
  sourceText: string
  onToggle: (id: string) => void
  onChangeType: (id: string, type: EntityType) => void
  onDelete: (id: string) => void
  onSelect?: (entity: Entity) => void
  onMergeEntity?: (sourceId: string, targetId: string) => void
  onSetAnonymize?: (ids: string[], anonymize: boolean) => void
  highlightedId?: string | null
  // Вкладки боковой панели: очередь проверки кандидатов и найденные данные.
  tab: SideTab
  onTabChange: (tab: SideTab) => void
  pendingCount: number
  review: ReactNode
}

export type SideTab = 'review' | 'found'

function minStart(e: Entity): number {
  return e.positions.length ? Math.min(...e.positions.map((p) => p.start)) : Infinity
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
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

function EntityList({
  entities,
  sourceText,
  onToggle,
  onChangeType,
  onDelete,
  onSelect,
  onMergeEntity,
  onSetAnonymize,
  highlightedId = null,
  tab,
  onTabChange,
  pendingCount,
  review,
}: EntityListProps) {
  const paneRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<EntityType>>(new Set())
  // Выбранная строка показывает действия: тип, объединение, удаление.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mergeSource, setMergeSource] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const { confirmed, byType } = useMemo(() => {
    const confirmed: Entity[] = []
    const byType = new Map<EntityType, Entity[]>()
    for (const entity of entities) {
      if (entity.dismissed || entity.candidate) continue
      confirmed.push(entity)
      const group = byType.get(entity.type)
      if (group) group.push(entity)
      else byType.set(entity.type, [entity])
    }
    for (const group of byType.values()) group.sort((a, b) => minStart(a) - minStart(b))
    return { confirmed, byType }
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

  return (
    <div className="entity-pane" ref={paneRef}>
      <div className="side-tabs" role="tablist" aria-label="Боковая панель">
        <button
          type="button"
          role="tab"
          id="side-tab-review"
          aria-selected={tab === 'review'}
          aria-controls="side-panel-review"
          className={`side-tab${tab === 'review' ? ' is-selected' : ''}`}
          onClick={() => onTabChange('review')}
        >
          Проверка
          <span className={`side-tab-badge${pendingCount > 0 ? ' is-pending' : ' is-done'}`}>{pendingCount > 0 ? pendingCount : '✓'}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="side-tab-found"
          aria-selected={tab === 'found'}
          aria-controls="side-panel-found"
          className={`side-tab${tab === 'found' ? ' is-selected' : ''}`}
          onClick={() => onTabChange('found')}
        >
          Найденные данные
          <span className="side-tab-badge">{confirmed.length}</span>
        </button>
      </div>

      {tab === 'review' && (
        <div className="side-panel" role="tabpanel" id="side-panel-review" aria-labelledby="side-tab-review">
          {review}
        </div>
      )}

      {tab === 'found' && (
        <div className="side-panel" role="tabpanel" id="side-panel-found" aria-labelledby="side-tab-found">
        {confirmed.length === 0 && (
          <p className="text-muted">Ничего не найдено. Выделите текст в редакторе, чтобы добавить замену вручную.</p>
        )}
        {groups.map(({ type, items }) => {
          const active = items.filter((e) => e.anonymize).length
          const isCollapsed = collapsed.has(type)
          const groupHighlighted = isCollapsed && items.some((e) => e.id === highlightedId)
          return (
            <section className="entity-group" key={type}>
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
                {/* Цвет подсветки полупрозрачный; точке нужен тот же тон без прозрачности. */}
                <span className="type-dot" style={{ background: `rgb(from var(--ent-${type}) r g b / 1)` }} aria-hidden="true" />
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
                  <span className="entity-group-name">{type}</span>
                  <span className="entity-group-count">
                    {active === items.length ? items.length : `${active} из ${items.length}`}
                  </span>
                  <span className={`entity-group-chevron${isCollapsed ? ' is-collapsed' : ''}`}><ChevronDownIcon size={16} /></span>
                </button>
              </div>
              {!isCollapsed && (
                <ul className="entity-group-items">
                  {items.map((entity) => {
                    const value = entityCurrentValue(sourceText, entity)
                    const sameType = byType.get(entity.type)!
                    const canMerge = sameType.length >= 2 && !!onMergeEntity
                    const isSelected = selectedId === entity.id
                    const isMerging = mergeSource === entity.id
                    return (
                      <li
                        className={`entity-row${entity.id === highlightedId ? ' is-highlighted' : ''}${isSelected ? ' is-selected' : ''}`}
                        key={entity.id}
                        data-entity-id={entity.id}
                      >
                        <div className="entity-row-line">
                          <input
                            type="checkbox"
                            checked={entity.anonymize}
                            onChange={() => onToggle(entity.id)}
                            title="Заменять в итоговом тексте"
                            aria-label={`Заменять «${truncate(value, 40)}»`}
                          />
                          <button
                            type="button"
                            className="entity-value-button"
                            aria-expanded={isSelected}
                            title="Показать в тексте"
                            onClick={() => {
                              setMergeSource(null)
                              setMergeTarget('')
                              if (isSelected) {
                                setSelectedId(null)
                                return
                              }
                              setSelectedId(entity.id)
                              onSelect?.(entity)
                            }}
                          >
                            <span className={`cell-value${entity.anonymize ? '' : ' is-off'}`}>{value}</span>
                            <span className="cell-placeholder">{entity.placeholder}</span>
                            {/* «×» рисуется через ::before — e2e читают отсюда голое число */}
                            <span className="cell-count" title="Вхождений в тексте">{entity.positions.length}</span>
                          </button>
                        </div>
                        {isSelected && (
                          <div className="entity-row-actions">
                            {isMerging ? (
                              <>
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
                                  disabled={!mergeTarget}
                                  onClick={() => {
                                    onMergeEntity?.(entity.id, mergeTarget)
                                    setMergeSource(null)
                                    setMergeTarget('')
                                    setSelectedId(null)
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
                              </>
                            ) : (
                              <>
                                <label className="entity-type-field">
                                  Тип
                                  <TypeSelect entity={entity} onChangeType={onChangeType} />
                                </label>
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
                                    Объединить…
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="entity-delete"
                                  onClick={() => {
                                    setSelectedId(null)
                                    onDelete(entity.id)
                                  }}
                                  aria-label={`Удалить «${truncate(value, 40)}»`}
                                >
                                  Удалить
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
        {confirmed.length > 0 && <p className="found-hint">Нажмите на значение, чтобы найти его в тексте и открыть действия.</p>}
        </div>
      )}
    </div>
  )
}

export default EntityList
