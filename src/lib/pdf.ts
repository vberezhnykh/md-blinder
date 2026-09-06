import * as pdfjsLib from 'pdfjs-dist'
import { withAbort } from './conversionAbort'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export { pdfjsLib }

export async function loadPdf(data: ArrayBuffer, signal?: AbortSignal) {
  signal?.throwIfAborted()
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
