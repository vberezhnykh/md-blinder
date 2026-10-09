import './mapUpsert'
import * as pdfjsLib from 'pdfjs-dist'
import { withAbort } from './conversionAbort'

// Воркер pdf.js запускается через собственную точку входа, чтобы до кода
// pdf.js в нем были подключены полифилы. Создается при первой загрузке PDF и
// дальше переиспользуется.
function ensurePdfWorker() {
  if (pdfjsLib.GlobalWorkerOptions.workerPort || typeof Worker === 'undefined') return
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
    new URL('../workers/pdf.worker.ts', import.meta.url),
    { type: 'module' },
  )
}

export { pdfjsLib }

export async function loadPdf(data: ArrayBuffer, signal?: AbortSignal) {
  signal?.throwIfAborted()
  ensurePdfWorker()
  const task = pdfjsLib.getDocument({ data })
  let destroyed: Promise<void> | undefined
  const destroy = () => { destroyed ??= task.destroy(); void destroyed.catch(() => {}) }
  try {
    return await withAbort(task.promise, signal, destroy)
  } catch (error) {
    destroy()
    await destroyed?.catch(() => {})
    throw error
  }
}
