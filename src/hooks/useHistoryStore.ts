import { useCallback, useEffect, useRef, useState } from 'react'
import { loadHistoryMetadata, putDoc, type HistoryDoc, type HistoryDocMeta } from '../lib/history'

export function useHistoryStore() {
  const [history, setHistory] = useState<HistoryDocMeta[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(new Map<string, HistoryDoc>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writes = useRef<Promise<void>>(Promise.resolve())

  const refresh = useCallback(async () => {
    setHistory(await loadHistoryMetadata())
  }, [])

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = writes.current.catch(() => {}).then(async () => {
      setSaving(pending.current.size > 0)
      let phase: 'save' | 'refresh' = 'save'
      try {
        // A concurrent edit replaces the map entry, so saving an older snapshot
        // must not remove the newer one from the queue.
        do {
          phase = 'save'
          while (pending.current.size) {
            for (const [id, doc] of pending.current) {
              await putDoc(doc)
              if (pending.current.get(id) === doc) pending.current.delete(id)
            }
          }
          phase = 'refresh'
          await refresh()
          // A navigation barrier must also commit edits made while metadata was
          // loading, not leave them to a future debounce after the caller exits.
        } while (pending.current.size)
        setError('')
      } catch (err) {
        setError(`${phase === 'save' ? 'Не удалось сохранить изменения' : 'Изменения сохранены, но список истории недоступен'}: ${err instanceof Error ? err.message : String(err)}`)
        throw err
      } finally {
        setSaving(pending.current.size > 0)
      }
    })
    writes.current = next
    return next
  }, [refresh])

  const queueSave = useCallback((doc: HistoryDoc) => {
    pending.current.set(doc.id, doc)
    setSaving(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush().catch(() => {}) }, 800)
  }, [flush])

  useEffect(() => {
    // External IndexedDB load: refresh updates state only AFTER its awaited read.
    // oxlint currently follows the async helper as if it were a synchronous setState.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh().catch((err: unknown) => setError(`История недоступна: ${String(err)}`))
    const save = () => { void flush().catch(() => {}) }
    const visibility = () => { if (document.visibilityState === 'hidden') save() }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending.current.size) return
      save()
      event.preventDefault()
      event.returnValue = ''
    }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', save)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', save)
      window.removeEventListener('beforeunload', beforeUnload)
      if (timer.current) clearTimeout(timer.current)
      save()
    }
  }, [refresh, flush])

  return { history, error, setError, saving, queueSave, flush, refresh }
}
