import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docxToMarkdown } from './docxToMarkdown'
import { htmlToMarkdown } from './htmlToMarkdown'

vi.mock('./htmlToMarkdown', () => ({ htmlToMarkdown: vi.fn((html: string) => `converted:${html}`) }))

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { MockWorker.instances.push(this) }
}

beforeEach(() => {
  vi.clearAllMocks()
  MockWorker.instances = []
  vi.stubGlobal('Worker', MockWorker)
})
afterEach(() => vi.unstubAllGlobals())

describe('docxToMarkdown lifecycle', () => {
  it('terminates its worker and converts a successful result', async () => {
    const buffer = new ArrayBuffer(4)
    const converted = docxToMarkdown(buffer)
    const worker = MockWorker.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith({ arrayBuffer: buffer }, [buffer])
    worker.onmessage?.({ data: { ok: true, html: 'Document' } })
    await expect(converted).resolves.toBe('converted:Document')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('rejects rather than hanging when HTML conversion throws', async () => {
    vi.mocked(htmlToMarkdown).mockImplementationOnce(() => { throw new Error('Invalid HTML') })
    const converted = docxToMarkdown(new ArrayBuffer(4))
    const worker = MockWorker.instances[0]
    worker.onmessage?.({ data: { ok: true, html: 'bad' } })
    await expect(converted).rejects.toThrow('Invalid HTML')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('terminates and rejects a worker error', async () => {
    const converted = docxToMarkdown(new ArrayBuffer(4))
    const worker = MockWorker.instances[0]
    worker.onerror?.({ message: 'Worker crashed' })
    await expect(converted).rejects.toThrow('Worker crashed')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('terminates immediately on cancellation and ignores a late result', async () => {
    const controller = new AbortController()
    const converted = docxToMarkdown(new ArrayBuffer(4), { signal: controller.signal })
    const worker = MockWorker.instances[0]
    controller.abort()
    await expect(converted).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.onmessage).toBeNull()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(htmlToMarkdown).not.toHaveBeenCalled()
  })

  it('does not construct a worker when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(docxToMarkdown(new ArrayBuffer(4), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(MockWorker.instances).toHaveLength(0)
  })

  it('removes abort handlers after completion', async () => {
    const controller = new AbortController()
    const converted = docxToMarkdown(new ArrayBuffer(4), { signal: controller.signal })
    const worker = MockWorker.instances[0]
    worker.onmessage?.({ data: { ok: false, error: 'Invalid DOCX' } })
    await expect(converted).rejects.toThrow('Invalid DOCX')
    controller.abort()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
