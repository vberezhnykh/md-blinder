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
  text: string
  resolve: (matches: RawMatch[]) => void
  reject: (err: Error) => void
  onProgress?: (p: NerProgress) => void
  cleanup: () => void
}

let worker: Worker | null = null
let activeId: string | null = null
const pending = new Map<string, PendingRequest>()

function stopWorker() {
  const old = worker
  worker = null
  activeId = null
  old?.terminate()
}

export function disposeNerWorker(error: Error = new DOMException('Обработка отменена', 'AbortError')) {
  stopWorker()
  const requests = [...pending.values()]
  pending.clear()
  for (const req of requests) {
    req.cleanup()
    req.reject(error)
  }
}

function getWorker(): Worker {
  if (!worker) {
    const created = new Worker(new URL('../../workers/ner.worker.ts', import.meta.url), { type: 'module' })
    worker = created
    created.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      if (worker !== created) return
      const data = event.data
      const req = pending.get(data.requestId)
      if (!req || activeId !== data.requestId) return
      if (data.type === 'progress') {
        const { requestId: _id, type: _type, ...progress } = data
        req.onProgress?.(progress)
      } else if (data.type === 'error') {
        disposeNerWorker(new Error(data.error))
      } else {
        pending.delete(data.requestId)
        activeId = null
        req.cleanup()
        req.resolve(data.matches)
        pump()
      }
    }
    created.onerror = (event: ErrorEvent) => {
      if (worker === created) disposeNerWorker(new Error(event.message || 'Ошибка NER'))
    }
    created.onmessageerror = () => {
      if (worker === created) disposeNerWorker(new Error('Не удалось прочитать ответ NER'))
    }
  }
  return worker
}

function pump() {
  if (activeId || pending.size === 0) return
  const [id, req] = pending.entries().next().value!
  try {
    const current = getWorker()
    activeId = id
    current.postMessage({ requestId: id, text: req.text,
      labels: ['person', 'company', 'address', 'registration number'], threshold: NER_GRAY_ZONE_LOW })
  } catch (err) {
    disposeNerWorker(err instanceof Error ? err : new Error(String(err)))
  }
}

export async function detectEntitiesNer(
  text: string,
  onProgress?: (p: NerProgress) => void,
  signal?: AbortSignal,
): Promise<RawMatch[]> {
  signal?.throwIfAborted()
  const { plain, map, excluded } = stripInlineFormatting(text)
  if (!plain.trim()) return []
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const req = pending.get(requestId)
      if (!req) return
      pending.delete(requestId)
      req.cleanup()
      if (activeId === requestId) stopWorker()
      reject(signal?.reason ?? new DOMException('Обработка отменена', 'AbortError'))
      pump()
    }
    pending.set(requestId, {
      text: plain,
      resolve: (matches) => {
        try { resolve(remapMatches(matches, plain, map, excluded)) } catch (err) { reject(err) }
      },
      reject, onProgress,
      cleanup: () => signal?.removeEventListener('abort', onAbort),
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    else pump()
  })
}
