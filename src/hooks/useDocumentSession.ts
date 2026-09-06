import { useCallback, useRef, useState } from 'react'
import type { HistoryDoc } from '../lib/history'
import type { Entity } from '../lib/anonymize/types'

export interface DocumentSnapshot {
  doc: HistoryDoc | null
  revision: number
}

export function useDocumentSession(onDirty: (doc: HistoryDoc) => void) {
  const [snapshot, setSnapshot] = useState<DocumentSnapshot>({ doc: null, revision: 0 })
  const snapshotRef = useRef(snapshot)

  const replace = useCallback((doc: HistoryDoc | null, dirty = false) => {
    const next = { doc, revision: snapshotRef.current.revision + 1 }
    // The ref is authoritative even between an event and the next React render.
    snapshotRef.current = next
    setSnapshot(next)
    if (doc && dirty) onDirty(doc)
    return next
  }, [onDirty])

  const edit = useCallback((sourceText: string, entities: Entity[]) => {
    const doc = snapshotRef.current.doc
    if (!doc) return
    replace({ ...doc, sourceText, entities, updatedAt: Date.now() }, true)
  }, [replace])

  const setEntities = useCallback((update: Entity[] | ((prev: Entity[]) => Entity[])) => {
    const doc = snapshotRef.current.doc
    if (!doc) return
    const entities = typeof update === 'function' ? update(doc.entities) : update
    edit(doc.sourceText, entities)
  }, [edit])

  const isCurrent = useCallback((candidate: DocumentSnapshot) => (
    snapshotRef.current.revision === candidate.revision &&
    snapshotRef.current.doc?.id === candidate.doc?.id
  ), [])

  return { snapshot, snapshotRef, replace, edit, setEntities, isCurrent }
}
