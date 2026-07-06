import type { RawMatch } from './types'
import { stripInlineFormatting, remapMatches } from './stripFormatting'

export interface NerProgress {
  stage: 'load' | 'detect'
  pct?: number
  chunk?: number
  chunks?: number
}

type WorkerOutbound =
  | { type: 'progress'; stage: 'load'; pct: number }
  | { type: 'progress'; stage: 'detect'; chunk: number; chunks: number }
  | { type: 'done'; matches: RawMatch[] }
  | { type: 'error'; error: string }

export async function detectEntitiesNer(
  text: string,
  onProgress?: (p: NerProgress) => void,
): Promise<RawMatch[]> {
  const { plain, map } = stripInlineFormatting(text)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/ner.worker.ts', import.meta.url), {
      type: 'module',
    })

    const cleanup = () => {
      worker.terminate()
    }

    worker.onmessage = (e: MessageEvent<WorkerOutbound>) => {
      const data = e.data
      if (data.type === 'progress') {
        if (data.stage === 'load') {
          onProgress?.({ stage: 'load', pct: data.pct })
        } else {
          onProgress?.({ stage: 'detect', chunk: data.chunk, chunks: data.chunks })
        }
        return
      }
      if (data.type === 'done') {
        cleanup()
        resolve(remapMatches(data.matches, plain, map))
        return
      }
      cleanup()
      reject(new Error(data.error))
    }

    worker.onerror = (e: ErrorEvent) => {
      cleanup()
      reject(new Error(e.message || 'Не удалось выполнить поиск сущностей (NER) в фоновом потоке'))
    }

    worker.postMessage({ text: plain, labels: ['person', 'company', 'address', 'registration number'], threshold: 0.3 })
  })
}
