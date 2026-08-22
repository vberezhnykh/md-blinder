// Геометрия для постобработки DB-детектора. В PaddleOCR это вызовы OpenCV
// (convexHull / minAreaRect) и pyclipper, в браузере их нет — здесь минимальные
// реализации ровно под нужный случай: выпуклая оболочка компоненты, её
// минимальный по площади прямоугольник и «раздутие» этого прямоугольника.

export type Point = readonly [number, number]

/** Оболочка Эндрю (monotone chain), против часовой стрелки, без дублей. */
export function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return [...points]
  const pts = [...points].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const build = (src: Point[]): Point[] => {
    const out: Point[] = []
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...build(pts), ...build(pts.reverse())]
}

export interface RotatedRect {
  cx: number
  cy: number
  width: number
  height: number
  /** Угол поворота в радианах: направление стороны `width`. */
  angle: number
}

/**
 * Минимальный по площади прямоугольник (rotating calipers). Оптимальный
 * прямоугольник всегда лежит на стороне выпуклой оболочки, поэтому достаточно
 * перебрать стороны и померить габариты в их системе координат.
 */
export function minAreaRect(points: Point[]): RotatedRect {
  const hull = convexHull(points)
  if (hull.length === 0) return { cx: 0, cy: 0, width: 0, height: 0, angle: 0 }
  if (hull.length === 1) {
    return { cx: hull[0][0], cy: hull[0][1], width: 0, height: 0, angle: 0 }
  }

  let best: RotatedRect | null = null
  let bestArea = Infinity
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i]
    const q = hull[(i + 1) % hull.length]
    const angle = Math.atan2(q[1] - p[1], q[0] - p[0])
    const cos = Math.cos(-angle)
    const sin = Math.sin(-angle)
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const [x, y] of hull) {
      const u = x * cos - y * sin
      const v = x * sin + y * cos
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const width = maxU - minU
    const height = maxV - minV
    const area = width * height
    if (area < bestArea) {
      bestArea = area
      // Центр считаем в повёрнутой системе и возвращаем обратно.
      const cu = (minU + maxU) / 2
      const cv = (minV + maxV) / 2
      best = {
        cx: cu * Math.cos(angle) - cv * Math.sin(angle),
        cy: cu * Math.sin(angle) + cv * Math.cos(angle),
        width,
        height,
        angle,
      }
    }
  }
  return best!
}

/** Четыре угла прямоугольника, начиная с левого верхнего, по часовой стрелке. */
export function rectToQuad(r: RotatedRect): Point[] {
  const cos = Math.cos(r.angle)
  const sin = Math.sin(r.angle)
  const hw = r.width / 2
  const hh = r.height / 2
  const corners: Point[] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]
  return corners.map(([u, v]) => [r.cx + u * cos - v * sin, r.cy + u * sin + v * cos] as Point)
}

/**
 * Аналог unclip из PaddleOCR: DB даёт «сжатую» маску текста, и её надо
 * раздуть обратно на d = area * ratio / perimeter. Для прямоугольника
 * offset по Ваттi сводится к увеличению сторон на 2d, поэтому pyclipper
 * здесь не нужен.
 */
export function unclipRect(r: RotatedRect, ratio: number): RotatedRect {
  const area = r.width * r.height
  const perimeter = 2 * (r.width + r.height)
  if (perimeter === 0) return r
  const d = (area * ratio) / perimeter
  return { ...r, width: r.width + 2 * d, height: r.height + 2 * d }
}

/**
 * Приводит прямоугольник к «читаемой» ориентации: width — длинная сторона,
 * угол в (-90°, 90°]. Иначе строка может уехать в вертикальный кроп и
 * распознаться как мусор.
 */
export function normalizeRect(r: RotatedRect): RotatedRect {
  let { width, height, angle } = r
  if (width < height) {
    ;[width, height] = [height, width]
    angle += Math.PI / 2
  }
  while (angle > Math.PI / 2) angle -= Math.PI
  while (angle <= -Math.PI / 2) angle += Math.PI
  return { ...r, width, height, angle }
}
