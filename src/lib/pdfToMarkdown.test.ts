// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { createWorker, type Worker } from 'tesseract.js'
import { loadPdf } from './pdf'
import { pdfToMarkdown } from './pdfToMarkdown'
import { ocrPdfToMarkdown } from './ocrPdf'

vi.mock('tesseract.js', () => ({ createWorker: vi.fn() }))
vi.mock('./pdf', () => ({
  loadPdf: vi.fn(),
  pdfjsLib: {
    OPS: { save: 10, restore: 11, transform: 12, paintImageXObject: 85 },
    Util: {
      transform: (a: number[], b: number[]) => [
        a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
      ],
    },
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makePage(text = '', y = 400) {
  return {
    view: [0, 0, 600, 800],
    getTextContent: vi.fn(async () => ({ items: text ? [{
      str: text, transform: [12, 0, 0, 12, 20, y], width: 500, height: 12, fontName: 'F1', hasEOL: true,
    }] : [] })),
    getOperatorList: vi.fn(async () => ({ fnArray: [] as number[], argsArray: [] as unknown[][] })),
    getViewport: vi.fn(() => ({ width: 1200, height: 1600 })),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    cleanup: vi.fn(),
  }
}

function openPdf(pages: ReturnType<typeof makePage>[]) {
  const pdf = {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
    loadingTask: { destroy: vi.fn(async () => {}) },
  }
  vi.mocked(loadPdf).mockResolvedValue(pdf as unknown as PDFDocumentProxy)
  return pdf
}

const longText = 'Synthetic document text with enough body characters to prove that its text layer contains useful searchable content.'
let ocrWorker: { recognize: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }
let ocrLogger: ((message: { status: string; progress: number }) => void) | undefined

beforeEach(() => {
  vi.clearAllMocks()
  ocrLogger = undefined
  ocrWorker = {
    recognize: vi.fn(async () => {
      ocrLogger?.({ status: 'recognizing text', progress: 1 })
      return { data: { text: 'Recognized content\n50000\n40702810900000012345' } }
    }),
    terminate: vi.fn(async () => {}),
  }
  vi.mocked(createWorker).mockImplementation(async (_langs, _oem, options) => {
    ocrLogger = options?.logger
    return ocrWorker as unknown as Worker
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
})
afterEach(() => vi.restoreAllMocks())

describe('PDF/OCR document lifecycle', () => {
  it('opens a mixed six-page document once and starts one OCR worker for all three scans', async () => {
    const pages = [makePage(`Alpha. ${longText}`), makePage(), makePage(`Beta. ${longText}`), makePage(), makePage(`Gamma. ${longText}`), makePage()]
    const pdf = openPdf(pages)
    const progress = vi.fn()
    const source = new ArrayBuffer(12)
    const { markdown } = await pdfToMarkdown(source, undefined, progress)
    expect(loadPdf).toHaveBeenCalledExactlyOnceWith(source, undefined)
    expect(createWorker).toHaveBeenCalledOnce()
    expect(ocrWorker.recognize).toHaveBeenCalledTimes(3)
    expect(ocrWorker.terminate).toHaveBeenCalledOnce()
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
    expect(progress.mock.calls.map(([p]) => [p.page, p.total])).toEqual([[1, 3], [2, 3], [3, 3]])
    expect(markdown.indexOf('Alpha.')).toBeLessThan(markdown.indexOf('50000'))
    expect(markdown.indexOf('50000')).toBeLessThan(markdown.indexOf('Beta.'))
    expect(markdown.indexOf('Beta.')).toBeLessThan(markdown.indexOf('Gamma.'))
    expect(markdown.match(/40702810900000012345/g)).toHaveLength(3)
    for (const [canvas] of ocrWorker.recognize.mock.calls) {
      expect(canvas.width).toBe(0)
      expect(canvas.height).toBe(0)
    }
  })

  it('does not initialize OCR for text-only input and still closes the PDF', async () => {
    const pdf = openPdf([makePage(longText)])
    await expect(pdfToMarkdown(new ArrayBuffer(4))).resolves.toEqual({ markdown: longText })
    expect(createWorker).not.toHaveBeenCalled()
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
  })

  it('forceOcr recognizes every page without reading its text layer', async () => {
    const pages = [makePage(longText), makePage(longText)]
    const pdf = openPdf(pages)
    const { markdown } = await pdfToMarkdown(new ArrayBuffer(4), undefined, undefined, { forceOcr: true })
    expect(markdown).toContain('Recognized content')
    expect(pages.every((page) => page.getTextContent.mock.calls.length === 0)).toBe(true)
    expect(ocrWorker.recognize).toHaveBeenCalledTimes(2)
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
  })

  it('recognizes a full-page scan even when its text header passes the character threshold', async () => {
    const page = makePage('Synthetic header', 770)
    page.getOperatorList.mockResolvedValue({ fnArray: [10, 12, 85, 11], argsArray: [[], [600, 0, 0, 800, 0, 0], ['image'], []] })
    openPdf([page])
    expect((await pdfToMarkdown(new ArrayBuffer(4))).markdown).toContain('Recognized content')
    expect(ocrWorker.recognize).toHaveBeenCalledOnce()
  })

  it('releases the PDF and page when text extraction fails', async () => {
    const page = makePage()
    page.getTextContent.mockRejectedValueOnce(new Error('Broken text layer'))
    const pdf = openPdf([page])
    await expect(pdfToMarkdown(new ArrayBuffer(4))).rejects.toThrow('Broken text layer')
    expect(page.cleanup).toHaveBeenCalledOnce()
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
  })

  it('closes the document when OCR initialization rejects', async () => {
    const pdf = openPdf([makePage()])
    vi.mocked(createWorker).mockRejectedValueOnce(new Error('Model unavailable'))
    await expect(pdfToMarkdown(new ArrayBuffer(4))).rejects.toThrow('Model unavailable')
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
  })

  it('releases canvas, worker and PDF when recognition rejects', async () => {
    const page = makePage()
    const pdf = openPdf([page])
    ocrWorker.recognize.mockRejectedValueOnce(new Error('Recognition failed'))
    await expect(pdfToMarkdown(new ArrayBuffer(4))).rejects.toThrow('Recognition failed')
    expect(ocrWorker.terminate).toHaveBeenCalledOnce()
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
    const canvas = ocrWorker.recognize.mock.calls[0][0]
    expect([canvas.width, canvas.height]).toEqual([0, 0])
    expect(page.cleanup).toHaveBeenCalledTimes(2)
  })

  it('releases the canvas, worker and PDF when rendering rejects', async () => {
    const page = makePage()
    page.render.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('Render failed')), cancel: vi.fn() }))
    const pdf = openPdf([page])
    await expect(pdfToMarkdown(new ArrayBuffer(4))).rejects.toThrow('Render failed')
    expect(ocrWorker.terminate).toHaveBeenCalledOnce()
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
    expect(ocrWorker.recognize).not.toHaveBeenCalled()
    expect(page.cleanup).toHaveBeenCalledTimes(2)
  })

  it('cancels pending rendering and frees every owned resource', async () => {
    const page = makePage()
    const rendering = deferred<void>()
    const cancel = vi.fn()
    page.render.mockReturnValueOnce({ promise: rendering.promise, cancel })
    const pdf = openPdf([page])
    const controller = new AbortController()
    const job = pdfToMarkdown(new ArrayBuffer(4), undefined, undefined, { signal: controller.signal })
    const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(page.render).toHaveBeenCalled())
    controller.abort()
    await rejected
    expect(cancel).toHaveBeenCalledOnce()
    expect(ocrWorker.terminate).toHaveBeenCalledOnce()
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
    expect(ocrWorker.recognize).not.toHaveBeenCalled()
  })

  it('terminates a pending recognition immediately when cancelled', async () => {
    const pdf = openPdf([makePage()])
    ocrWorker.recognize.mockReturnValueOnce(new Promise(() => {}))
    const controller = new AbortController()
    const job = pdfToMarkdown(new ArrayBuffer(4), undefined, undefined, { signal: controller.signal })
    const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(ocrWorker.recognize).toHaveBeenCalled())
    controller.abort()
    await rejected
    expect(ocrWorker.terminate).toHaveBeenCalledOnce()
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
  })

  it('terminates late OCR initialization after an earlier cancellation', async () => {
    const pdf = openPdf([makePage()])
    const initialization = deferred<Worker>()
    vi.mocked(createWorker).mockReturnValueOnce(initialization.promise)
    const controller = new AbortController()
    const job = pdfToMarkdown(new ArrayBuffer(4), undefined, undefined, { signal: controller.signal })
    const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(createWorker).toHaveBeenCalled())
    controller.abort()
    await rejected
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
    initialization.resolve(ocrWorker as unknown as Worker)
    await vi.waitFor(() => expect(ocrWorker.terminate).toHaveBeenCalledOnce())
    expect(ocrWorker.recognize).not.toHaveBeenCalled()
  })

  it('standalone OCR closes its owned PDF and preserves numeric content', async () => {
    const pdf = openPdf([makePage()])
    const markdown = await ocrPdfToMarkdown(new ArrayBuffer(4), [1])
    expect(markdown).toContain('50000')
    expect(markdown).toContain('40702810900000012345')
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce()
  })
})
