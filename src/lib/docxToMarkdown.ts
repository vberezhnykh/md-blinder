import { htmlToMarkdown } from './htmlToMarkdown'

type WorkerResult =
  | { ok: true; html: string }
  | { ok: false; error: string }

export async function docxToMarkdown(arrayBuffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/docx.worker.ts', import.meta.url), {
      type: 'module',
    })

    const cleanup = () => {
      worker.terminate()
    }

    worker.onmessage = (e: MessageEvent<WorkerResult>) => {
      cleanup()
      const data = e.data
      if (data.ok) {
        resolve(htmlToMarkdown(data.html))
      } else {
        reject(new Error(data.error))
      }
    }

    worker.onerror = (e: ErrorEvent) => {
      cleanup()
      reject(new Error(e.message || 'Не удалось обработать .docx в фоновом потоке'))
    }

    worker.postMessage({ arrayBuffer }, [arrayBuffer])
  })
}
