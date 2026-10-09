import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { candidateReason, entityCurrentValue, pendingCandidates } from '../lib/anonymize/apply'
import { ALL_ENTITY_TYPES, type Entity, type EntityType } from '../lib/anonymize/types'
import { candidateContext } from '../lib/candidateContext'
import { CheckIcon, ChevronDownIcon, DownloadIcon } from './icons'

interface CandidateReviewProps {
  entities: Entity[]
  sourceText: string
  // Кандидат, выбранный пользователем; без выбора текущим считается первый.
  activeId: string | null
  onActivate: (id: string | null) => void
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onAcceptAllRelated: (targetId: string) => void
  onRestore: (id: string) => void
  onChangeType: (id: string, type: EntityType) => void
  onExport: () => void
}

function minStart(e: Entity): number {
  return e.positions.length ? Math.min(...e.positions.map((p) => p.start)) : Infinity
}

// Очередь проверки: карточка текущего кандидата с фрагментом текста, причиной и
// решением, ниже список всех кандидатов и отклоненные. Клавиши работают, когда
// фокус в карточке: Enter принимает, Backspace отклоняет, стрелки листают.
// Обработчик стоит на карточке, а не на окне, чтобы не перехватывать Enter и
// Backspace в редакторе.
function CandidateReview({
  entities, sourceText, activeId, onActivate, onAccept, onReject, onAcceptAllRelated, onRestore, onChangeType, onExport,
}: CandidateReviewProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const keepFocusRef = useRef(false)

  const { pending, dismissed } = useMemo(() => {
    const byStart = (a: Entity, b: Entity) => minStart(a) - minStart(b)
    return {
      pending: pendingCandidates(entities),
      dismissed: entities.filter((e) => e.dismissed).sort(byStart),
    }
  }, [entities])

  const current = pending.find((e) => e.id === activeId) ?? pending[0] ?? null
  const index = current ? pending.indexOf(current) : -1

  // После решения или перехода фокус остается на карточке, чтобы следующего
  // кандидата можно было разобрать с клавиатуры.
  useEffect(() => {
    if (!keepFocusRef.current) return
    keepFocusRef.current = false
    cardRef.current?.focus({ preventScroll: true })
  }, [current?.id])

  if (!current) {
    return (
      <div className="review">
        <div className="review-done">
          <p className="review-done-title"><CheckIcon size={16} />Все кандидаты разобраны</p>
          <p>В результате не осталось непроверенных фрагментов.</p>
          <button type="button" className="primary" onClick={onExport}><DownloadIcon />Экспортировать .md</button>
        </div>
        <DismissedList dismissed={dismissed} sourceText={sourceText} onRestore={onRestore} />
      </div>
    )
  }

  // Следующий кандидат после решения: идущий за текущим, иначе первый из оставшихся.
  const nextAfter = (ids: Set<string>): string | null => {
    const rest = pending.filter((e) => !ids.has(e.id))
    return (rest.find((e) => pending.indexOf(e) > index) ?? rest[0])?.id ?? null
  }
  const decide = (action: (id: string) => void) => {
    keepFocusRef.current = true
    const next = nextAfter(new Set([current.id]))
    action(current.id)
    onActivate(next)
  }
  const step = (delta: number) => {
    keepFocusRef.current = true
    onActivate(pending[(index + delta + pending.length) % pending.length].id)
  }

  const siblings = current.relatedTo
    ? pending.filter((e) => e.relatedTo === current.relatedTo)
    : []
  const target = current.relatedTo ? entities.find((e) => e.id === current.relatedTo) : undefined
  const canAcceptAll = siblings.length > 1 && !!target && !target.candidate && !target.dismissed

  const value = entityCurrentValue(sourceText, current)
  const position = current.positions[0]
  const context = position ? candidateContext(sourceText, position.start, position.end) : null
  const reason = candidateReason(entities, current)

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tag = (event.target as HTMLElement).tagName
    if (tag === 'SELECT' || tag === 'INPUT') return
    // Enter на кнопке нажимает ее; на самой карточке принимает кандидата.
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault()
      decide(onAccept)
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      decide(onReject)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      step(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  return (
    <div className="review">
      <div
        ref={cardRef}
        className="candidate-card"
        role="group"
        aria-label={`Кандидат ${index + 1} из ${pending.length}: ${value}`}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="candidate-card-head">
          <span className="candidate-card-count">Кандидат {index + 1} из {pending.length}</span>
          {pending.length > 1 && (
            <span className="candidate-card-nav">
              <button type="button" className="icon-button" aria-label="Предыдущий кандидат" onClick={() => step(-1)}>
                <span className="icon-flip"><ChevronDownIcon size={16} /></span>
              </button>
              <button type="button" className="icon-button" aria-label="Следующий кандидат" onClick={() => step(1)}>
                <ChevronDownIcon size={16} />
              </button>
            </span>
          )}
        </div>
        <p className="candidate-card-value">{value}</p>
        {context && (
          <p className="candidate-card-context">
            {context.cutBefore && '…'}{context.before}<mark>{context.match}</mark>{context.after}{context.cutAfter && '…'}
          </p>
        )}
        {reason && <p className="candidate-reason">{reason}</p>}
        <label className="candidate-card-type">
          Тип
          <select value={current.type} onChange={(event) => onChangeType(current.id, event.target.value as EntityType)}>
            {ALL_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <div className="candidate-card-actions">
          <button type="button" className="primary" onClick={() => decide(onAccept)}>
            Принять <kbd>Enter</kbd>
          </button>
          <button type="button" onClick={() => decide(onReject)}>
            Отклонить <kbd>⌫</kbd>
          </button>
        </div>
        {canAcceptAll && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              keepFocusRef.current = true
              const next = nextAfter(new Set(siblings.map((e) => e.id)))
              onAcceptAllRelated(target!.id)
              onActivate(next)
            }}
          >
            Принять все похожие на {target!.placeholder} ({siblings.length})
          </button>
        )}
      </div>

      <section className="review-list" aria-label="Все кандидаты">
        <h4>Все кандидаты</h4>
        <ul>
          {pending.map((e, i) => (
            <li key={e.id} className={`candidate-item${e.id === current.id ? ' is-current' : ''}`}>
              <span className="candidate-item-num" aria-hidden="true">{i + 1}</span>
              <span className="candidate-item-main">
                <span className="candidate-item-value">{entityCurrentValue(sourceText, e)}</span>
                <span className="candidate-item-reason">{e.id === current.id ? 'Проверяется сейчас' : candidateReason(entities, e)}</span>
              </span>
              {e.id !== current.id && (
                <button type="button" className="small-button" onClick={() => onActivate(e.id)}>Открыть</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <DismissedList dismissed={dismissed} sourceText={sourceText} onRestore={onRestore} />

      <p className="review-hint">
        Пока кандидат не принят, он остается в тексте как есть. В карточке: Enter принимает, Backspace отклоняет,
        стрелки ↑ ↓ переходят к соседнему кандидату.
      </p>
    </div>
  )
}

function DismissedList({ dismissed, sourceText, onRestore }: {
  dismissed: Entity[]
  sourceText: string
  onRestore: (id: string) => void
}) {
  if (dismissed.length === 0) return null
  return (
    <details className="review-dismissed">
      <summary>Отклоненные ({dismissed.length})</summary>
      <ul>
        {dismissed.map((e) => (
          <li key={e.id} className="candidate-item">
            <span className="candidate-item-main">
              <span className="candidate-item-value">{entityCurrentValue(sourceText, e)}</span>
              <span className="candidate-item-reason">Остается в тексте как есть</span>
            </span>
            <button type="button" className="small-button" onClick={() => onRestore(e.id)}>Вернуть</button>
          </li>
        ))}
      </ul>
    </details>
  )
}

export default CandidateReview
