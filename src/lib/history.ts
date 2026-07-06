import type { Entity } from './anonymize/types'

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
      entities: d.entities as Entity[],
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
