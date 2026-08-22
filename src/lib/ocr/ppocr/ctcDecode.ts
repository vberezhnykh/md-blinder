// Жадный CTC-декод выхода распознавателя PP-OCR: матрица [T, C] вероятностей
// (softmax сидит внутри модели) превращается в строку и её уверенность.

/**
 * Словарь модели: класс 0 — CTC-blank, дальше символы из dict.txt в том же
 * порядке, а пробел (use_space_char) модель отдаёт последним классом.
 *
 * Тонкость, из-за которой весь текст съезжает на один символ: dict.txt из
 * PaddleOCR начинается с пустой строки. Это не пробел, а артефакт формата —
 * алфавит начинается со следующей строки. Если считать её символом, каждая
 * буква декодируется как предыдущая по словарю («Д» превращается в «Ґ»,
 * а пробел — в «я»).
 */
export function buildCharset(dictText: string, numClasses: number): string[] {
  const lines = dictText.split('\n')
  // Хвостовой перевод строки — не символ.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length > 0 && lines[0] === '') lines.shift()
  const chars = ['', ...lines]
  // use_space_char: пробел добавлен в конец списка классов.
  if (chars.length === numClasses - 1) chars.push(' ')
  if (chars.length !== numClasses) {
    throw new Error(
      `Словарь не совпал с моделью: ${chars.length} классов из dict.txt против ${numClasses} на выходе rec.onnx`,
    )
  }
  return chars
}

export interface DecodedText {
  text: string
  confidence: number
}

export function ctcGreedyDecode(
  logits: Float32Array,
  timesteps: number,
  numClasses: number,
  charset: string[],
): DecodedText {
  let text = ''
  let confSum = 0
  let confCount = 0
  let prev = -1
  for (let t = 0; t < timesteps; t++) {
    const base = t * numClasses
    let bestIdx = 0
    let bestVal = -Infinity
    for (let c = 0; c < numClasses; c++) {
      const v = logits[base + c]
      if (v > bestVal) {
        bestVal = v
        bestIdx = c
      }
    }
    // Схлопывание повторов и выброс blank — базовое правило CTC.
    if (bestIdx !== 0 && bestIdx !== prev) {
      text += charset[bestIdx]
      confSum += bestVal
      confCount++
    }
    prev = bestIdx
  }
  return { text, confidence: confCount > 0 ? confSum / confCount : 0 }
}
