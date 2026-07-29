import type { RawMatch } from './types'
import { stripInlineFormatting, remapMatches } from './stripFormatting'
import { NER_GRAY_ZONE_LOW } from './config'
import type { NerProgress } from '../../workers/nerProgress'

export type { NerProgress, NerStage } from '../../workers/nerProgress'

type WorkerOutbound =
  | ({ requestId: string; type: 'progress' } & NerProgress)
  | { requestId: string; type: 'done'; matches: RawMatch[] }
  | { requestId: string; type: 'error'; error: string }

interface PendingRequest {
  resolve: (matches: RawMatch[]) => void
  reject: (err: Error) => void
  onProgress?: (p: NerProgress) => void
}

let worker: Worker | null = null
const pending = new Map<string, PendingRequest>()

function handleMessage(e: MessageEvent<WorkerOutbound>) {
  const data = e.data
  const req = pending.get(data.requestId)
  if (!req) return

  if (data.type === 'progress') {
    const { requestId: _id, type: _type, ...progress } = data
    req.onProgress?.(progress)
    return
  }

  pending.delete(data.requestId)
  if (data.type === 'done') {
    req.resolve(data.matches)
    return
  }
  req.reject(new Error(data.error))
}

function failAllPending(err: Error) {
  for (const req of pending.values()) req.reject(err)
  pending.clear()
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../../workers/ner.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = handleMessage
    worker.onerror = (e: ErrorEvent) => {
      failAllPending(new Error(e.message || 'Не удалось выполнить поиск сущностей (NER) в фоновом потоке'))
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

export async function detectEntitiesNer(
  text: string,
  onProgress?: (p: NerProgress) => void,
): Promise<RawMatch[]> {
  const { plain, map } = stripInlineFormatting(text)
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    pending.set(requestId, {
      resolve: (matches) => resolve(remapMatches(matches, plain, map)),
      reject: (err) => {
        worker?.terminate()
        worker = null
        reject(err)
      },
      onProgress,
    })

    const w = getWorker()
    w.postMessage({
      requestId,
      text: plain,
      labels: ['person', 'company', 'address', 'registration number'],
      threshold: NER_GRAY_ZONE_LOW,
    })
  })
}
