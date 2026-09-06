import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryDoc } from './history'

interface FakeRequest {
  result: unknown
  error: Error | null
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  onblocked?: (() => void) | null
}

const request = (result?: unknown): FakeRequest => ({ result, error: null, onsuccess: null, onerror: null })

function transaction() {
  const requests: FakeRequest[] = []
  const newRequest = () => { const next = request(); requests.push(next); return next }
  const documents = { put: vi.fn(newRequest), get: vi.fn(newRequest), getAll: vi.fn(newRequest), delete: vi.fn(newRequest) }
  const metadata = { put: vi.fn(newRequest), getAll: vi.fn(newRequest), delete: vi.fn(newRequest) }
  return {
    error: null as Error | null,
    oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null,
    onerror: null as (() => void) | null,
    objectStore: vi.fn((name: string) => name === 'documents' ? documents : metadata),
    documents, metadata, requests,
  }
}

function database() {
  const transactions: ReturnType<typeof transaction>[] = []
  return {
    onversionchange: null as (() => void) | null,
    onclose: null as (() => void) | null,
    close: vi.fn(),
    transaction: vi.fn(() => { const tx = transaction(); transactions.push(tx); return tx }),
    transactions,
  }
}

const document: HistoryDoc = {
  id: 'A', name: 'A.docx', format: 'docx', createdAt: 1, updatedAt: 2, sourceText: 'Sensitive Alex',
  entities: [{ id: 'alex', type: 'PERSON', value: 'Alex', placeholder: '[PERSON_1]', positions: [{ start: 10, end: 14 }], anonymize: true, manual: false }],
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('IndexedDB persistence boundaries', () => {
  it('reports blocked migration, permits retry, and closes a late unobserved connection', async () => {
    const staleDb = database()
    const staleOpening = request(staleDb)
    const db = database()
    const opening = request(db)
    const open = vi.fn().mockReturnValueOnce(staleOpening).mockReturnValueOnce(opening)
    vi.stubGlobal('indexedDB', { open })
    const { putDoc } = await import('./history')
    const pending = putDoc(document)
    const rejected = expect(pending).rejects.toThrow('Закройте старые вкладки')
    staleOpening.onblocked!()
    await rejected
    const retry = putDoc(document)
    expect(open).toHaveBeenCalledTimes(2)
    staleOpening.onsuccess!()
    expect(staleDb.close).toHaveBeenCalledOnce()
    expect(staleDb.transaction).not.toHaveBeenCalled()
    opening.onsuccess!()
    await Promise.resolve()
    db.transactions[0].oncomplete!()
    await retry
  })

  it('commits document content and metadata together and resolves only on transaction completion', async () => {
    const db = database()
    const opening = request(db)
    const open = vi.fn(() => opening)
    vi.stubGlobal('indexedDB', { open })
    const { putDoc } = await import('./history')
    let resolved = false
    const saved = putDoc(document).then(() => { resolved = true })
    opening.onsuccess!()
    await Promise.resolve()
    const tx = db.transactions[0]
    expect(db.transaction).toHaveBeenCalledWith(['documents', 'documentMeta'], 'readwrite')
    expect(tx.documents.put).toHaveBeenCalledExactlyOnceWith(document)
    expect(tx.metadata.put).toHaveBeenCalledExactlyOnceWith({ id: 'A', name: 'A.docx', format: 'docx', createdAt: 1, updatedAt: 2, entityCount: 1 })
    // Individual request success is not a committed transaction.
    for (const req of tx.requests) req.onsuccess?.()
    await Promise.resolve()
    expect(resolved).toBe(false)
    tx.oncomplete!()
    await saved
    expect(resolved).toBe(true)
  })

  it('rejects a transaction abort after requests were issued', async () => {
    const db = database()
    const opening = request(db)
    vi.stubGlobal('indexedDB', { open: () => opening })
    const { putDoc } = await import('./history')
    const pending = putDoc(document)
    const rejected = expect(pending).rejects.toThrow('quota exceeded')
    opening.onsuccess!()
    await Promise.resolve()
    const tx = db.transactions[0]
    expect(tx.documents.put).toHaveBeenCalledOnce()
    tx.error = new Error('quota exceeded')
    tx.onabort!()
    await rejected
  })

  it('shares one opening connection across concurrent writes while retaining separate transactions', async () => {
    const db = database()
    const opening = request(db)
    const open = vi.fn(() => opening)
    vi.stubGlobal('indexedDB', { open })
    const { putDoc } = await import('./history')
    const first = putDoc(document)
    const second = putDoc({ ...document, id: 'B' })
    expect(open).toHaveBeenCalledOnce()
    opening.onsuccess!()
    await Promise.resolve()
    expect(db.transactions).toHaveLength(2)
    expect(db.transactions[0].documents.put).toHaveBeenCalledWith(document)
    expect(db.transactions[1].documents.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'B' }))
    for (const tx of db.transactions) tx.oncomplete!()
    await Promise.all([first, second])
  })

  it('retries a synchronous opening failure instead of caching it permanently', async () => {
    const db = database()
    const opening = request(db)
    const open = vi.fn(() => opening).mockImplementationOnce(() => { throw new Error('temporary access denial') })
    vi.stubGlobal('indexedDB', { open })
    const { putDoc } = await import('./history')
    await expect(putDoc(document)).rejects.toThrow('temporary access denial')
    const retry = putDoc(document)
    expect(open).toHaveBeenCalledTimes(2)
    opening.onsuccess!()
    await Promise.resolve()
    db.transactions[0].oncomplete!()
    await retry
  })

  it('closes the old connection on version change and opens a fresh one for the next operation', async () => {
    const firstDb = database()
    const firstOpening = request(firstDb)
    const secondDb = database()
    const secondOpening = request(secondDb)
    const open = vi.fn().mockReturnValueOnce(firstOpening).mockReturnValueOnce(secondOpening)
    vi.stubGlobal('indexedDB', { open })
    const { putDoc } = await import('./history')
    const first = putDoc(document)
    firstOpening.onsuccess!()
    await Promise.resolve()
    firstDb.transactions[0].oncomplete!()
    await first
    firstDb.onversionchange!()
    expect(firstDb.close).toHaveBeenCalledOnce()
    const second = putDoc(document)
    expect(open).toHaveBeenCalledTimes(2)
    secondOpening.onsuccess!()
    await Promise.resolve()
    secondDb.transactions[0].oncomplete!()
    await second
  })

  it('loads the history list solely from metadata and waits for the read transaction to complete', async () => {
    const db = database()
    const opening = request(db)
    vi.stubGlobal('indexedDB', { open: () => opening })
    const { loadHistoryMetadata } = await import('./history')
    let resolved = false
    const loading = loadHistoryMetadata().then((docs) => { resolved = true; return docs })
    opening.onsuccess!()
    await Promise.resolve()
    const tx = db.transactions[0]
    expect(db.transaction).toHaveBeenCalledWith('documentMeta', 'readonly')
    expect(tx.documents.getAll).not.toHaveBeenCalled()
    const req = tx.requests[0]
    req.result = [{ id: 'older', updatedAt: 1 }, { id: 'newer', updatedAt: 2 }]
    req.onsuccess!()
    await Promise.resolve()
    expect(resolved).toBe(false)
    tx.oncomplete!()
    expect((await loading).map((doc) => doc.id)).toEqual(['newer', 'older'])
  })
})
