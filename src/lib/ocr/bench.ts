// Точка входа для scripts/bench-ocr.mjs: оба движка с одинаковой сигнатурой,
// чтобы бенчмарк не дублировал у себя логику вызова, а мерил ровно то, что
// потом крутится в приложении. В прод-бандл не попадает — импортируется
// только динамически из dev-сервера.
import { createWorker } from 'tesseract.js'
import { OCR_LANGS } from '../ocrLangs'
import { PpocrEngine, type PpocrOptions, type PpocrPaths } from './ppocr/engine'
import { recognizePageWithTesseract } from './tesseract'

export interface BenchResult {
  text: string
  ms: number
}

/** Локальные ассеты Tesseract (см. fetch-ppocr-models.mjs --bench). */
export interface TesseractPaths {
  workerPath: string
  corePath: string
  langPath: string
}

export async function benchTesseract(
  canvas: HTMLCanvasElement,
  paths: TesseractPaths,
): Promise<BenchResult> {
  const worker = await createWorker([...OCR_LANGS], 1, {
    workerPath: paths.workerPath,
    corePath: paths.corePath,
    langPath: paths.langPath,
    gzip: true,
  })
  try {
    const started = performance.now()
    const text = await recognizePageWithTesseract(worker, canvas)
    return { text: text.trim(), ms: performance.now() - started }
  } finally {
    await worker.terminate()
  }
}

export async function benchPpocr(
  canvas: HTMLCanvasElement,
  paths?: Partial<PpocrPaths>,
  options?: PpocrOptions,
): Promise<BenchResult> {
  const engine = new PpocrEngine(
    {
      det: paths?.det ?? '/models/ppocr/det.onnx',
      rec: paths?.rec ?? '/models/ppocr/rec.onnx',
      dict: paths?.dict ?? '/models/ppocr/dict.txt',
      wasmDir: paths?.wasmDir ?? '/models/ort/',
    },
    options ?? {},
  )
  // Загрузка моделей меряется отдельно: в приложении она разовая, а в
  // сравнении по страницам интересно только время распознавания.
  await engine.load()
  const started = performance.now()
  const { text } = await engine.recognize(canvas)
  return { text: text.trim(), ms: performance.now() - started }
}

/** Геометрия рамок детектора — для отладки постобработки в bench-скриптах. */
export async function debugPpocrBoxes(
  canvas: HTMLCanvasElement,
): Promise<{ text: string; left: number; top: number; width: number; height: number }[]> {
  const engine = new PpocrEngine()
  const { boxes } = await engine.recognize(canvas)
  return boxes.map((b) => {
    const xs = b.points.map((p) => p[0])
    const ys = b.points.map((p) => p[1])
    return {
      text: b.text,
      left: Math.round(Math.min(...xs)),
      top: Math.round(Math.min(...ys)),
      width: Math.round(Math.max(...xs) - Math.min(...xs)),
      height: Math.round(Math.max(...ys) - Math.min(...ys)),
    }
  })
}
