import { useCallback, useEffect, useRef } from 'react'

export function useAnalysisJob() {
  const active = useRef<AbortController | null>(null)
  const cancel = useCallback(() => {
    active.current?.abort()
    active.current = null
  }, [])
  const start = useCallback(() => {
    cancel()
    const controller = new AbortController()
    active.current = controller
    return {
      signal: controller.signal,
      isCurrent: () => active.current === controller && !controller.signal.aborted,
      finish: () => { if (active.current === controller) active.current = null },
    }
  }, [cancel])
  useEffect(() => cancel, [cancel])
  return { start, cancel }
}
