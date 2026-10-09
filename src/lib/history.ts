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
export type HistoryDocMeta = Omit<HistoryDoc, 'sourceText' | 'entities'> & { entityCount: number }

const DB_VERSION = 2
const STORE = 'documents'
const META_STORE = 'documentMeta'
export const EXPORT_VERSION = 1
let connection: Promise<IDBDatabase> | null = null

function docMeta(doc: HistoryDoc): HistoryDocMeta {
  const { sourceText: _text, entities, ...meta } = doc
  return { ...meta, entityCount: entities.length }
}

function openDb(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    let blocked = false
    req.onblocked = () => {
      blocked = true
      reject(new Error('Обновление истории заблокировано другой вкладкой. Закройте старые вкладки MD Blinder и повторите попытку.'))
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        const metadata = db.createObjectStore(META_STORE, { keyPath: 'id' })
        const cursor = req.transaction!.objectStore(STORE).openCursor()
        cursor.onsuccess = () => {
          const current = cursor.result
          if (!current) return
          metadata.put(docMeta(current.value as HistoryDoc))
          current.continue()
        }
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // An open request cannot be cancelled. If an older tab unblocks it after
      // we reported the error, do not retain this now-unobserved connection.
      if (blocked) { db.close(); return }
      db.onversionchange = () => { db.close(); if (connection === opening) connection = null }
      db.onclose = () => { if (connection === opening) connection = null }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
  const opening = connection
  // Promise executors also catch synchronous SecurityError from indexedDB.open.
  // Do not permanently cache that rejected opening attempt.
  void opening.catch(() => { if (connection === opening) connection = null })
  return opening
}

function wrapRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Сохранение отменено хранилищем браузера'))
    tx.onerror = () => reject(tx.error ?? new Error('Ошибка хранилища браузера'))
  })
}

export async function loadDoc(id: string): Promise<HistoryDoc | undefined> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const [doc] = await Promise.all([
    wrapRequest(tx.objectStore(STORE).get(id) as IDBRequest<HistoryDoc | undefined>),
    transactionDone(tx),
  ])
  return doc ? { ...doc, entities: sanitizeEntities(doc.entities, doc.sourceText.length) } : undefined
}

export async function loadHistoryMetadata(): Promise<HistoryDocMeta[]> {
  const db = await openDb()
  const tx = db.transaction(META_STORE, 'readonly')
  const [docs] = await Promise.all([
    wrapRequest(tx.objectStore(META_STORE).getAll() as IDBRequest<HistoryDocMeta[]>),
    transactionDone(tx),
  ])
  return docs.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function loadAllDocs(): Promise<HistoryDoc[]> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  const [docs] = await Promise.all([wrapRequest(store.getAll() as IDBRequest<HistoryDoc[]>), transactionDone(tx)])
  return docs.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function putDoc(doc: HistoryDoc): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([STORE, META_STORE], 'readwrite')
  const done = transactionDone(tx)
  tx.objectStore(STORE).put(doc)
  tx.objectStore(META_STORE).put(docMeta(doc))
  await done
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([STORE, META_STORE], 'readwrite')
  const done = transactionDone(tx)
  tx.objectStore(STORE).delete(id)
  tx.objectStore(META_STORE).delete(id)
  await done
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
export function sanitizeEntities(raw: unknown, sourceLength = Infinity): Entity[] {
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
      .filter((p) => Number.isInteger(p.start) && Number.isInteger(p.end) && p.start >= 0 && p.start < p.end && p.end <= sourceLength)
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
    if (typeof e.relatedTo === 'string') out.relatedTo = e.relatedTo
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
  if (obj.version !== undefined && obj.version !== EXPORT_VERSION) {
    throw new Error('Версия экспорта истории не поддерживается. Обновите приложение.')
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
      entities: sanitizeEntities(d.entities, d.sourceText.length),
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
