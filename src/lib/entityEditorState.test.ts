import { describe, expect, it } from 'vitest'
import { history, redo, undo, undoDepth } from '@codemirror/commands'
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import type { Entity } from './anonymize/types'
import { buildAnonymizedText } from './anonymize/apply'
import {
  entityMetadataField,
  entityMetadataHistory,
  entitySyncTransaction,
  externalEntitySync,
  setEntityMetadata,
} from './entityEditorState'

function person(positions = [{ start: 10, end: 14 }]): Entity {
  return {
    id: 'alex', type: 'PERSON', value: 'Alex', placeholder: '[PERSON_1]',
    positions, anonymize: true, manual: false,
  }
}

function editor(doc = 'Sensitive Alex', entities = [person()]) {
  let state = EditorState.create({
    doc,
    extensions: [history(), entityMetadataField.init(() => entities), entityMetadataHistory],
  })
  return {
    get state() { return state },
    get text() { return state.doc.toString() },
    get entities() { return state.field(entityMetadataField) },
    get output() { return buildAnonymizedText(state.doc.toString(), state.field(entityMetadataField)) },
    update(spec: TransactionSpec) { state = state.update(spec).state },
    undo() { return undo({ state, dispatch: (transaction) => { state = transaction.state } }) },
    redo() { return redo({ state, dispatch: (transaction) => { state = transaction.state } }) },
  }
}

describe('entity editor history', () => {
  it('restores anonymization with deleted text, and removes both again on redo', () => {
    const view = editor()
    view.update({ changes: { from: 0, to: view.text.length }, userEvent: 'delete.selection' })
    expect(view.text).toBe('')
    expect(view.entities).toEqual([])
    expect(view.undo()).toBe(true)
    expect(view.text).toBe('Sensitive Alex')
    expect(view.entities).toEqual([person()])
    expect(view.output).toBe('Sensitive [PERSON_1]')
    expect(view.redo()).toBe(true)
    expect(view.text).toBe('')
    expect(view.entities).toEqual([])
    expect(view.undo()).toBe(true)
    expect(view.output).toBe('Sensitive [PERSON_1]')
  })

  it('recovers a deleted occurrence while preserving other occurrences and candidate metadata', () => {
    const entity = { ...person([{ start: 0, end: 4 }, { start: 6, end: 10 }]), candidate: true, candidateNote: 'Review', score: 0.4 }
    const view = editor('Alex, Alex', [entity])
    view.update({ changes: { from: 0, to: 6 }, userEvent: 'delete.selection' })
    expect(view.entities[0].positions).toEqual([{ start: 0, end: 4 }])
    view.undo()
    expect(view.entities).toEqual([entity])
    view.redo()
    expect(view.text).toBe('Alex')
    expect(view.entities[0].candidateNote).toBe('Review')
  })

  it('restores the original snapshot when consecutive typing events are grouped', () => {
    const view = editor('Alex', [person([{ start: 0, end: 4 }])])
    view.update({ changes: { from: 2, insert: 'i' }, userEvent: 'input.type', annotations: Transaction.time.of(100) })
    view.update({ changes: { from: 3, insert: 'c' }, userEvent: 'input.type', annotations: Transaction.time.of(101) })
    expect(view.text).toBe('Alicex')
    expect(view.entities[0].positions).toEqual([{ start: 0, end: 6 }])
    expect(undoDepth(view.state)).toBe(1)
    view.undo()
    expect(view.text).toBe('Alex')
    expect(view.output).toBe('[PERSON_1]')
    expect(view.entities[0].positions).toEqual([{ start: 0, end: 4 }])
    view.redo()
    expect(view.text).toBe('Alicex')
    expect(view.entities[0].positions).toEqual([{ start: 0, end: 6 }])
  })

  it('keeps metadata edits in their own undo step between text edits', () => {
    const view = editor()
    view.update({ changes: { from: 0, insert: 'A ' }, userEvent: 'input.type' })
    const shifted = view.entities
    view.update(entitySyncTransaction([{ ...shifted[0], anonymize: false }]))
    view.update({ changes: { from: 0, to: view.text.length }, userEvent: 'delete.selection' })
    view.undo()
    expect(view.text).toBe('A Sensitive Alex')
    expect(view.entities[0].anonymize).toBe(false)
    view.undo()
    expect(view.entities[0].anonymize).toBe(true)
    expect(view.text).toBe('A Sensitive Alex')
    view.undo()
    expect(view.text).toBe('Sensitive Alex')
    expect(view.entities).toEqual([person()])
    view.redo()
    view.redo()
    expect(view.entities[0].anonymize).toBe(false)
    expect(view.text).toBe('A Sensitive Alex')
  })

  it('preserves add/delete/type/range metadata edits through undo and redo', () => {
    const view = editor()
    const updated = [{ ...person(), type: 'OTHER' as const, placeholder: '[OTHER_1]', positions: [{ start: 0, end: 14 }], manual: true }]
    view.update(entitySyncTransaction(updated))
    view.update(entitySyncTransaction([]))
    view.undo()
    expect(view.entities).toEqual(updated)
    view.undo()
    expect(view.entities).toEqual([person()])
    view.redo()
    view.redo()
    expect(view.entities).toEqual([])
  })

  it('synchronizes replacement text and metadata atomically without marking undo as external', () => {
    const view = editor()
    const replacement = person([{ start: 0, end: 4 }])
    const spec = entitySyncTransaction([replacement], { from: 0, to: view.text.length, insert: 'Alex' })
    expect(view.state.update(spec).annotation(externalEntitySync)).toBe(true)
    view.update(spec)
    expect(view.output).toBe('[PERSON_1]')
    let undoTransaction: Transaction | undefined
    undo({ state: view.state, dispatch: (transaction) => { undoTransaction = transaction } })
    expect(undoTransaction?.annotation(externalEntitySync)).toBeUndefined()
    view.undo()
    expect(view.output).toBe('Sensitive [PERSON_1]')
  })

  it('shifts spans around boundary edits without swallowing new surrounding text', () => {
    const view = editor('Alex', [person([{ start: 0, end: 4 }])])
    view.update({ changes: [{ from: 0, insert: '(' }, { from: 4, insert: ')' }], userEvent: 'input' })
    expect(view.output).toBe('([PERSON_1])')
    view.undo()
    expect(view.output).toBe('[PERSON_1]')
    view.redo()
    expect(view.output).toBe('([PERSON_1])')
  })

  it('does not add selection-only transactions to the metadata history', () => {
    const view = editor()
    view.update({ selection: { anchor: 3 } })
    expect(undoDepth(view.state)).toBe(0)
    expect(view.undo()).toBe(false)
  })

  it('supports in-editor metadata changes such as dragging a span', () => {
    const view = editor()
    const resized = [{ ...person(), positions: [{ start: 0, end: 14 }] }]
    view.update({ effects: setEntityMetadata.of(resized) })
    expect(view.output).toBe('[PERSON_1]')
    view.undo()
    expect(view.output).toBe('Sensitive [PERSON_1]')
    view.redo()
    expect(view.output).toBe('[PERSON_1]')
  })
})
