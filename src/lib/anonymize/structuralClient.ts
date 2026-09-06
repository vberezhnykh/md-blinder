import type { RawMatch } from './types'

/** Isolate expensive document scans; cancellation terminates only this request. */
export async function detectStructuralAsync(text: string, signal?: AbortSignal): Promise<RawMatch[]> {
  signal?.throwIfAborted()
  // Unit tests and non-browser consumers can still use the exact synchronous core.
  if (typeof Worker === 'undefined') {
    const { detectStructural } = await import('./regexDetectors')
    signal?.throwIfAborted()
    return detectStructural(text)
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/structural.worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = (error?: Error, matches: RawMatch[] = []) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error)
      else resolve(matches)
    }
    const abort = () => finish(signal?.reason ?? new DOMException('Cancelled', 'AbortError'))
    worker.onmessage = (event: MessageEvent<{ matches?: RawMatch[]; error?: string }>) => {
      if (event.data.error) finish(new Error(event.data.error))
      else if (Array.isArray(event.data.matches)) finish(undefined, event.data.matches)
      else finish(new Error('Некорректный ответ структурного анализа'))
    }
    worker.onerror = (event) => finish(new Error(event.message || 'Ошибка структурного анализа'))
    worker.onmessageerror = () => finish(new Error('Не удалось прочитать результат структурного анализа'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try { worker.postMessage({ text }) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
  })
}
