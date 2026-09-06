import { htmlToMarkdown } from './htmlToMarkdown'

type WorkerResult =
  | { ok: true; html: string }
  | { ok: false; error: string }

export async function docxToMarkdown(
  arrayBuffer: ArrayBuffer,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const { signal } = options
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/docx.worker.ts', import.meta.url), {
      type: 'module',
    })

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    const onAbort = () => {
      cleanup()
      reject(signal?.reason ?? new DOMException('Обработка отменена', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (e: MessageEvent<WorkerResult>) => {
      cleanup()
      try {
        const data = e.data
        if (data.ok) resolve(htmlToMarkdown(data.html))
        else reject(new Error(data.error))
      } catch (error) {
        reject(error)
      }
    }

    worker.onerror = (e: ErrorEvent) => {
      cleanup()
      reject(new Error(e.message || 'Не удалось обработать .docx в фоновом потоке'))
    }

    try {
      worker.postMessage({ arrayBuffer }, [arrayBuffer])
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
