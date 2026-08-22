// Постобработка карты вероятностей DB-детектора PP-OCRv5: маска -> связные
// компоненты -> повёрнутые прямоугольники строк. Функция чистая (на вход
// Float32Array), поэтому тестируется без браузера и onnxruntime.
import { minAreaRect, normalizeRect, rectToQuad, unclipRect, type Point } from './geometry'

export interface DetBox {
  /** 4 точки в координатах ИСХОДНОГО изображения, по часовой стрелке. */
  points: Point[]
  score: number
}

export interface DetOptions {
  /** Порог бинаризации карты вероятностей. */
  threshold?: number
  /** Минимальная средняя вероятность внутри компоненты. */
  boxThreshold?: number
  /** Коэффициент раздутия рамки. */
  unclipRatio?: number
  /** Минимальная короткая сторона рамки (в пикселях модели). */
  minSize?: number
  /** Масштаб «модель -> исходник» по X и Y. */
  scaleX?: number
  scaleY?: number
}

/**
 * Связные компоненты (8-связность) обходом на явном стеке — рекурсия на карте
 * 960x960 переполнит стек на первой же крупной печати.
 */
function* components(mask: Uint8Array, width: number, height: number): Generator<number[]> {
  const seen = new Uint8Array(mask.length)
  const stack: number[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    const pixels: number[] = []
    while (stack.length > 0) {
      const idx = stack.pop()!
      pixels.push(idx)
      const x = idx % width
      const y = (idx / width) | 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const n = ny * width + nx
          if (mask[n] && !seen[n]) {
            seen[n] = 1
            stack.push(n)
          }
        }
      }
    }
    yield pixels
  }
}

export function boxesFromProbMap(
  prob: Float32Array,
  width: number,
  height: number,
  options: DetOptions = {},
): DetBox[] {
  const {
    threshold = 0.3,
    boxThreshold = 0.6,
    unclipRatio = 1.5,
    minSize = 3,
    scaleX = 1,
    scaleY = 1,
  } = options

  const mask = new Uint8Array(prob.length)
  for (let i = 0; i < prob.length; i++) mask[i] = prob[i] > threshold ? 1 : 0

  const boxes: DetBox[] = []
  for (const pixels of components(mask, width, height)) {
    // Компоненты в 1-3 пикселя — шум карты, до геометрии их не доводим.
    if (pixels.length < 4) continue

    let sum = 0
    const points: Point[] = new Array(pixels.length)
    for (let i = 0; i < pixels.length; i++) {
      const idx = pixels[i]
      sum += prob[idx]
      points[i] = [idx % width, (idx / width) | 0]
    }
    const score = sum / pixels.length
    if (score < boxThreshold) continue

    const rect = normalizeRect(minAreaRect(points))
    if (Math.min(rect.width, rect.height) < minSize) continue

    // +1 к габаритам: компонента задана центрами пикселей, а рамка должна
    // накрывать их целиком, иначе у мелкого шрифта срезаются надстрочные.
    const grown = unclipRect(
      { ...rect, width: rect.width + 1, height: rect.height + 1 },
      unclipRatio,
    )
    if (Math.min(grown.width, grown.height) < minSize) continue

    boxes.push({
      points: rectToQuad(grown).map(([x, y]) => [x * scaleX, y * scaleY] as Point),
      score,
    })
  }
  return boxes
}
