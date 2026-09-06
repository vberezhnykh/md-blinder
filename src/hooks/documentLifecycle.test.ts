// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryDoc } from '../lib/history'
import { useDocumentSession } from './useDocumentSession'
import { useHistoryStore } from './useHistoryStore'
import { useAnalysisJob } from './useAnalysisJob'

const history = vi.hoisted(() => ({ putDoc: vi.fn(), loadHistoryMetadata: vi.fn() }))
vi.mock('../lib/history', () => history)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function doc(id = 'A', sourceText = 'Sensitive Alex'): HistoryDoc {
  return { id, name: `${id}.docx`, format: 'docx', createdAt: 1, updatedAt: 2, sourceText, entities: [] }
}

let root: Root | undefined
let container: HTMLDivElement

async function mount<T>(useValue: () => T) {
  let current!: T
  function Harness() {
    const value = useValue()
    useLayoutEffect(() => { current = value })
    return null
  }
  root = createRoot(container)
  await act(() => root!.render(createElement(Harness)))
  return { get current() { return current } }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  history.putDoc.mockReset().mockResolvedValue(undefined)
  history.loadHistoryMetadata.mockReset().mockResolvedValue([])
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  if (root) await act(() => root!.unmount())
  root = undefined
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('document revision and export snapshots', () => {
  it('invalidates a checked snapshot immediately, before React renders, including entity-only edits', async () => {
    const onDirty = vi.fn()
    const hook = await mount(() => useDocumentSession(onDirty))
    await act(() => { hook.current.replace(doc()) })
    const checked = hook.current.snapshotRef.current
    await act(() => {
      hook.current.setEntities([{ id: 'alex', type: 'PERSON', value: 'Alex', placeholder: '[PERSON_1]',
        positions: [{ start: 10, end: 14 }], anonymize: true, manual: false }])
      expect(hook.current.isCurrent(checked)).toBe(false)
      expect(hook.current.snapshotRef.current.doc!.entities).toHaveLength(1)
      // A second event in the same render batch sees the first event's changes.
      hook.current.setEntities((previous) => previous.map((entity) => ({ ...entity, anonymize: false })))
      expect(hook.current.snapshotRef.current.doc!.entities[0].anonymize).toBe(false)
    })
    expect(onDirty).toHaveBeenCalledTimes(2)
    expect(hook.current.snapshot.revision).toBe(checked.revision + 2)
    expect(checked.doc!.entities).toEqual([])
  })

  it('never revives a stale check after A to B to A, even when the same document object returns', async () => {
    const hook = await mount(() => useDocumentSession(vi.fn()))
    const original = doc()
    await act(() => { hook.current.replace(original) })
    const checked = hook.current.snapshot
    await act(() => {
      hook.current.replace(doc('B'))
      hook.current.replace(original)
    })
    expect(hook.current.isCurrent(checked)).toBe(false)
    expect(hook.current.snapshot.doc).toBe(original)
  })
})

describe('dirty document persistence', () => {
  it('persists an empty document before allowing navigation to another document', async () => {
    const saved = deferred<void>()
    history.putDoc.mockReturnValueOnce(saved.promise)
    const hook = await mount(() => {
      const store = useHistoryStore()
      const session = useDocumentSession(store.queueSave)
      return { store, session }
    })
    await act(() => {
      hook.current.session.replace(doc())
      hook.current.session.edit('', [])
    })
    let navigation!: Promise<unknown>
    await act(() => { navigation = hook.current.store.flush().then(() => hook.current.session.replace(doc('B'))) })
    expect(history.putDoc).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'A', sourceText: '', entities: [] }))
    expect(hook.current.session.snapshotRef.current.doc!.id).toBe('A')
    await act(async () => { saved.resolve(); await navigation })
    expect(hook.current.session.snapshot.doc!.id).toBe('B')
    expect(hook.current.store.saving).toBe(false)
  })

  it('coalesces typing but keeps independent dirty snapshots for different documents', async () => {
    const hook = await mount(useHistoryStore)
    await act(() => {
      hook.current.queueSave(doc('A', 'old'))
      hook.current.queueSave(doc('A', 'new'))
      hook.current.queueSave(doc('B', 'second'))
    })
    expect(history.putDoc).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(800))
    expect(history.putDoc.mock.calls.map(([document]) => [document.id, document.sourceText])).toEqual([
      ['A', 'new'], ['B', 'second'],
    ])
    expect(hook.current.saving).toBe(false)
  })

  it('does not discard an edit queued while an earlier revision is committing', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    history.putDoc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const hook = await mount(useHistoryStore)
    await act(() => hook.current.queueSave(doc('A', 'before')))
    let saving!: Promise<void>
    let done = false
    await act(() => { saving = hook.current.flush().then(() => { done = true }) })
    await act(() => hook.current.queueSave(doc('A', 'after')))
    await act(async () => { first.resolve(); await first.promise })
    expect(history.putDoc.mock.calls.map(([document]) => document.sourceText)).toEqual(['before', 'after'])
    expect(done).toBe(false)
    expect(hook.current.saving).toBe(true)
    await act(async () => { second.resolve(); await saving })
    expect(done).toBe(true)
    expect(hook.current.saving).toBe(false)
  })

  it('retains the dirty snapshot after transaction failure and retries it explicitly', async () => {
    const transaction = deferred<void>()
    history.putDoc.mockReturnValueOnce(transaction.promise)
    const hook = await mount(useHistoryStore)
    const latest = doc('A', 'latest edit')
    await act(() => hook.current.queueSave(latest))
    let failed!: Promise<void>
    await act(() => { failed = hook.current.flush() })
    const rejected = expect(failed).rejects.toThrow('quota')
    await act(async () => { transaction.reject(new Error('quota')); await rejected })
    expect(hook.current.error).toContain('quota')
    expect(hook.current.saving).toBe(true) // dirty work is still pending, not silently discarded
    await act(() => hook.current.flush())
    expect(history.putDoc).toHaveBeenNthCalledWith(2, latest)
    expect(hook.current.error).toBe('')
    expect(hook.current.saving).toBe(false)
  })

  it('serializes overlapping flush calls so navigation and export do not write the same snapshot twice', async () => {
    const transaction = deferred<void>()
    history.putDoc.mockReturnValueOnce(transaction.promise)
    const hook = await mount(useHistoryStore)
    await act(() => hook.current.queueSave(doc()))
    let navigation!: Promise<void>
    let exportHistory!: Promise<void>
    await act(() => {
      navigation = hook.current.flush()
      exportHistory = hook.current.flush()
    })
    expect(history.putDoc).toHaveBeenCalledTimes(1)
    await act(async () => { transaction.resolve(); await Promise.all([navigation, exportHistory]) })
    expect(history.putDoc).toHaveBeenCalledTimes(1)
  })

  it('flushes dirty edits on page hide instead of waiting for the debounce', async () => {
    const hook = await mount(useHistoryStore)
    await act(() => hook.current.queueSave(doc('A', 'pending')))
    await act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(history.putDoc).toHaveBeenCalledWith(expect.objectContaining({ sourceText: 'pending' }))
  })

  it('recovers a failed metadata refresh without rewriting an already committed document', async () => {
    const hook = await mount(useHistoryStore)
    history.loadHistoryMetadata.mockRejectedValueOnce(new Error('metadata unavailable'))
    await act(() => hook.current.queueSave(doc()))
    await act(async () => { await expect(hook.current.flush()).rejects.toThrow('metadata unavailable') })
    expect(hook.current.error).toContain('Изменения сохранены')
    expect(history.putDoc).toHaveBeenCalledTimes(1)
    expect(hook.current.saving).toBe(false)
    const refreshed = [{ id: 'A', name: 'A.docx', updatedAt: 2, createdAt: 1, format: 'docx', entityCount: 0 }]
    history.loadHistoryMetadata.mockResolvedValueOnce(refreshed)
    await act(() => hook.current.flush())
    expect(hook.current.history).toEqual(refreshed)
    expect(hook.current.error).toBe('')
    expect(history.putDoc).toHaveBeenCalledTimes(1)
  })

  it('can retry initial history failure before any document edit', async () => {
    history.loadHistoryMetadata.mockRejectedValueOnce(new Error('browser denied access'))
    const hook = await mount(useHistoryStore)
    expect(hook.current.error).toContain('browser denied access')
    await act(() => hook.current.flush())
    expect(hook.current.error).toBe('')
    expect(history.putDoc).not.toHaveBeenCalled()
  })

  it('commits edits made during metadata refresh before the navigation barrier resolves', async () => {
    const hook = await mount(useHistoryStore)
    const refresh = deferred<unknown[]>()
    history.loadHistoryMetadata.mockReturnValueOnce(refresh.promise)
    await act(() => hook.current.queueSave(doc('A', 'first')))
    let saving!: Promise<void>
    await act(() => { saving = hook.current.flush() })
    await act(() => hook.current.queueSave(doc('A', 'during refresh')))
    await act(async () => { refresh.resolve([]); await saving })
    expect(history.putDoc.mock.calls.map(([document]) => document.sourceText)).toEqual(['first', 'during refresh'])
    expect(hook.current.saving).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(800))
    expect(history.putDoc).toHaveBeenCalledTimes(2)
  })
})

describe('analysis job ownership', () => {
  it('aborts the previous analysis and prevents its completion from clearing the new job', async () => {
    const hook = await mount(useAnalysisJob)
    const first = hook.current.start()
    const second = hook.current.start()
    expect(first.signal.aborted).toBe(true)
    expect(first.isCurrent()).toBe(false)
    first.finish()
    expect(second.isCurrent()).toBe(true)
    second.finish()
    expect(second.isCurrent()).toBe(false)
  })

  it('aborts the active conversion or control pass when its owner unmounts', async () => {
    const hook = await mount(useAnalysisJob)
    const job = hook.current.start()
    await act(() => root!.unmount())
    root = undefined
    expect(job.signal.aborted).toBe(true)
    expect(job.isCurrent()).toBe(false)
  })
})
