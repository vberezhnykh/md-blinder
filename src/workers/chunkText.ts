const OVERLAP = 200

// A chunk with no Unicode letter or digit (table-separator rows «|---|»,
// signature-line underscores, pure punctuation) can't hold any entity —
// PERSON/COMPANY/ADDRESS need letters, REG_NUMBER/ACCOUNT need digits — so we
// drop it before NER to save an ONNX call. Provably recall-safe.
const HAS_ALNUM = /[\p{L}\p{N}]/u

// GLiNER's word cost is O(words) spans and its transformer is O(words²)-ish, and
// the model was trained at max_len=384. The 1500-char cap keeps prose well under
// that, but a punctuation-dense chunk (tables: every «|»/«.»/«<br>» is its own
// word) can blow past 384 words → out-of-range quality + a slow chunk. So we cap
// WORDS too, re-splitting any over-limit chunk with a word overlap. Same word
// regex as gliner's (patched) splitter, so the count matches what the model sees.
const WORD_RE = /[\p{L}\p{N}_]+(?:[-_][\p{L}\p{N}_]+)*|\S/gu
const MAX_WORDS = 350
const WORD_OVERLAP = 24

// Split one chunk into ≤MAX_WORDS-word sub-chunks (with WORD_OVERLAP-word overlap),
// carrying correct base offsets. Chunks already under the limit pass through as-is.
function capWords(chunk: { text: string; base: number }): { text: string; base: number }[] {
  const words: { start: number; end: number }[] = []
  WORD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WORD_RE.exec(chunk.text))) words.push({ start: m.index, end: m.index + m[0].length })
  if (words.length <= MAX_WORDS) return [chunk]

  const out: { text: string; base: number }[] = []
  let i = 0
  while (i < words.length) {
    const endIdx = Math.min(i + MAX_WORDS, words.length)
    const charStart = words[i].start
    const charEnd = words[endIdx - 1].end
    out.push({ text: chunk.text.slice(charStart, charEnd), base: chunk.base + charStart })
    if (endIdx >= words.length) break
    i = Math.max(endIdx - WORD_OVERLAP, i + 1)
  }
  return out
}

// Splits text into ≤maxLen chunks on paragraph boundaries, hard-splitting any
// paragraph that alone exceeds maxLen. Each chunk carries `base`, its true
// char offset in the original text, computed by re-slicing the source
// string rather than reassembling from the split parts (so offsets never
// drift because of varying separator lengths).
export function chunkText(text: string, maxLen = 1500): { text: string; base: number }[] {
  const paragraphs = text.split(/\n\n+/)
  const chunks: { text: string; base: number }[] = []
  let searchFrom = 0
  let current = ''
  let currentBase = 0

  const flush = () => {
    if (current.length) {
      chunks.push({ text: current, base: currentBase })
      current = ''
    }
  }

  for (const para of paragraphs) {
    const idx = text.indexOf(para, searchFrom)
    const paraStart = idx === -1 ? searchFrom : idx
    searchFrom = paraStart + para.length

    if (!para.length) continue

    if (para.length > maxLen) {
      flush()
      let offset = 0
      while (offset < para.length) {
        const windowEnd = Math.min(offset + maxLen, para.length)
        const end = findSplitPoint(para, offset, windowEnd)
        chunks.push({ text: para.slice(offset, end), base: paraStart + offset })
        if (end >= para.length) break
        const next = Math.max(end - OVERLAP, offset + 1)
        offset = next
      }
      continue
    }

    if (!current.length) {
      current = para
      currentBase = paraStart
    } else if (paraStart + para.length - currentBase <= maxLen) {
      current = text.slice(currentBase, paraStart + para.length)
    } else {
      flush()
      current = para
      currentBase = paraStart
    }
  }
  flush()
  return chunks.filter((c) => HAS_ALNUM.test(c.text)).flatMap(capWords)
}

// Finds the best place to end a hard-split chunk within [offset, windowEnd]:
// the last sentence boundary ('. ' or newline), or failing that the last
// space, as long as it lies past the halfway point of the window. Falls back
// to windowEnd if no good boundary is found.
function findSplitPoint(para: string, offset: number, windowEnd: number): number {
  if (windowEnd >= para.length) return windowEnd

  const halfway = offset + Math.floor((windowEnd - offset) / 2)
  const window = para.slice(offset, windowEnd)

  let bestSentence = -1
  let searchIdx = 0
  for (;;) {
    const dot = window.indexOf('. ', searchIdx)
    const nl = window.indexOf('\n', searchIdx)
    let found = -1
    let len = 0
    if (dot !== -1) {
      found = dot
      len = 2
    }
    if (nl !== -1 && (found === -1 || nl < found)) {
      found = nl
      len = 1
    }
    if (found === -1) break
    bestSentence = found + len
    searchIdx = found + 1
  }
  if (bestSentence !== -1 && offset + bestSentence > halfway) {
    return offset + bestSentence
  }

  const lastSpace = window.lastIndexOf(' ')
  if (lastSpace !== -1 && offset + lastSpace + 1 > halfway) {
    return offset + lastSpace + 1
  }

  return windowEnd
}
