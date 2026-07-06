import { Gliner } from 'gliner'
import type { EntityType, RawMatch } from '../lib/anonymize/types'

const MODEL_URL =
  'https://huggingface.co/onnx-community/gliner_small-v2.1/resolve/main/onnx/model_quantized.onnx'
const CACHE_NAME = 'md-blinder-ner'

interface InboundMessage {
  text: string
  labels: string[]
  threshold: number
}

type OutboundMessage =
  | { type: 'progress'; stage: 'load'; pct: number }
  | { type: 'progress'; stage: 'detect'; chunk: number; chunks: number }
  | { type: 'done'; matches: RawMatch[] }
  | { type: 'error'; error: string }

function post(m: OutboundMessage) {
  self.postMessage(m)
}

// Downloads the ONNX model with progress reporting, caching it in Cache
// Storage so subsequent runs (and offline use) skip the network entirely.
async function loadModelBytes(onPct: (pct: number) => void): Promise<Uint8Array> {
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(MODEL_URL)
    if (cached) {
      const buf = await cached.arrayBuffer()
      onPct(100)
      return new Uint8Array(buf)
    }
  } catch {
    cache = null
  }

  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`Не удалось загрузить модель NER: HTTP ${res.status}`)

  const total = Number(res.headers.get('Content-Length') ?? 0)
  let bytes: Uint8Array

  if (res.body) {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      if (total > 0) onPct(Math.round((received / total) * 100))
    }
    bytes = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer())
  }

  if (cache) {
    try {
      await cache.put(MODEL_URL, new Response(bytes.slice()))
    } catch {
      // ignore cache write failures (e.g. storage quota) — detection still works
    }
  }

  onPct(100)
  return bytes
}

let glinerPromise: Promise<Gliner> | null = null

function getGliner(): Promise<Gliner> {
  if (!glinerPromise) {
    glinerPromise = (async () => {
      const modelBytes = await loadModelBytes((pct) => post({ type: 'progress', stage: 'load', pct }))
      const gliner = new Gliner({
        tokenizerPath: 'onnx-community/gliner_small-v2.1',
        onnxSettings: {
          modelPath: modelBytes,
          executionProvider: 'wasm',
          wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/',
        },
        transformersSettings: { allowLocalModels: false, useBrowserCache: true },
      })
      await gliner.initialize()
      return gliner
    })()
  }
  return glinerPromise
}

function mapLabel(label: string): EntityType | null {
  switch (label.toLowerCase()) {
    case 'person':
      return 'PERSON'
    case 'company':
      return 'COMPANY'
    case 'address':
      return 'ADDRESS'
    case 'registration number':
      return 'REG_NUMBER'
    default:
      return null
  }
}

// Splits text into ≤maxLen chunks on paragraph boundaries, hard-splitting any
// paragraph that alone exceeds maxLen. Each chunk carries `base`, its true
// char offset in the original text, computed by re-slicing the source
// string rather than reassembling from the split parts (so offsets never
// drift because of varying separator lengths).
function chunkText(text: string, maxLen = 1500): { text: string; base: number }[] {
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
        chunks.push({ text: para.slice(offset, offset + maxLen), base: paraStart + offset })
        offset += maxLen
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
  return chunks
}

self.onmessage = async (e: MessageEvent<InboundMessage>) => {
  try {
    const { text, labels, threshold } = e.data
    const gliner = await getGliner()
    const chunks = chunkText(text)
    const matches: RawMatch[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const res = await gliner.inference({ texts: [chunk.text], entities: labels, flatNer: true, threshold })
      const items = res[0] ?? []
      for (const item of items) {
        const type = mapLabel(item.label)
        if (!type) continue
        matches.push({
          type,
          value: item.spanText,
          start: chunk.base + item.start,
          end: chunk.base + item.end,
        })
      }
      post({ type: 'progress', stage: 'detect', chunk: i + 1, chunks: chunks.length })
    }

    post({ type: 'done', matches })
  } catch (err) {
    post({ type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
