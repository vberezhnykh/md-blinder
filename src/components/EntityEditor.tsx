import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { basicSetup, EditorView } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Decoration, type DecorationSet, hoverTooltip, WidgetType } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import { ALL_ENTITY_TYPES, type Entity, type EntityType } from '../lib/anonymize/types'
import { snapToWordBoundary } from '../lib/wordSnap'

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
}

interface SelectionPopupState {
  from: number
  to: number
  left: number
  top: number
}

interface ActiveSpan {
  entityId: string
  posIndex: number
}

interface MergePopupState {
  entityId: string
  anchorPos: number
  left: number
  top: number
}

interface EntitiesEffectValue {
  entities: Entity[]
  active: ActiveSpan | null
}

const setEntitiesEffect = StateEffect.define<EntitiesEffectValue>()

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
    const p = e?.positions[active.posIndex]
    if (p && p.end > p.start) activePos = p
  }

  for (const e of entities) {
    e.positions.forEach((p, i) => {
      if (p.end <= p.start) return
      const isActive = activePos !== null && e.id === active?.entityId && i === active?.posIndex
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
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const eff of tr.effects)
      if (eff.is(setEntitiesEffect)) deco = buildDecorations(eff.value.entities, eff.value.active)
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    fontSize: '13px',
  },
  '.cm-content': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    padding: '16px',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
})

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
}: EntityEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const entitiesRef = useRef(entities)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onAddEntityRef = useRef(onAddEntity)
  const onAttachToEntityRef = useRef(onAttachToEntity)
  const onMergeEntityRef = useRef(onMergeEntity)
  const [hasSelection, setHasSelection] = useState(false)
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
  selectionPopupRef.current = selectionPopup
  activeSpanRef.current = activeSpan
  mergePopupRef.current = mergePopup

  useEffect(() => {
    if (!mountRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet) {
        const sel = update.state.selection.main
        setHasSelection(!sel.empty)
        if (sel.empty) {
          setSelectionPopup(null)
          const head = sel.head
          let next: ActiveSpan | null = null
          find: for (const e of entitiesRef.current) {
            for (let i = 0; i < e.positions.length; i++) {
              const p = e.positions[i]
              if (head >= p.start && head <= p.end) {
                next = { entityId: e.id, posIndex: i }
                break find
              }
            }
          }
          setActiveSpan(next)

          if (next === null) {
            setMergePopup(null)
            setMergePickerOpen(false)
          } else {
            const e = entitiesRef.current.find((x) => x.id === next.entityId)
            const p = e?.positions[next.posIndex]
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
      if (!update.docChanged) return
      const changes = update.changes
      const nextText = update.state.doc.toString()
      const nextEntities = entitiesRef.current
        .map((e) => {
          const positions = e.positions
            .map((p) => ({ start: changes.mapPos(p.start, 1), end: changes.mapPos(p.end, -1) }))
            .filter((p) => p.end > p.start)
          return { ...e, positions }
        })
        .filter((e) => e.positions.length > 0)
      onChangeRef.current(nextText, nextEntities)
    })

    const tooltip = hoverTooltip((_view, pos) => {
      for (const e of entitiesRef.current) {
        for (const p of e.positions) {
          if (pos >= p.start && pos <= p.end) {
            const original = _view.state.doc.sliceString(p.start, p.end)
            return {
              pos: p.start,
              end: p.end,
              above: true,
              create: () => {
                const dom = document.createElement('div')
                dom.className = 'cm-entity-tooltip'
                dom.textContent = `${e.placeholder} · ${e.type}${e.candidate ? ' · кандидат' : ''} · ${original}`
                return { dom }
              },
            }
          }
        }
      }
      return null
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
        const startPos = entity?.positions[active.posIndex]
        if (!startPos) return false

        event.preventDefault()

        const fixedStart = startPos.start
        const fixedEnd = startPos.end
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

          const nextEntities = entitiesRef.current.map((en) => {
            if (en.id !== active.entityId) return en
            const positions = en.positions.map((p, i) => (i === active.posIndex ? nextPos : p))
            return { ...en, positions }
          })
          onChangeRef.current(view.state.doc.toString(), nextEntities)
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
        EditorView.lineWrapping,
        entityDecorationField,
        tooltip,
        dragHandlers,
        updateListener,
        editorTheme,
      ],
    })
    viewRef.current = view
    view.dispatch({ effects: setEntitiesEffect.of({ entities: entitiesRef.current, active: activeSpanRef.current }) })

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
    view.dispatch({ effects: setEntitiesEffect.of({ entities, active: activeSpan }) })
  }, [entities, activeSpan])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

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

  const handleAddFromSelection = () => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    if (from < to) onAddEntityRef.current(from, to)
  }

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
      <div className="editor-toolbar">
        <select
          value={selectedType}
          onChange={(e) => onSelectedTypeChange(e.target.value as EntityType)}
        >
          {ALL_ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="button" onClick={handleAddFromSelection} disabled={!hasSelection}>
          Добавить из выделения
        </button>
      </div>
      <div ref={mountRef} />
      {selectionPopup &&
        createPortal(
          <div
            className="cm-add-popup"
            style={{ left: selectionPopup.left, top: selectionPopup.top }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <select
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
              className="cm-add-popup-target"
              value={attachTarget}
              onChange={(e) => setAttachTarget(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value="">— новая сущность —</option>
              {entities
                .filter((e) => e.type === selectedType && !e.candidate)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.placeholder} · {truncateValue(e.value)}
                  </option>
                ))}
            </select>
            <button type="button" onClick={handleAddFromPopup}>
              ＋
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
