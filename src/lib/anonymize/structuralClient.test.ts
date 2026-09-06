import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectStructuralAsync } from './structuralClient'

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor(readonly url: URL) { MockWorker.instances.push(this) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  MockWorker.instances = []
})

describe('structural analysis worker', () => {
  it('uses the synchronous core for non-browser consumers', async () => {
    vi.stubGlobal('Worker', undefined)
    expect(await detectStructuralAsync('alice@example.com')).toEqual([
      { type: 'EMAIL', value: 'alice@example.com', start: 0, end: 17 },
    ])
  })

  it('sends source to a dedicated structural worker and releases it on success', async () => {
    vi.stubGlobal('Worker', MockWorker)
    const pending = detectStructuralAsync('alice@example.com')
    const worker = MockWorker.instances[0]
    expect(worker.url.pathname).toContain('/structural.worker.ts')
    expect(worker.postMessage).toHaveBeenCalledWith({ text: 'alice@example.com' })
    const matches = [{ type: 'EMAIL', value: 'alice@example.com', start: 0, end: 17 }]
    worker.onmessage!({ data: { matches } })
    expect(await pending).toEqual(matches)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('cancels only the affected document and leaves a concurrent request usable', async () => {
    vi.stubGlobal('Worker', MockWorker)
    const controller = new AbortController()
    const first = detectStructuralAsync('first', controller.signal)
    const second = detectStructuralAsync('second')
    const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    expect(MockWorker.instances[0].terminate).toHaveBeenCalledOnce()
    expect(MockWorker.instances[1].terminate).not.toHaveBeenCalled()
    MockWorker.instances[1].onmessage!({ data: { matches: [] } })
    expect(await second).toEqual([])
  })

  it.each(['structured', 'crash', 'decode'])('rejects and releases the worker after a %s failure', async (kind) => {
    vi.stubGlobal('Worker', MockWorker)
    const pending = detectStructuralAsync('text')
    const rejected = expect(pending).rejects.toBeInstanceOf(Error)
    const worker = MockWorker.instances[0]
    if (kind === 'structured') worker.onmessage!({ data: { error: 'failed' } })
    else if (kind === 'crash') worker.onerror!({ message: 'crashed' })
    else worker.onmessageerror!()
    await rejected
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
