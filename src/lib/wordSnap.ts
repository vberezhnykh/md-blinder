// Snap a char offset to the nearest WORD boundary — an index where whitespace
// meets non-whitespace (plus the two doc ends). Used so dragging an entity edge
// grabs/releases whole words. Ties resolve to the LOWER index.
export function snapToWordBoundary(text: string, pos: number): number {
  const len = text.length
  const clamped = Math.max(0, Math.min(pos, len))

  const boundaries: number[] = [0, len]
  for (let i = 1; i < len; i++) {
    const prevIsSpace = /\s/.test(text[i - 1])
    const curIsSpace = /\s/.test(text[i])
    if (prevIsSpace !== curIsSpace) boundaries.push(i)
  }
  boundaries.sort((a, b) => a - b)

  let best = boundaries[0]
  let bestDist = Math.abs(best - clamped)
  for (const b of boundaries) {
    const dist = Math.abs(b - clamped)
    if (dist < bestDist) {
      best = b
      bestDist = dist
    }
    // dist === bestDist: keep the earlier (lower) boundary already stored,
    // since boundaries is sorted ascending — do nothing.
  }
  return best
}
