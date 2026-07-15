import { Gliner } from 'gliner'
import type { EntityType, RawMatch } from '../lib/anonymize/types'
import { chunkText } from './chunkText'

const MODEL_URL =
  'https://huggingface.co/onnx-community/gliner_small-v2.1/resolve/main/onnx/model_quantized.onnx'
const CACHE_NAME = 'md-blinder-ner'

interface InboundMessage {
  requestId: string
  text: string
  labels: string[]
  threshold: number
}

type OutboundMessage =
  | { requestId: string; type: 'progress'; stage: 'load'; pct: number }
  | { requestId: string; type: 'progress'; stage: 'detect'; chunk: number; chunks: number }
  | { requestId: string; type: 'done'; matches: RawMatch[] }
  | { requestId: string; type: 'error'; error: string }

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

function getGliner(requestId: string): Promise<Gliner> {
  if (!glinerPromise) {
    glinerPromise = (async () => {
      const modelBytes = await loadModelBytes((pct) => post({ requestId, type: 'progress', stage: 'load', pct }))
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

self.onmessage = async (e: MessageEvent<InboundMessage>) => {
  const { requestId, text, labels, threshold } = e.data
  try {
    const gliner = await getGliner(requestId)
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
          score: item.score,
        })
      }
      post({ requestId, type: 'progress', stage: 'detect', chunk: i + 1, chunks: chunks.length })
    }

    post({ requestId, type: 'done', matches })
  } catch (err) {
    post({ requestId, type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
