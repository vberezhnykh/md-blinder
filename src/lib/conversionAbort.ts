/** Cancel a waiting conversion without leaving an abort listener behind. */
export function withAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  cancel?: () => void,
): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      cancel?.()
      reject(signal.reason ?? new DOMException('Обработка отменена', 'AbortError'))
    }
    const cleanup = () => signal.removeEventListener('abort', aborted)
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(
      (result) => { cleanup(); resolve(result) },
      (error: unknown) => { cleanup(); reject(error) },
    )
    if (signal.aborted) { cleanup(); aborted() }
  })
}
