// Точка входа для scripts/bench-ocr.mjs: оба движка с одинаковой сигнатурой,
// чтобы бенчмарк не дублировал у себя логику вызова, а мерил ровно то, что
// потом крутится в приложении. В прод-бандл не попадает — импортируется
// только динамически из dev-сервера.
import { createWorker } from 'tesseract.js'
import { OCR_LANGS } from '../ocrLangs'
import { PpocrEngine, type PpocrOptions, type PpocrPaths } from './ppocr/engine'

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
    const { data } = await worker.recognize(canvas)
    return { text: data.text.trim(), ms: performance.now() - started }
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
