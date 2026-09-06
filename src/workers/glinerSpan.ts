// Adapted from GLiNER.js 0.0.19's span processor/decoder (Ingvarstep/GLiNER.js).
// Changes: typed buffers, per-batch token cache, explicit lifetime and the
// project's Unicode splitter. Model inputs/greedy decoding retain the old
// semantics for migration parity. License: gliner.LICENSE (Apache-2.0).

export interface SpanTokenizer {
  encodeWord(word: string): readonly number[]
  clsId: number
  sepId: number
}

export interface SpanBatch {
  inputIds: BigInt64Array
  attentionMask: BigInt64Array
  wordsMask: BigInt64Array
  textLengths: BigInt64Array
  spanIndices: BigInt64Array
  spanMask: Uint8Array
  batchSize: number
  tokenCount: number
  wordCount: number
  maxWidth: number
  starts: number[][]
  ends: number[][]
}

export interface SpanResult {
  spanText: string
  start: number
  end: number
  label: string
  score: number
}

export function prepareSpanBatch(texts: string[], labels: string[], tokenizer: SpanTokenizer, maxWidth = 12): SpanBatch {
  if (!texts.length || !labels.length) throw new Error('NER requires text and entity labels')
  const words = texts.map((text) => Array.from(text.matchAll(/[\p{L}\p{N}_]+(?:[-_][\p{L}\p{N}_]+)*|\S/gu)))
  const starts = words.map((row) => row.map((word) => word.index))
  const ends = words.map((row) => row.map((word) => word.index + word[0].length))
  const prompt = labels.flatMap((label) => ['<<ENT>>', label]).concat('<<SEP>>')
  const cache = new Map<string, readonly number[]>()
  const encoded = words.map((row) => {
    const ids = [tokenizer.clsId]
    const mask = [0]
    let wordNumber = 1
    for (const [index, word] of [...prompt, ...row.map((match) => match[0])].entries()) {
      let tokens = cache.get(word)
      if (!tokens) { tokens = tokenizer.encodeWord(word); cache.set(word, tokens) }
      for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        ids.push(tokens[tokenIndex])
        mask.push(index >= prompt.length && tokenIndex === 0 ? wordNumber++ : 0)
      }
    }
    ids.push(tokenizer.sepId)
    mask.push(0)
    return { ids, mask }
  })
  const batchSize = texts.length
  const tokenCount = Math.max(...encoded.map((row) => row.ids.length))
  const wordCount = Math.max(...words.map((row) => row.length))
  const inputIds = new BigInt64Array(batchSize * tokenCount)
  const attentionMask = new BigInt64Array(batchSize * tokenCount)
  const wordsMask = new BigInt64Array(batchSize * tokenCount)
  const textLengths = new BigInt64Array(batchSize)
  const spanIndices = new BigInt64Array(batchSize * wordCount * maxWidth * 2)
  const spanMask = new Uint8Array(batchSize * wordCount * maxWidth)
  for (let batch = 0; batch < batchSize; batch++) {
    const { ids, mask } = encoded[batch]
    for (let index = 0; index < ids.length; index++) {
      inputIds[batch * tokenCount + index] = BigInt(ids[index])
      attentionMask[batch * tokenCount + index] = 1n
      wordsMask[batch * tokenCount + index] = BigInt(mask[index])
    }
    textLengths[batch] = BigInt(words[batch].length)
    for (let start = 0; start < words[batch].length; start++) {
      for (let width = 0; width < maxWidth; width++) {
        const offset = (batch * wordCount + start) * maxWidth + width
        spanIndices[offset * 2] = BigInt(start)
        // Preserve the original model input convention: clamp end positions;
        // the decoder rejects widths extending beyond the actual word count.
        spanIndices[offset * 2 + 1] = BigInt(Math.min(start + width, words[batch].length - 1))
        spanMask[offset] = 1
      }
    }
  }
  return { inputIds, attentionMask, wordsMask, textLengths, spanIndices, spanMask, batchSize, tokenCount, wordCount, maxWidth, starts, ends }
}

export function decodeSpans(logits: ArrayLike<number>, batch: SpanBatch, texts: string[], labels: string[], threshold: number): SpanResult[][] {
  const expectedLength = batch.batchSize * batch.wordCount * batch.maxWidth * labels.length
  if (logits.length !== expectedLength) throw new Error('Модель NER вернула неполный результат')
  const rows: SpanResult[][] = Array.from({ length: batch.batchSize }, () => [])
  const rowStride = batch.wordCount * batch.maxWidth * labels.length
  for (let index = 0; index < logits.length; index++) {
    if (!Number.isFinite(logits[index])) throw new Error('Модель NER вернула нечисловые оценки')
    const score = 1 / (1 + Math.exp(-logits[index]))
    if (score < threshold) continue
    const row = Math.floor(index / rowStride)
    const startWord = Math.floor(index / (batch.maxWidth * labels.length)) % batch.wordCount
    const endWord = startWord + Math.floor(index / labels.length) % batch.maxWidth
    if (startWord >= batch.starts[row].length || endWord >= batch.ends[row].length) continue
    const start = batch.starts[row][startWord]
    const end = batch.ends[row][endWord]
    rows[row].push({ spanText: texts[row].slice(start, end), start, end, label: labels[index % labels.length], score })
  }
  return rows.map((candidates) => {
    const selected: SpanResult[] = []
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      // Retain GLiNER.js's overlap rule, including its boundary convention.
      if (!selected.some((other) => !(candidate.start > other.end || other.start > candidate.end))) selected.push(candidate)
    }
    return selected.sort((a, b) => a.start - b.start)
  })
}
