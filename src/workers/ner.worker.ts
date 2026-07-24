import { Gliner } from 'gliner'
import type { EntityType, RawMatch } from '../lib/anonymize/types'
import { chunkText } from './chunkText'
import { pickExecutionProvider, type ExecProvider } from './pickEp'

// Multilingual GLiNER (handles Russian + English, incl. bilingual docs). We use
// the fp16 model on BOTH execution providers. The int8 quantized and q4f16
// variants were measured to destroy multilingual discrimination — real Russian
// names scored ~0.16 (indistinguishable from junk) on int8 vs ~0.92 on fp16, so
// nothing cleared the confirm threshold. fp16 runs natively on WebGPU (fast) and
// on wasm/CPU (correct but slow, ~minutes/doc — the CPU fallback trade-off).
// ~580MB download vs the old English-only gliner_small (~306MB fp16).
const MODEL_URL_FP16 =
  'https://huggingface.co/onnx-community/gliner_multi-v2.1/resolve/main/onnx/model_fp16.onnx'
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
async function loadModelBytes(modelUrl: string, onPct: (pct: number) => void): Promise<Uint8Array> {
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(modelUrl)
    if (cached) {
      const buf = await cached.arrayBuffer()
      onPct(100)
      return new Uint8Array(buf)
    }
  } catch {
    cache = null
  }

  const res = await fetch(modelUrl)
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
      await cache.put(modelUrl, new Response(bytes.slice()))
    } catch {
      // ignore cache write failures (e.g. storage quota) — detection still works
    }
  }

  onPct(100)
  return bytes
}

let glinerPromise: Promise<Gliner> | null = null
// Set once getGliner resolves; used only for the NER timing log below.
let activeEp: ExecProvider = 'wasm'

// Whether a usable WebGPU adapter can actually be acquired (not just present).
async function webgpuHasAdapter(): Promise<boolean> {
  const gpu = (self as unknown as {
    navigator?: { gpu?: { requestAdapter?: () => Promise<unknown> } }
  }).navigator?.gpu
  if (!gpu?.requestAdapter) return false
  try {
    return !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

function getGliner(requestId: string): Promise<Gliner> {
  if (!glinerPromise) {
    glinerPromise = (async () => {
      const preferred = pickExecutionProvider(
        (self as unknown as { navigator?: { gpu?: unknown } }).navigator,
      )

      // fp16 on whichever EP we run (GPU or CPU), then builds + warms up GLiNER
      // so any runtime failure surfaces here (→ fallback).
      async function buildGliner(ep: ExecProvider): Promise<Gliner> {
        const modelBytes = await loadModelBytes(MODEL_URL_FP16, (pct) =>
          post({ requestId, type: 'progress', stage: 'load', pct }),
        )
        const gliner = new Gliner({
          tokenizerPath: 'onnx-community/gliner_multi-v2.1',
          onnxSettings: {
            modelPath: modelBytes,
            executionProvider: ep,
            wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/',
          },
          transformersSettings: { allowLocalModels: false, useBrowserCache: true },
        })
        await gliner.initialize()
        // Force GPU kernel init and surface runtime errors immediately.
        await gliner.inference({ texts: ['John Smith'], entities: ['person'], flatNer: true, threshold: 0.5 })
        return gliner
      }

      // Confirm a real GPU adapter is obtainable BEFORE downloading the big fp16
      // model — navigator.gpu can exist while requestAdapter() yields null (no
      // GPU / blocklisted / headless), and we must not waste a ~306MB download
      // only to fall back to wasm anyway.
      if (preferred === 'webgpu' && (await webgpuHasAdapter())) {
        try {
          const g = await buildGliner('webgpu')
          activeEp = 'webgpu'
          console.log('[ner] execution provider: webgpu (fp16)')
          return g
        } catch (err) {
          console.warn('[ner] webgpu failed, falling back to wasm:', err instanceof Error ? err.message : String(err))
        }
      }

      const g = await buildGliner('wasm')
      activeEp = 'wasm'
      console.log('[ner] execution provider: wasm (quantized)')
      return g
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

    const nerStart = performance.now()
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

    const nerMs = Math.round(performance.now() - nerStart)
    console.log(`[ner] timing EP=${activeEp} chunks=${chunks.length} nerMs=${nerMs}`)

    post({ requestId, type: 'done', matches })
  } catch (err) {
    post({ requestId, type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
