import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectEntitiesNer, disposeNerWorker } from './ner'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  sent: { requestId: string; text: string }[] = []
  terminated = false
  constructor() { FakeWorker.instances.push(this) }
  postMessage(data: { requestId: string; text: string }) { this.sent.push(data) }
  terminate() { this.terminated = true }
  done(matches: unknown[] = []) {
    this.onmessage?.({ data: { type: 'done', requestId: this.sent.at(-1)!.requestId, matches } } as MessageEvent)
  }
}

beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker) })
afterEach(() => { disposeNerWorker(); vi.unstubAllGlobals() })

describe('shared NER worker lifecycle', () => {
  it('serializes inference and reuses the warmed worker', async () => {
    const a = detectEntitiesNer('Alice')
    const b = detectEntitiesNer('Bob')
    const worker = FakeWorker.instances[0]
    expect(worker.sent.map((m) => m.text)).toEqual(['Alice'])
    worker.done()
    await expect(a).resolves.toEqual([])
    expect(worker.sent.map((m) => m.text)).toEqual(['Alice', 'Bob'])
    worker.done()
    await b
    expect(FakeWorker.instances).toHaveLength(1)
  })
  it('rejects every waiter after a structured session failure', async () => {
    const a = detectEntitiesNer('Alice').catch((e: Error) => e.message)
    const b = detectEntitiesNer('Bob').catch((e: Error) => e.message)
    const worker = FakeWorker.instances[0]
    worker.onmessage?.({ data: { type: 'error', requestId: worker.sent[0].requestId, error: 'GPU lost' } } as MessageEvent)
    expect(await Promise.all([a, b])).toEqual(['GPU lost', 'GPU lost'])
    expect(worker.terminated).toBe(true)
    const retry = detectEntitiesNer('Retry')
    FakeWorker.instances[1].done()
    await retry
  })
  it('cancels queued work without killing the active request', async () => {
    const a = detectEntitiesNer('Alice')
    const controller = new AbortController()
    const b = detectEntitiesNer('Bob', undefined, controller.signal).catch((e: Error) => e.name)
    controller.abort()
    expect(await b).toBe('AbortError')
    const worker = FakeWorker.instances[0]
    expect(worker.terminated).toBe(false)
    worker.done()
    await a
    expect(worker.sent).toHaveLength(1)
  })
  it('cancels running inference and starts queued work in a fresh runtime', async () => {
    const controller = new AbortController()
    const a = detectEntitiesNer('Alice', undefined, controller.signal).catch((e: Error) => e.name)
    const b = detectEntitiesNer('Bob')
    const old = FakeWorker.instances[0]
    controller.abort()
    expect(await a).toBe('AbortError')
    expect(old.terminated).toBe(true)
    old.done([{ value: 'obsolete' }])
    FakeWorker.instances[1].done()
    await expect(b).resolves.toEqual([])
  })
  it('handles worker construction failure without leaking promises', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked') } })
    await expect(detectEntitiesNer('Alice')).rejects.toThrow('blocked')
  })
})
