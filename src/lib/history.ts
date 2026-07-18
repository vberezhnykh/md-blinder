import { ALL_ENTITY_TYPES, type Entity } from './anonymize/types'

export interface HistoryDoc {
  id: string
  name: string
  format: 'docx' | 'pdf'
  createdAt: number
  updatedAt: number
  sourceText: string
  entities: Entity[]
}

const DB_NAME = 'md-blinder'
const DB_VERSION = 1
const STORE = 'documents'
export const EXPORT_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function wrapRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadAllDocs(): Promise<HistoryDoc[]> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  const docs = await wrapRequest(store.getAll() as IDBRequest<HistoryDoc[]>)
  return docs.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function putDoc(doc: HistoryDoc): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  await wrapRequest(store.put(doc))
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  await wrapRequest(store.delete(id))
}

export function serializeHistory(docs: HistoryDoc[]): string {
  return JSON.stringify(
    { app: 'md-blinder', kind: 'history', version: EXPORT_VERSION, exportedAt: Date.now(), documents: docs },
    null,
    2,
  )
}

const INVALID_EXPORT_ERROR = 'Файл не похож на экспорт истории MD Blinder'

// Never throws: a malformed entity is dropped rather than crashing the import.
// Unknown types are coerced to OTHER; positions are filtered to well-formed
// { start, end } pairs, and an entity left with none is dropped entirely.
export function sanitizeEntities(raw: unknown): Entity[] {
  if (!Array.isArray(raw)) return []
  const result: Entity[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const e = item as Record<string, unknown>
    if (
      typeof e.id !== 'string' ||
      typeof e.value !== 'string' ||
      typeof e.placeholder !== 'string' ||
      typeof e.type !== 'string'
    ) {
      continue
    }
    const type = (ALL_ENTITY_TYPES as string[]).includes(e.type) ? (e.type as Entity['type']) : 'OTHER'

    if (!Array.isArray(e.positions)) continue
    const positions = e.positions
      .map((p): { start: number; end: number } => {
        const pos = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>
        return { start: Number(pos.start), end: Number(pos.end) }
      })
      .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.start < p.end)
    if (positions.length === 0) continue

    const out: Entity = {
      id: e.id,
      type,
      value: e.value,
      placeholder: e.placeholder,
      positions,
      anonymize: typeof e.anonymize === 'boolean' ? e.anonymize : true,
      manual: Boolean(e.manual),
    }
    if (typeof e.score === 'number') out.score = e.score
    if (e.candidate === true) out.candidate = true
    if (typeof e.candidateNote === 'string') out.candidateNote = e.candidateNote
    if (e.dismissed === true) out.dismissed = true
    result.push(out)
  }
  return result
}

export function parseHistory(json: string): HistoryDoc[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error(INVALID_EXPORT_ERROR)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(INVALID_EXPORT_ERROR)
  }
  const obj = parsed as Record<string, unknown>
  if (obj.app !== 'md-blinder' || obj.kind !== 'history' || !Array.isArray(obj.documents)) {
    throw new Error(INVALID_EXPORT_ERROR)
  }

  return obj.documents.map((raw): HistoryDoc => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(INVALID_EXPORT_ERROR)
    }
    const d = raw as Record<string, unknown>
    if (
      typeof d.id !== 'string' ||
      typeof d.name !== 'string' ||
      typeof d.sourceText !== 'string' ||
      !Array.isArray(d.entities)
    ) {
      throw new Error(INVALID_EXPORT_ERROR)
    }
    const now = Date.now()
    return {
      id: d.id,
      name: d.name,
      format: d.format === 'pdf' ? 'pdf' : 'docx',
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : now,
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : now,
      sourceText: d.sourceText,
      entities: sanitizeEntities(d.entities),
    }
  })
}

export function mergeDocs(existing: HistoryDoc[], incoming: HistoryDoc[]): HistoryDoc[] {
  const byId = new Map<string, HistoryDoc>()
  for (const doc of existing) byId.set(doc.id, doc)
  for (const doc of incoming) {
    const current = byId.get(doc.id)
    if (!current || doc.updatedAt > current.updatedAt) {
      byId.set(doc.id, doc)
    }
  }
  return Array.from(byId.values())
}
