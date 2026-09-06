// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from 'codemirror'
import { redo, undo } from '@codemirror/commands'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EntityEditor from './EntityEditor'
import { entityMetadataField } from '../lib/entityEditorState'
import type { Entity } from '../lib/anonymize/types'

const original: Entity[] = [{
  id: 'alex', type: 'PERSON', value: 'Alex', placeholder: '[PERSON_1]',
  positions: [{ start: 10, end: 14 }], anonymize: true, manual: false,
}]

describe('EntityEditor controlled state', () => {
  let container: HTMLDivElement
  let root: Root
  const onChange = vi.fn()
  const commonProps = {
    onChange,
    onAddEntity: vi.fn(),
    onAttachToEntity: vi.fn(),
    selectedType: 'PERSON' as const,
    onSelectedTypeChange: vi.fn(),
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    onChange.mockClear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  function view() {
    return EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!
  }

  it('does not echo initial render or atomic external text/entity synchronization', async () => {
    await act(() => root.render(createElement(EntityEditor, { ...commonProps, value: 'Sensitive Alex', entities: original })))
    expect(onChange).not.toHaveBeenCalled()
    const replaced = [{ ...original[0], positions: [{ start: 0, end: 4 }] }]
    await act(() => root.render(createElement(EntityEditor, { ...commonProps, value: 'Alex', entities: replaced })))
    expect(onChange).not.toHaveBeenCalled()
    expect(view().state.doc.toString()).toBe('Alex')
    expect(view().state.field(entityMetadataField)).toBe(replaced)
    expect(container.querySelector('.cm-entity')?.textContent).toBe('Alex')
  })

  it('emits text and restored entities together on real CodeMirror undo/redo', async () => {
    function ControlledEditor() {
      const [document, setDocument] = useState({ value: 'Sensitive Alex', entities: original })
      return createElement(EntityEditor, {
        ...commonProps,
        ...document,
        onChange: (value, entities) => {
          onChange(value, entities)
          setDocument({ value, entities })
        },
      })
    }
    await act(() => root.render(createElement(ControlledEditor)))
    await act(() => view().dispatch({ changes: { from: 0, to: 14 }, userEvent: 'delete.selection' }))
    expect(onChange).toHaveBeenLastCalledWith('', [])
    expect(onChange).toHaveBeenCalledTimes(1)
    await act(() => { undo(view()) })
    expect(onChange).toHaveBeenLastCalledWith('Sensitive Alex', original)
    expect(container.querySelector('.cm-entity')?.textContent).toBe('Alex')
    expect(onChange).toHaveBeenCalledTimes(2)
    await act(() => { redo(view()) })
    expect(onChange).toHaveBeenLastCalledWith('', [])
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('makes external entity edits undoable while synchronizing them without an echo', async () => {
    await act(() => root.render(createElement(EntityEditor, { ...commonProps, value: 'Sensitive Alex', entities: original })))
    const unchecked = [{ ...original[0], anonymize: false }]
    await act(() => root.render(createElement(EntityEditor, { ...commonProps, value: 'Sensitive Alex', entities: unchecked })))
    expect(onChange).not.toHaveBeenCalled()
    await act(() => { undo(view()) })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Sensitive Alex', original)
  })
})
