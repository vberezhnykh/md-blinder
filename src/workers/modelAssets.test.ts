import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadBinaryAsset, loadTokenizerJson, MODEL_REVISION, MODEL_CACHE } from './modelAssets'

const fixture = new Uint8Array([1, 2, 3, 4])
let entries: Map<string, Uint8Array>
let cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }

beforeEach(() => {
  entries = new Map()
  cache = {
    match: vi.fn(async (url: string) => entries.has(url) ? new Response(entries.get(url)!) : undefined),
    put: vi.fn(async (url: string, response: Response) => { entries.set(url, new Uint8Array(await response.arrayBuffer())) }),
    delete: vi.fn(async (url: string) => entries.delete(url)),
  }
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(fixture)))
})
afterEach(() => vi.unstubAllGlobals())

describe('pinned NER asset loader', () => {
  it('copies streamed data into its destination and caches it for an offline second load', async () => {
    const progress = vi.fn()
    const first = await loadBinaryAsset('https://fixture.test/model', 4, progress)
    expect(first).toEqual({ bytes: fixture, cached: false })
    expect(progress).toHaveBeenLastCalledWith(100, false)
    expect(cache.put).toHaveBeenCalledOnce()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    const second = await loadBinaryAsset('https://fixture.test/model', 4, progress)
    expect(second).toEqual({ bytes: fixture, cached: true })
    expect(fetch).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenLastCalledWith(100, true)
  })

  it('works when cache storage or quota is unavailable', async () => {
    cache.put.mockRejectedValueOnce(new Error('quota'))
    await expect(loadBinaryAsset('https://fixture.test/model', 4, vi.fn())).resolves.toEqual({ bytes: fixture, cached: false })
    vi.stubGlobal('caches', { open: vi.fn(async () => { throw new Error('storage disabled') }) })
    await expect(loadBinaryAsset('https://fixture.test/model', 4, vi.fn())).resolves.toEqual({ bytes: fixture, cached: false })
  })

  it('discards a corrupted cache entry before downloading again', async () => {
    entries.set('https://fixture.test/model', new Uint8Array([0]))
    expect((await loadBinaryAsset('https://fixture.test/model', 4, vi.fn())).bytes).toEqual(fixture)
    expect(cache.delete).toHaveBeenCalledExactlyOnceWith('https://fixture.test/model')
  })

  it('recovers when reading the body of a cached model rejects', async () => {
    cache.match.mockResolvedValueOnce({ arrayBuffer: async () => { throw new Error('Unreadable cache entry') } })
    expect((await loadBinaryAsset('https://fixture.test/model', 4, vi.fn())).bytes).toEqual(fixture)
    expect(cache.delete).toHaveBeenCalledWith('https://fixture.test/model')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects and removes truncated network data from cache', async () => {
    await expect(loadBinaryAsset('https://fixture.test/model', 5, vi.fn())).rejects.toThrow('прервалась')
    expect(entries.has('https://fixture.test/model')).toBe(false)
  })

  it('rejects and removes oversized network data from cache', async () => {
    await expect(loadBinaryAsset('https://fixture.test/model', 3, vi.fn())).rejects.toThrow('Неверный размер')
    expect(entries.has('https://fixture.test/model')).toBe(false)
  })

  it('aborts an oversized response even if its upstream stream never closes', async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>
    vi.mocked(fetch).mockImplementationOnce(async (_url, options) => {
      const stream = new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; controller.enqueue(new Uint8Array(5)) } })
      options?.signal?.addEventListener('abort', () => upstream.error(new DOMException('Cancelled', 'AbortError')))
      return new Response(stream)
    })
    await expect(loadBinaryAsset('https://fixture.test/model', 4, vi.fn())).rejects.toThrow('Неверный размер')
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true)
    await vi.waitFor(() => expect(entries.has('https://fixture.test/model')).toBe(false))
  })

  it('replaces a malformed cached tokenizer and never caches an invalid response', async () => {
    const url = `https://huggingface.co/onnx-community/gliner_multi-v2.1/resolve/${MODEL_REVISION}/tokenizer_config.json`
    entries.set(url, new TextEncoder().encode('{broken'))
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ sep_token: '[SEP]' }))
    expect(await loadTokenizerJson('tokenizer_config.json')).toEqual({ sep_token: '[SEP]' })
    expect(cache.delete).toHaveBeenCalledWith(url)
    entries.delete(url)
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{broken'))
    await expect(loadTokenizerJson('tokenizer_config.json')).rejects.toThrow()
    expect(entries.has(url)).toBe(false)
  })

  it('requests tokenizer configuration from the same immutable revision and cache', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ sep_token: '[SEP]' }))
    expect(await loadTokenizerJson('tokenizer_config.json')).toEqual({ sep_token: '[SEP]' })
    expect(fetch).toHaveBeenCalledWith(`https://huggingface.co/onnx-community/gliner_multi-v2.1/resolve/${MODEL_REVISION}/tokenizer_config.json`)
    expect(caches.open).toHaveBeenCalledWith(MODEL_CACHE)
  })
})
