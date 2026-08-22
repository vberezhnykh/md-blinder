// Воркер PP-OCRv5. Инференс на wasm занимает секунды на страницу и намертво
// вешает поток, в котором работает, поэтому распознавание живёт отдельно от
// UI — как и NER (ner.worker.ts). Картинка передаётся как ImageBitmap, то
// есть без копирования пикселей.
import { PpocrEngine, type PpocrProgress } from '../lib/ocr/ppocr/engine'

export interface PpocrRequest {
  id: number
  bitmap: ImageBitmap
}

export type PpocrResponse =
  | { id: number; type: 'progress'; progress: PpocrProgress }
  | { id: number; type: 'done'; text: string }
  | { id: number; type: 'error'; message: string }

// Сессии onnxruntime переиспользуются между страницами: пересоздание графа на
// каждую страницу стоит дороже, чем сам инференс.
const engine = new PpocrEngine()

self.onmessage = async (event: MessageEvent<PpocrRequest>) => {
  const { id, bitmap } = event.data
  const post = (message: PpocrResponse) => self.postMessage(message)
  try {
    const { text } = await engine.recognize(bitmap, (progress) =>
      post({ id, type: 'progress', progress }),
    )
    post({ id, type: 'done', text })
  } catch (e) {
    post({ id, type: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally {
    bitmap.close()
  }
}
