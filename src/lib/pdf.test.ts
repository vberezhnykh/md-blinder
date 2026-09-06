import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPdf, pdfjsLib } from './pdf'

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('loadPdf loading task ownership', () => {
  it('destroys a failed loading task', async () => {
    const destroy = vi.fn(async () => {})
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF')), destroy } as never)
    await expect(loadPdf(new ArrayBuffer(4))).rejects.toThrow('Invalid PDF')
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('destroys a pending loading task when cancelled', async () => {
    const destroy = vi.fn(async () => {})
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({ promise: new Promise(() => {}), destroy } as never)
    const controller = new AbortController()
    const job = loadPdf(new ArrayBuffer(4), controller.signal)
    controller.abort()
    await expect(job).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('does not start loading when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(loadPdf(new ArrayBuffer(4), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(pdfjsLib.getDocument).not.toHaveBeenCalled()
  })
})
