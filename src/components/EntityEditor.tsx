import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { basicSetup, EditorView } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Decoration, type DecorationSet, WidgetType } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { ALL_ENTITY_TYPES, type Entity, type EntityType } from '../lib/anonymize/types'
import { snapToWordBoundary } from '../lib/wordSnap'
import {
  entityMetadataField,
  entityMetadataHistory,
  entitySyncTransaction,
  externalEntitySync,
  setEntityMetadata,
} from '../lib/entityEditorState'

interface EntityEditorProps {
  value: string
  entities: Entity[]
  onChange: (nextText: string, nextEntities: Entity[]) => void
  onAddEntity: (from: number, to: number) => void
  onAttachToEntity: (from: number, to: number, entityId: string) => void
  selectedType: EntityType
  onSelectedTypeChange: (t: EntityType) => void
  reveal?: { from: number; to: number; nonce: number } | null
  onMergeEntity?: (sourceId: string, targetId: string) => void
  onHoverEntity?: (entityId: string | null) => void
}

interface SelectionPopupState {
  from: number
  to: number
  left: number
  top: number
}

interface ActiveSpan {
  entityId: string
  start: number
  end: number
}

interface MergePopupState {
  entityId: string
  anchorPos: number
  left: number
  top: number
}

const setActiveSpanEffect = StateEffect.define<ActiveSpan | null>()

const activeSpanField = StateField.define<ActiveSpan | null>({
  create: () => null,
  update(active, transaction) {
    if (transaction.docChanged) active = null
    for (const effect of transaction.effects) {
      if (effect.is(setActiveSpanEffect)) active = effect.value
    }
    return active
  },
})

class EntityHandleWidget extends WidgetType {
  side: 'left' | 'right'
  pos: number
  constructor(side: 'left' | 'right', pos: number) {
    super()
    this.side = side
    this.pos = pos
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `cm-entity-handle cm-entity-handle-${this.side}`
    span.setAttribute('data-side', this.side)
    return span
  }
  eq(other: EntityHandleWidget): boolean {
    return other.side === this.side && other.pos === this.pos
  }
  ignoreEvent(): boolean {
    return false
  }
}

function buildDecorations(entities: Entity[], active: ActiveSpan | null): DecorationSet {
  const ranges = []
  let activePos: { start: number; end: number } | null = null
  if (active) {
    const e = entities.find((it) => it.id === active.entityId)
    const p = e?.positions.find((p) => p.start === active.start && p.end === active.end)
    if (p && p.end > p.start) activePos = p
  }

  for (const e of entities) {
    e.positions.forEach((p) => {
      if (p.end <= p.start) return
      const isActive =
        activePos !== null && e.id === active?.entityId && p.start === active?.start && p.end === active?.end
      const cls = e.candidate
        ? 'cm-entity cm-entity-candidate'
        : `cm-entity cm-entity-${e.type}${e.anonymize ? '' : ' cm-entity-inactive'}`
      ranges.push(Decoration.mark({ class: isActive ? `${cls} cm-entity-active` : cls }).range(p.start, p.end))
    })
  }

  if (activePos) {
    ranges.push(
      Decoration.widget({ widget: new EntityHandleWidget('left', activePos.start), side: -1 }).range(
        activePos.start,
      ),
    )
    ranges.push(
      Decoration.widget({ widget: new EntityHandleWidget('right', activePos.end), side: 1 }).range(
        activePos.end,
      ),
    )
  }

  // Ranges are a mix of marks and zero-length widgets at the same offsets as
  // mark boundaries; let CodeMirror sort them (it orders by `from`, then by
  // each decoration's startSide — our left handle has side -1 so it sorts
  // before a mark starting at the same position, matching the spec).
  return Decoration.set(ranges, true)
}

const entityDecorationField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state.field(entityMetadataField), null),
  update(deco, tr) {
    if (tr.docChanged || tr.effects.some((effect) => effect.is(setEntityMetadata) || effect.is(setActiveSpanEffect))) {
      return buildDecorations(tr.state.field(entityMetadataField), tr.state.field(activeSpanField))
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

// Цвета и шрифт берутся из токенов приложения, чтобы редактор не расходился
// с остальным интерфейсом.
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--ink)',
    fontSize: '13px',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    padding: '16px',
    caretColor: 'var(--ink)',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--sunk)',
    color: 'var(--ink-3)',
    borderRight: '1px solid var(--line)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--accent-wash)', color: 'var(--ink-2)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent-wash) 55%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
  },
  // basicSetup подсвечивает все совпадения выделенного слова. Заливка совпадала
  // с цветами типов (зеленый ADDRESS) и выглядела как разметка — убираем ее.
  '.cm-selectionMatch': { backgroundColor: 'transparent' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--sunk)', border: '1px solid var(--line-2)', color: 'var(--ink-3)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--line-2)', color: 'var(--ink)' },
})

// Подсветка Markdown на токенах приложения. Стандартный стиль подчеркивал
// заголовки как ссылки, а служебные «#» и «**» в темной теме почти сливались с фоном.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--ink-3)' },
  { tag: tags.monospace, color: 'var(--ink-2)' },
])

function EntityEditor({
  value,
  entities,
  onChange,
  onAddEntity,
  onAttachToEntity,
  selectedType,
  onSelectedTypeChange,
  reveal,
  onMergeEntity,
  onHoverEntity,
}: EntityEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const entitiesRef = useRef(entities)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onAddEntityRef = useRef(onAddEntity)
  const onAttachToEntityRef = useRef(onAttachToEntity)
  const onMergeEntityRef = useRef(onMergeEntity)
  const onHoverEntityRef = useRef(onHoverEntity)
  const hoveredEntityRef = useRef<string | null>(null)
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopupState | null>(null)
  const selectionPopupRef = useRef<SelectionPopupState | null>(null)
  const [activeSpan, setActiveSpan] = useState<ActiveSpan | null>(null)
  const activeSpanRef = useRef<ActiveSpan | null>(null)
  const [attachTarget, setAttachTarget] = useState('')
  const [mergePopup, setMergePopup] = useState<MergePopupState | null>(null)
  const mergePopupRef = useRef<MergePopupState | null>(null)
  const [mergePickerOpen, setMergePickerOpen] = useState(false)

  entitiesRef.current = entities
  valueRef.current = value
  onChangeRef.current = onChange
  onAddEntityRef.current = onAddEntity
  onAttachToEntityRef.current = onAttachToEntity
  onMergeEntityRef.current = onMergeEntity
  onHoverEntityRef.current = onHoverEntity
  selectionPopupRef.current = selectionPopup
  activeSpanRef.current = activeSpan
  mergePopupRef.current = mergePopup

  useEffect(() => {
    if (!mountRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      const nextEntities = update.state.field(entityMetadataField)
      entitiesRef.current = nextEntities
      if (update.docChanged) {
        setActiveSpan(null)
        setMergePopup(null)
        setSelectionPopup(null)
      }
      if (update.selectionSet) {
        const sel = update.state.selection.main
        if (sel.empty) {
          setSelectionPopup(null)
          const head = sel.head
          // Собираем всех кандидатов: сначала строго внутренние совпадения
          // (курсор строго между start и end), и только если таких нет — граничные
          // (курсор ровно на start или end). Внутри выбранной группы берём самый
          // узкий диапазон (при вложенных сущностях это самая "специфичная"), при
          // равной ширине — первый по порядку обхода.
          let bestInner: { entityId: string; p: { start: number; end: number } } | null = null
          let bestBoundary: { entityId: string; p: { start: number; end: number } } | null = null
          for (const e of entitiesRef.current) {
            for (const p of e.positions) {
              if (head > p.start && head < p.end) {
                if (!bestInner || p.end - p.start < bestInner.p.end - bestInner.p.start) {
                  bestInner = { entityId: e.id, p }
                }
              } else if (head === p.start || head === p.end) {
                if (!bestBoundary || p.end - p.start < bestBoundary.p.end - bestBoundary.p.start) {
                  bestBoundary = { entityId: e.id, p }
                }
              }
            }
          }
          const best = bestInner ?? bestBoundary
          const next: ActiveSpan | null = best
            ? { entityId: best.entityId, start: best.p.start, end: best.p.end }
            : null
          setActiveSpan(next)

          if (next === null) {
            setMergePopup(null)
            setMergePickerOpen(false)
          } else {
            const e = entitiesRef.current.find((x) => x.id === next.entityId)
            const p = { start: next.start, end: next.end }
            const mergeable =
              e != null &&
              !e.candidate &&
              !e.dismissed &&
              entitiesRef.current.filter((x) => !x.candidate && !x.dismissed && x.type === e.type).length >= 2
            if (mergeable && e && p) {
              const coords = update.view.coordsAtPos(p.start)
              if (coords) {
                setMergePopup({ entityId: e.id, anchorPos: p.start, left: coords.left, top: coords.top - 34 })
                setMergePickerOpen(false)
              } else {
                setMergePopup(null)
              }
            } else {
              setMergePopup(null)
              setMergePickerOpen(false)
            }
          }
        } else {
          const coords = update.view.coordsAtPos(sel.to)
          setSelectionPopup(
            coords ? { from: sel.from, to: sel.to, left: coords.left, top: coords.bottom + 6 } : null,
          )
          setAttachTarget('')
          setActiveSpan(null)
          setMergePopup(null)
          setMergePickerOpen(false)
        }
      }
      const metadataChanged = nextEntities !== update.startState.field(entityMetadataField)
      if ((update.docChanged || metadataChanged) && !update.transactions.every((tr) => tr.annotation(externalEntitySync))) {
        onChangeRef.current(update.state.doc.toString(), nextEntities)
      }
    })

    // Наведение на размеченный фрагмент подсвечивает его строку в панели справа.
    // Сообщаем только смену сущности, чтобы не перерисовывать список на каждый пиксель.
    const reportHover = (entityId: string | null) => {
      if (hoveredEntityRef.current === entityId) return
      hoveredEntityRef.current = entityId
      onHoverEntityRef.current?.(entityId)
    }
    const hoverHandlers = EditorView.domEventHandlers({
      mousemove(event, view) {
        const target = event.target as HTMLElement | null
        if (!target?.closest('.cm-entity')) {
          reportHover(null)
          return false
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) {
          reportHover(null)
          return false
        }
        // При вложенных сущностях выбираем самую узкую — ту, что видна сверху.
        let best: { id: string; width: number } | null = null
        for (const e of entitiesRef.current) {
          if (e.dismissed) continue
          for (const p of e.positions) {
            if (pos >= p.start && pos <= p.end && (!best || p.end - p.start < best.width)) {
              best = { id: e.id, width: p.end - p.start }
            }
          }
        }
        reportHover(best?.id ?? null)
        return false
      },
      mouseleave() {
        reportHover(null)
        return false
      },
    })

    const dragHandlers = EditorView.domEventHandlers({
      mousedown(event, view) {
        const target = event.target as HTMLElement | null
        const handleEl = target?.closest('.cm-entity-handle') as HTMLElement | null
        if (!handleEl) return false
        const side = handleEl.getAttribute('data-side')
        if (side !== 'left' && side !== 'right') return false
        const active = activeSpanRef.current
        if (!active) return false
        const entity = entitiesRef.current.find((e) => e.id === active.entityId)
        const startPos = entity?.positions.find((p) => p.start === active.start && p.end === active.end)
        if (!startPos) return false

        event.preventDefault()

        const fixedStart = startPos.start
        const fixedEnd = startPos.end
        // The position currently being dragged. Its start/end move as the frame is
        // applied, so subsequent frames must match against IT (not the stale
        // activeSpan) to find which entry in entities[].positions to replace.
        let currentPos = startPos
        let rafId: number | null = null
        let pendingEvent: MouseEvent | null = null

        const applyMove = () => {
          rafId = null
          const e = pendingEvent
          if (!e) return
          pendingEvent = null
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
          if (pos == null) return
          const snapped = snapToWordBoundary(view.state.doc.toString(), pos)
          const docLen = view.state.doc.length

          let nextPos: { start: number; end: number }
          if (side === 'left') {
            const newStart = Math.max(0, Math.min(snapped, fixedEnd - 1))
            nextPos = { start: newStart, end: fixedEnd }
          } else {
            const newEnd = Math.min(docLen, Math.max(snapped, fixedStart + 1))
            nextPos = { start: fixedStart, end: newEnd }
          }

          // Clamp against every OTHER occurrence (any entity, including other
          // occurrences of the same entity) so the handle can't be dragged over a
          // neighboring range and create an overlap — that's exactly the shape of
          // corruption mergeEntities has to union away.
          const candidate = nextPos
          for (const en of entitiesRef.current) {
            for (const p of en.positions) {
              if (en.id === active.entityId && p.start === currentPos.start && p.end === currentPos.end) continue
              const overlaps = p.start < candidate.end && candidate.start < p.end
              if (!overlaps) continue
              if (side === 'left') {
                nextPos = { start: Math.max(nextPos.start, p.end), end: nextPos.end }
              } else {
                nextPos = { start: nextPos.start, end: Math.min(nextPos.end, p.start) }
              }
            }
          }
          if (nextPos.start >= nextPos.end) return

          const nextEntities = entitiesRef.current.map((en) => {
            if (en.id !== active.entityId) return en
            const positions = en.positions.map((p) =>
              p.start === currentPos.start && p.end === currentPos.end ? nextPos : p,
            )
            return { ...en, positions }
          })
          currentPos = nextPos
          setActiveSpan({ entityId: active.entityId, start: nextPos.start, end: nextPos.end })
          view.dispatch({ effects: setEntityMetadata.of(nextEntities) })
        }

        const onMouseMove = (e: MouseEvent) => {
          pendingEvent = e
          if (rafId == null) rafId = requestAnimationFrame(applyMove)
        }
        const onMouseUp = () => {
          window.removeEventListener('mousemove', onMouseMove)
          window.removeEventListener('mouseup', onMouseUp)
          if (rafId != null) cancelAnimationFrame(rafId)
        }
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
        return true
      },
    })

    const view = new EditorView({
      doc: valueRef.current,
      parent: mountRef.current,
      extensions: [
        basicSetup,
        markdown(),
        syntaxHighlighting(markdownHighlight),
        EditorView.lineWrapping,
        entityMetadataField.init(() => entitiesRef.current),
        entityMetadataHistory,
        activeSpanField,
        entityDecorationField,
        hoverHandlers,
        dragHandlers,
        updateListener,
        editorTheme,
      ],
    })
    viewRef.current = view

    const handleScroll = () => {
      const current = selectionPopupRef.current
      if (current) {
        const coords = view.coordsAtPos(current.to)
        if (!coords) {
          setSelectionPopup(null)
        } else {
          setSelectionPopup({ ...current, left: coords.left, top: coords.bottom + 6 })
        }
      }

      const currentMerge = mergePopupRef.current
      if (currentMerge) {
        const c = view.coordsAtPos(currentMerge.anchorPos)
        if (!c) {
          setMergePopup(null)
        } else {
          setMergePopup({ ...currentMerge, left: c.left, top: c.top - 34 })
        }
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true })

    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setActiveSpanEffect.of(activeSpan) })
  }, [activeSpan])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const textChanged = view.state.doc.toString() !== value
    if (!textChanged && view.state.field(entityMetadataField) === entities) return
    view.dispatch(entitySyncTransaction(
      entities,
      textChanged ? { from: 0, to: view.state.doc.length, insert: value } : undefined,
    ))
  }, [value, entities])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !reveal) return
    const len = view.state.doc.length
    const anchor = Math.min(reveal.from, len)
    const head = Math.min(reveal.to, len)
    view.dispatch({
      selection: { anchor, head },
      effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
    })
    view.focus()
  }, [reveal])

  const handleAddFromPopup = () => {
    if (!selectionPopup) return
    if (attachTarget === '') {
      onAddEntityRef.current(selectionPopup.from, selectionPopup.to)
    } else {
      onAttachToEntityRef.current(selectionPopup.from, selectionPopup.to, attachTarget)
    }
    setSelectionPopup(null)
    setAttachTarget('')
  }

  const truncateValue = (v: string, max = 30): string =>
    v.length > max ? `${v.slice(0, max)}…` : v

  const activeMergeType = mergePopup ? entities.find((x) => x.id === mergePopup.entityId)?.type : undefined

  return (
    <div className="editor-pane">
      <p className="editor-hint">Выделите текст, чтобы добавить его в замены.</p>
      <div ref={mountRef} />
      {selectionPopup &&
        createPortal(
          <div
            className="cm-add-popup"
            style={{ left: selectionPopup.left, top: selectionPopup.top }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <select
              aria-label="Тип"
              value={selectedType}
              disabled={attachTarget !== ''}
              onChange={(e) => {
                onSelectedTypeChange(e.target.value as EntityType)
                setAttachTarget('')
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {ALL_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              aria-label="Куда добавить"
              className="cm-add-popup-target"
              value={attachTarget}
              onChange={(e) => setAttachTarget(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value="">новая замена</option>
              {entities
                .filter((e) => e.type === selectedType && !e.candidate)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.placeholder} · {truncateValue(e.value)}
                  </option>
                ))}
            </select>
            <button type="button" className="primary" onClick={handleAddFromPopup}>
              Добавить
            </button>
          </div>,
          document.body,
        )}
      {mergePopup &&
        createPortal(
          <div
            className="cm-merge-popup"
            style={{ left: mergePopup.left, top: mergePopup.top }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {!mergePickerOpen ? (
              <button type="button" className="cm-merge-open" onClick={() => setMergePickerOpen(true)}>
                ↦ Объединить
              </button>
            ) : (
              <select
                className="cm-merge-select"
                defaultValue=""
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const targetId = e.target.value
                  if (targetId) onMergeEntityRef.current?.(mergePopup.entityId, targetId)
                  setMergePopup(null)
                  setMergePickerOpen(false)
                  setActiveSpan(null)
                }}
              >
                <option value="">объединить с…</option>
                {entities
                  .filter((x) => x.type === activeMergeType && !x.candidate && !x.dismissed && x.id !== mergePopup.entityId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.placeholder} · {truncateValue(x.value, 22)}
                    </option>
                  ))}
              </select>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

export default EntityEditor
