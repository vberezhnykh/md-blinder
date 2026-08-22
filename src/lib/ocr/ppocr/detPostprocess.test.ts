import { describe, it, expect } from 'vitest'
import { boxesFromProbMap } from './detPostprocess'

function blankMap(w: number, h: number): Float32Array {
  return new Float32Array(w * h)
}

function fillRect(
  map: Float32Array,
  w: number,
  rect: { x: number; y: number; width: number; height: number },
  value: number,
) {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) map[y * w + x] = value
  }
}

function bounds(points: readonly (readonly [number, number])[]) {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

describe('boxesFromProbMap', () => {
  it('находит две разделённые области как две рамки', () => {
    const w = 100
    const h = 60
    const map = blankMap(w, h)
    fillRect(map, w, { x: 10, y: 10, width: 30, height: 8 }, 0.9)
    fillRect(map, w, { x: 10, y: 40, width: 50, height: 8 }, 0.9)

    const boxes = boxesFromProbMap(map, w, h)
    expect(boxes).toHaveLength(2)
    expect(boxes.every((b) => b.score > 0.8)).toBe(true)
  })

  it('рамка накрывает исходную область и чуть шире неё (unclip)', () => {
    const w = 100
    const h = 40
    const map = blankMap(w, h)
    fillRect(map, w, { x: 20, y: 15, width: 40, height: 10 }, 0.95)

    const [box] = boxesFromProbMap(map, w, h)
    const b = bounds(box.points)
    expect(b.left).toBeLessThan(20)
    expect(b.right).toBeGreaterThan(59)
    expect(b.top).toBeLessThan(15)
    expect(b.bottom).toBeGreaterThan(24)
    // Раздутие ограниченное: рамка не должна расползаться на пол-страницы.
    expect(b.left).toBeGreaterThan(10)
    expect(b.right).toBeLessThan(70)
  })

  it('отбрасывает области со слабой средней вероятностью', () => {
    const w = 60
    const h = 40
    const map = blankMap(w, h)
    fillRect(map, w, { x: 5, y: 5, width: 30, height: 8 }, 0.45)
    expect(boxesFromProbMap(map, w, h, { boxThreshold: 0.6 })).toHaveLength(0)
    expect(boxesFromProbMap(map, w, h, { boxThreshold: 0.4 })).toHaveLength(1)
  })

  it('игнорирует одиночные пиксели-шум', () => {
    const w = 40
    const h = 40
    const map = blankMap(w, h)
    map[10 * w + 10] = 0.99
    map[20 * w + 30] = 0.99
    expect(boxesFromProbMap(map, w, h)).toHaveLength(0)
  })

  it('масштабирует координаты в систему исходного изображения', () => {
    const w = 50
    const h = 50
    const map = blankMap(w, h)
    fillRect(map, w, { x: 10, y: 10, width: 20, height: 6 }, 0.9)

    const [plain] = boxesFromProbMap(map, w, h)
    const [scaled] = boxesFromProbMap(map, w, h, { scaleX: 4, scaleY: 2 })
    const a = bounds(plain.points)
    const b = bounds(scaled.points)
    expect(b.left).toBeCloseTo(a.left * 4, 6)
    expect(b.top).toBeCloseTo(a.top * 2, 6)
  })

  it('склеивает соприкосающиеся по диагонали пиксели в одну компоненту', () => {
    const w = 30
    const h = 30
    const map = blankMap(w, h)
    fillRect(map, w, { x: 5, y: 5, width: 6, height: 3 }, 0.9)
    fillRect(map, w, { x: 11, y: 8, width: 6, height: 3 }, 0.9)
    expect(boxesFromProbMap(map, w, h)).toHaveLength(1)
  })
})
