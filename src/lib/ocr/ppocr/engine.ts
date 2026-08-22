// PP-OCRv5 в браузере на onnxruntime-web: детектор (DB) + распознаватель
// (CRNN/CTC, восточнославянский словарь). Веса кладёт scripts/fetch-ppocr-models.mjs
// в public/models/ppocr, wasm-рантайм — в public/models/ort, всё локально:
// изображение страницы никуда не уходит, как и в остальном конвейере.
import * as ort from 'onnxruntime-web'
import { boxesFromProbMap, type DetBox } from './detPostprocess'
import { buildCharset, ctcGreedyDecode } from './ctcDecode'
import { boxesToText, type RecognizedBox } from './lines'
import type { Point } from './geometry'

export interface PpocrPaths {
  det: string
  rec: string
  dict: string
  wasmDir: string
}

export interface PpocrOptions {
  /** Длинная сторона, к которой ужимается страница перед детектором. */
  detLimit?: number
}

export const DEFAULT_PATHS: PpocrPaths = {
  det: '/models/ppocr/det.onnx',
  rec: '/models/ppocr/rec.onnx',
  dict: '/models/ppocr/dict.txt',
  wasmDir: '/models/ort/',
}

// Длинная сторона, к которой ужимается страница перед детектором. 960 —
// дефолт PaddleOCR; на A4 в 200 dpi это примерно 1.7 px на кегль 10, чего
// детектору хватает, а время инференса на CPU держится в пределах секунды.
const DEFAULT_DET_LIMIT = 960
// Высота строки, на которую обучен распознаватель PP-OCRv5.
const REC_HEIGHT = 48
// Распознаватель свёрточный по ширине, поэтому кроп тянется на своё реальное
// соотношение сторон. Ограничение нужно только как предохранитель от рамки во
// всю страницу: строка договора на 1240 px даёт кроп ~1400 px, и если её
// ужать до пары сотен пикселей (как делает дефолт PaddleOCR для коротких
// китайских строк), символы сливаются и половина текста теряется.
const REC_MAX_WIDTH = 2400
// Кропы гоняются пачками: одиночные вызовы съедают больше времени на оверхед
// ORT, чем на саму матричную математику. Пачка добивается до самого широкого
// кропа в ней, поэтому строки предварительно сортируются по ширине.
const REC_BATCH = 8

const DET_MEAN = [0.485, 0.456, 0.406]
const DET_STD = [0.229, 0.224, 0.225]

export interface PpocrProgress {
  stage: 'load' | 'detect' | 'recognize'
  done?: number
  total?: number
}

export interface PpocrResult {
  text: string
  boxes: RecognizedBox[]
}

/** Источник изображения: главный поток отдаёт canvas, воркер — ImageBitmap. */
export type ImageSource = HTMLCanvasElement | OffscreenCanvas | ImageBitmap

interface Canvas2D {
  canvas: HTMLCanvasElement | OffscreenCanvas
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
}

function createCanvas(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('OffscreenCanvas: не удалось получить 2D-контекст')
    return { canvas, ctx }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas: не удалось получить 2D-контекст')
  return { canvas, ctx }
}

/**
 * Модели PP-OCR не лежат в репозитории и не входят в прод-сборку: их кладёт
 * scripts/fetch-ppocr-models.mjs. Пустой каталог — самая вероятная причина
 * поломки движка, поэтому 404 превращается в понятную инструкцию.
 */
async function fetchAsset(url: string): Promise<Response> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `модель не найдена (${url}, HTTP ${response.status}). ` +
        'Выполните: node scripts/fetch-ppocr-models.mjs',
    )
  }
  return response
}

function sourceSize(source: ImageSource): { width: number; height: number } {
  return { width: source.width, height: source.height }
}

/** Ширина кропа строки при приведении её к высоте REC_HEIGHT. */
function cropWidth(points: Point[]): number {
  const [p0, p1, , p3] = points
  const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
  const h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
  return Math.max(4, Math.min(REC_MAX_WIDTH, Math.round((w / Math.max(h, 1)) * REC_HEIGHT)))
}

export class PpocrEngine {
  private det: ort.InferenceSession | null = null
  private rec: ort.InferenceSession | null = null
  private charset: string[] = []
  private loading: Promise<void> | null = null

  private readonly paths: PpocrPaths
  private readonly detLimit: number

  constructor(paths: PpocrPaths = DEFAULT_PATHS, options: PpocrOptions = {}) {
    this.paths = paths
    this.detLimit = options.detLimit ?? DEFAULT_DET_LIMIT
  }

  async load(onProgress?: (p: PpocrProgress) => void): Promise<void> {
    if (this.det && this.rec) return
    if (!this.loading) {
      this.loading = (async () => {
        onProgress?.({ stage: 'load' })
        ort.env.wasm.wasmPaths = this.paths.wasmDir
        // Больше потоков, чем ядер, на wasm только добавляет переключений
        // контекста; SharedArrayBuffer может быть недоступен без COOP/COEP,
        // тогда ORT сам откатится на один поток.
        ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1)
        const opts: ort.InferenceSession.SessionOptions = {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        }
        // Веса качаются вручную, а не средствами ORT: каталог public/models не
        // лежит в репозитории (scripts/fetch-ppocr-models.mjs), и без внятного
        // сообщения о 404 пользователь увидел бы только ошибку разбора protobuf.
        const [detBytes, recBytes, dictText] = await Promise.all([
          fetchAsset(this.paths.det).then((r) => r.arrayBuffer()),
          fetchAsset(this.paths.rec).then((r) => r.arrayBuffer()),
          fetchAsset(this.paths.dict).then((r) => r.text()),
        ])
        const [det, rec] = await Promise.all([
          ort.InferenceSession.create(new Uint8Array(detBytes), opts),
          ort.InferenceSession.create(new Uint8Array(recBytes), opts),
        ])
        this.det = det
        this.rec = rec
        // Число классов известно только после первого прогона, поэтому
        // словарь достраиваем лениво — здесь запоминаем сырой текст.
        this.charset = []
        this.dictText = dictText
      })()
    }
    await this.loading
  }

  private dictText = ''

  async recognize(
    source: ImageSource,
    onProgress?: (p: PpocrProgress) => void,
  ): Promise<PpocrResult> {
    await this.load(onProgress)
    const det = this.det!
    const rec = this.rec!

    onProgress?.({ stage: 'detect' })
    const boxes = await this.detect(source, det)

    // Сортировка по ширине кропа: в пачке из короткого «№ 5» и строки во всю
    // страницу узкие кропы добивались бы белым на 90% площади, и время
    // инференса уходило бы в пустоту.
    const order = boxes
      .map((box, index) => ({ index, width: cropWidth(box.points) }))
      .sort((a, b) => a.width - b.width)

    const recognized: RecognizedBox[] = []
    for (let i = 0; i < order.length; i += REC_BATCH) {
      const chunk = order.slice(i, i + REC_BATCH).map((o) => boxes[o.index])
      const texts = await this.recognizeBatch(source, chunk, rec)
      for (let j = 0; j < chunk.length; j++) {
        if (!texts[j].text.trim()) continue
        recognized.push({
          points: chunk[j].points,
          text: texts[j].text,
          confidence: texts[j].confidence,
        })
      }
      onProgress?.({
        stage: 'recognize',
        done: Math.min(i + REC_BATCH, order.length),
        total: order.length,
      })
    }

    return { text: boxesToText(recognized), boxes: recognized }
  }

  private async detect(source: ImageSource, det: ort.InferenceSession): Promise<DetBox[]> {
    const { width, height } = sourceSize(source)
    const scale = Math.min(this.detLimit / Math.max(width, height), 1)
    // Сеть свёрточная с пятью понижениями разрешения — стороны обязаны быть
    // кратны 32, иначе выход не сойдётся по размеру со входом.
    const netW = Math.max(32, Math.round((width * scale) / 32) * 32)
    const netH = Math.max(32, Math.round((height * scale) / 32) * 32)

    const { ctx } = createCanvas(netW, netH)
    ctx.drawImage(source as CanvasImageSource, 0, 0, netW, netH)
    const { data } = ctx.getImageData(0, 0, netW, netH)

    const input = new Float32Array(3 * netW * netH)
    const plane = netW * netH
    for (let i = 0; i < plane; i++) {
      input[i] = (data[i * 4] / 255 - DET_MEAN[0]) / DET_STD[0]
      input[plane + i] = (data[i * 4 + 1] / 255 - DET_MEAN[1]) / DET_STD[1]
      input[2 * plane + i] = (data[i * 4 + 2] / 255 - DET_MEAN[2]) / DET_STD[2]
    }

    const output = await det.run({
      [det.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, netH, netW]),
    })
    const probTensor = output[det.outputNames[0]]
    const prob = probTensor.data as Float32Array
    const [, , outH, outW] = probTensor.dims as number[]

    return boxesFromProbMap(prob, outW, outH, {
      scaleX: width / outW,
      scaleY: height / outH,
    })
  }

  /**
   * Вырезает строку по четырёхугольнику и приводит к высоте 48. Аффинного
   * преобразования достаточно: рамки приходят из minAreaRect, то есть это
   * настоящие прямоугольники, просто повёрнутые.
   */
  private cropLine(source: ImageSource, points: Point[]): { canvas: Canvas2D; width: number } {
    const [p0, p1, , p3] = points
    const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    const h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
    const targetW = cropWidth(points)

    const c = createCanvas(targetW, REC_HEIGHT)
    c.ctx.fillStyle = '#fff'
    c.ctx.fillRect(0, 0, targetW, REC_HEIGHT)
    // Матрица переводит систему кропа в систему исходника: единичный вектор
    // по X кропа — это сторона p0->p1, по Y — сторона p0->p3.
    const ex = [(p1[0] - p0[0]) / w, (p1[1] - p0[1]) / w]
    const ey = [(p3[0] - p0[0]) / h, (p3[1] - p0[1]) / h]
    const sx = w / targetW
    const sy = h / REC_HEIGHT
    // Инвертируем: рисуем исходник в координатах кропа.
    const a = ex[0] * sx
    const b = ex[1] * sx
    const cc = ey[0] * sy
    const d = ey[1] * sy
    const detM = a * d - b * cc
    if (Math.abs(detM) < 1e-9) return { canvas: c, width: targetW }
    const ia = d / detM
    const ib = -b / detM
    const ic = -cc / detM
    const id = a / detM
    const ie = -(ia * p0[0] + ic * p0[1])
    const iff = -(ib * p0[0] + id * p0[1])
    c.ctx.setTransform(ia, ib, ic, id, ie, iff)
    c.ctx.drawImage(source as CanvasImageSource, 0, 0)
    c.ctx.setTransform(1, 0, 0, 1, 0, 0)
    return { canvas: c, width: targetW }
  }

  private async recognizeBatch(
    source: ImageSource,
    boxes: DetBox[],
    rec: ort.InferenceSession,
  ): Promise<{ text: string; confidence: number }[]> {
    const crops = boxes.map((b) => this.cropLine(source, b.points))
    const batchW = Math.max(...crops.map((c) => c.width))
    const n = crops.length
    const input = new Float32Array(n * 3 * REC_HEIGHT * batchW)

    for (let i = 0; i < n; i++) {
      const { canvas, width } = crops[i]
      const ctx = canvas.ctx
      const img = ctx.getImageData(0, 0, width, REC_HEIGHT).data
      const base = i * 3 * REC_HEIGHT * batchW
      const plane = REC_HEIGHT * batchW
      for (let y = 0; y < REC_HEIGHT; y++) {
        for (let x = 0; x < batchW; x++) {
          const dst = y * batchW + x
          // Узкие кропы добиваются белым, а не нулями: нулевой пиксель после
          // нормализации это чёрный, и модель дорисовывает несуществующие
          // символы в хвосте строки.
          const inside = x < width
          const si = (y * width + x) * 4
          const r = inside ? img[si] : 255
          const g = inside ? img[si + 1] : 255
          const bl = inside ? img[si + 2] : 255
          input[base + dst] = (r / 255 - 0.5) / 0.5
          input[base + plane + dst] = (g / 255 - 0.5) / 0.5
          input[base + 2 * plane + dst] = (bl / 255 - 0.5) / 0.5
        }
      }
    }

    const output = await rec.run({
      [rec.inputNames[0]]: new ort.Tensor('float32', input, [n, 3, REC_HEIGHT, batchW]),
    })
    const tensor = output[rec.outputNames[0]]
    const data = tensor.data as Float32Array
    const [, timesteps, numClasses] = tensor.dims as number[]

    if (this.charset.length === 0) this.charset = buildCharset(this.dictText, numClasses)

    const results: { text: string; confidence: number }[] = []
    for (let i = 0; i < n; i++) {
      const slice = data.subarray(
        i * timesteps * numClasses,
        (i + 1) * timesteps * numClasses,
      )
      results.push(ctcGreedyDecode(slice, timesteps, numClasses, this.charset))
    }
    return results
  }
}
