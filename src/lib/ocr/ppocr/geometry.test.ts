import { describe, it, expect } from 'vitest'
import { convexHull, minAreaRect, normalizeRect, rectToQuad, unclipRect, type Point } from './geometry'

function rotate(points: Point[], angle: number, cx = 0, cy = 0): Point[] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return points.map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as Point
  })
}

describe('convexHull', () => {
  it('отбрасывает внутренние точки', () => {
    const hull = convexHull([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [5, 5],
      [3, 7],
    ])
    expect(hull).toHaveLength(4)
    expect(hull).toEqual(expect.arrayContaining([[0, 0], [10, 0], [10, 10], [0, 10]]))
  })

  it('не падает на вырожденных входах', () => {
    expect(convexHull([])).toEqual([])
    expect(convexHull([[1, 2]])).toEqual([[1, 2]])
  })
})

describe('minAreaRect', () => {
  it('находит габариты осевого прямоугольника', () => {
    const r = normalizeRect(minAreaRect([[0, 0], [40, 0], [40, 10], [0, 10]]))
    expect(r.width).toBeCloseTo(40, 6)
    expect(r.height).toBeCloseTo(10, 6)
    expect(r.cx).toBeCloseTo(20, 6)
    expect(r.cy).toBeCloseTo(5, 6)
  })

  it('находит габариты повёрнутого прямоугольника', () => {
    const angle = Math.PI / 7
    const pts = rotate([[0, 0], [40, 0], [40, 10], [0, 10]], angle, 20, 5)
    const r = normalizeRect(minAreaRect(pts))
    expect(r.width).toBeCloseTo(40, 4)
    expect(r.height).toBeCloseTo(10, 4)
    expect(Math.abs(r.angle)).toBeCloseTo(angle, 4)
  })

  it('площадь повёрнутого прямоугольника не больше площади осевой рамки', () => {
    const pts = rotate([[0, 0], [40, 0], [40, 10], [0, 10]], Math.PI / 4, 20, 5)
    const r = minAreaRect(pts)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const axisAligned = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
    expect(r.width * r.height).toBeLessThan(axisAligned)
  })
})

describe('unclipRect', () => {
  it('раздувает рамку на area*ratio/perimeter с каждой стороны', () => {
    const r = { cx: 0, cy: 0, width: 40, height: 10, angle: 0 }
    const expected = (40 * 10 * 1.5) / (2 * 50)
    const out = unclipRect(r, 1.5)
    expect(out.width).toBeCloseTo(40 + 2 * expected, 6)
    expect(out.height).toBeCloseTo(10 + 2 * expected, 6)
    expect(out.cx).toBe(0)
  })

  it('не делит на ноль на пустой рамке', () => {
    expect(unclipRect({ cx: 1, cy: 1, width: 0, height: 0, angle: 0 }, 1.5).width).toBe(0)
  })
})

describe('rectToQuad', () => {
  it('возвращает углы по часовой стрелке начиная с левого верхнего', () => {
    const quad = rectToQuad({ cx: 20, cy: 5, width: 40, height: 10, angle: 0 })
    expect(quad).toEqual([[0, 0], [40, 0], [40, 10], [0, 10]])
  })
})

describe('normalizeRect', () => {
  it('делает width длинной стороной', () => {
    const r = normalizeRect({ cx: 0, cy: 0, width: 10, height: 40, angle: 0 })
    expect(r.width).toBe(40)
    expect(r.height).toBe(10)
    expect(r.angle).toBeCloseTo(Math.PI / 2, 6)
  })

  it('приводит угол в (-90, 90]', () => {
    const r = normalizeRect({ cx: 0, cy: 0, width: 40, height: 10, angle: Math.PI })
    expect(r.angle).toBeGreaterThan(-Math.PI / 2)
    expect(r.angle).toBeLessThanOrEqual(Math.PI / 2)
  })
})
