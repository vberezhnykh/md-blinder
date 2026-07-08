import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { basicSetup, EditorView } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Decoration, type DecorationSet, hoverTooltip } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import { ALL_ENTITY_TYPES, type Entity, type EntityType } from '../lib/anonymize/types'

interface EntityEditorProps {
  value: string
  entities: Entity[]
  onChange: (nextText: string, nextEntities: Entity[]) => void
  onAddEntity: (from: number, to: number) => void
  selectedType: EntityType
  onSelectedTypeChange: (t: EntityType) => void
  reveal?: { from: number; to: number; nonce: number } | null
}

interface SelectionPopupState {
  from: number
  to: number
  left: number
  top: number
}

const setEntitiesEffect = StateEffect.define<Entity[]>()

function buildDecorations(entities: Entity[]): DecorationSet {
  const ranges = []
  for (const e of entities) {
    for (const p of e.positions) {
      if (p.end <= p.start) continue
      ranges.push(
        Decoration.mark({
          class: `cm-entity cm-entity-${e.type}${e.anonymize ? '' : ' cm-entity-inactive'}`,
        }).range(p.start, p.end),
      )
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to)
  return Decoration.set(ranges, true)
}

const entityDecorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const eff of tr.effects) if (eff.is(setEntitiesEffect)) deco = buildDecorations(eff.value)
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
  selectedType,
  onSelectedTypeChange,
  reveal,
}: EntityEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const entitiesRef = useRef(entities)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onAddEntityRef = useRef(onAddEntity)
  const [hasSelection, setHasSelection] = useState(false)
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopupState | null>(null)
  const selectionPopupRef = useRef<SelectionPopupState | null>(null)

  entitiesRef.current = entities
  valueRef.current = value
  onChangeRef.current = onChange
  onAddEntityRef.current = onAddEntity
  selectionPopupRef.current = selectionPopup

  useEffect(() => {
    if (!mountRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet) {
        const sel = update.state.selection.main
        setHasSelection(!sel.empty)
        if (sel.empty) {
          setSelectionPopup(null)
        } else {
          const coords = update.view.coordsAtPos(sel.to)
          setSelectionPopup(
            coords ? { from: sel.from, to: sel.to, left: coords.left, top: coords.bottom + 6 } : null,
          )
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
          return { ...e, positions, occurrences: positions.length }
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
                dom.textContent = `${e.placeholder} · ${e.type} · ${original}`
                return { dom }
              },
            }
          }
        }
      }
      return null
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
        updateListener,
        editorTheme,
      ],
    })
    viewRef.current = view
    view.dispatch({ effects: setEntitiesEffect.of(entitiesRef.current) })

    const handleScroll = () => {
      const current = selectionPopupRef.current
      if (!current) return
      const coords = view.coordsAtPos(current.to)
      if (!coords) {
        setSelectionPopup(null)
        return
      }
      setSelectionPopup({ ...current, left: coords.left, top: coords.bottom + 6 })
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
    view.dispatch({ effects: setEntitiesEffect.of(entities) })
  }, [entities])

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
    onAddEntityRef.current(selectionPopup.from, selectionPopup.to)
    setSelectionPopup(null)
  }

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
              onChange={(e) => onSelectedTypeChange(e.target.value as EntityType)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {ALL_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button type="button" onClick={handleAddFromPopup}>
              ＋
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}

export default EntityEditor
