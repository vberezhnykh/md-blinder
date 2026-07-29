import { Gliner } from 'gliner'
import type { EntityType, RawMatch } from '../lib/anonymize/types'
import { chunkText } from './chunkText'
import { planBatches, expandBatchResult, countWords } from './nerBatching'
import { pickExecutionProvider, type ExecProvider } from './pickEp'
import type { NerProgress } from './nerProgress'

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
// How many chunks to run through the model in one inference() call. Batching
// amortizes per-call overhead; too large wastes compute on padding (chunks are
// padded to the batch's longest) and memory. 8 measured ~10% faster than 1 on
// CPU (247s→221s on a 35-chunk doc) with identical detection; tune if profiling
// says otherwise.
const NER_BATCH_SIZE = 8

interface InboundMessage {
  requestId: string
  text: string
  labels: string[]
  threshold: number
}

type OutboundMessage =
  | ({ requestId: string; type: 'progress' } & NerProgress)
  | { requestId: string; type: 'done'; matches: RawMatch[] }
  | { requestId: string; type: 'error'; error: string }

function post(m: OutboundMessage) {
  self.postMessage(m)
}

const MB = 1024 * 1024
function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

// Downloads the ONNX model with progress reporting, caching it in Cache
// Storage so subsequent runs (and offline use) skip the network entirely.
// Возвращает ещё и признак «взято из кеша»: чтение 580 МБ из Cache Storage —
// это тоже секунды, и пользователю полезно видеть, что сети тут уже нет.
async function loadModelBytes(
  modelUrl: string,
  onPct: (pct: number, cached: boolean) => void,
): Promise<{ bytes: Uint8Array; cached: boolean }> {
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(modelUrl)
    if (cached) {
      const buf = await cached.arrayBuffer()
      onPct(100, true)
      return { bytes: new Uint8Array(buf), cached: true }
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
      if (total > 0) onPct(Math.round((received / total) * 100), false)
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

  onPct(100, false)
  return { bytes, cached: false }
}

let glinerPromise: Promise<Gliner> | null = null
// Set once getGliner resolves; used only for the NER timing log below.
let activeEp: ExecProvider = 'wasm'
// Тайминги одноразовой инициализации (модель живёт в модуле, второй запрос их
// не платит) — печатаются в итоговой строке, чтобы было видно, что 65 секунд
// это не «инференс тормозит», а download+session+warmup+inference по частям.
let loadTiming: { downloadMs: number; initMs: number; warmupMs: number; cached: boolean } | null =
  null

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
        const t0 = performance.now()
        const { bytes: modelBytes, cached } = await loadModelBytes(MODEL_URL_FP16, (pct, fromCache) =>
          post({ requestId, type: 'progress', stage: 'download', pct, cached: fromCache }),
        )
        const downloadMs = performance.now() - t0
        console.log(
          `[ner] модель ${(modelBytes.length / MB).toFixed(0)} МБ ${cached ? 'из кеша' : 'скачана'} за ${fmtMs(downloadMs)}`,
        )

        // Создание ONNX-сессии — самая «тихая» фаза: onnxruntime парсит и
        // оптимизирует граф на 580 МБ (именно здесь сыпятся warning'и вида
        // «Failed to find kernel for ReduceMean» — это шум оптимизатора, не
        // ошибка), и на CPU это десятки секунд без единого события.
        post({ requestId, type: 'progress', stage: 'init', ep })
        const t1 = performance.now()
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
        const initMs = performance.now() - t1
        console.log(`[ner] сессия ONNX (${ep}) создана за ${fmtMs(initMs)}`)

        // Force GPU kernel init and surface runtime errors immediately.
        post({ requestId, type: 'progress', stage: 'warmup', ep })
        const t2 = performance.now()
        await gliner.inference({ texts: ['John Smith'], entities: ['person'], flatNer: true, threshold: 0.5 })
        const warmupMs = performance.now() - t2
        console.log(`[ner] прогрев (${ep}) за ${fmtMs(warmupMs)}`)

        loadTiming = { downloadMs: Math.round(downloadMs), initMs: Math.round(initMs), warmupMs: Math.round(warmupMs), cached }
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
      console.log('[ner] execution provider: wasm (fp16)')
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
    const reqStart = performance.now()
    const gliner = await getGliner(requestId)
    const chunks = chunkText(text)
    const matches: RawMatch[] = []

    const nerStart = performance.now()
    // Batch several chunks per inference() call: one session.run over N texts
    // amortizes the per-call overhead (measured ~10% faster than one-at-a-time
    // on CPU; multi-threading didn't help because that overhead is per-call, not
    // per-op). Identical chunks (repeated boilerplate phrases) are deduped down
    // to one inference each via planBatches, and unique chunks are sorted by
    // word count so a batch doesn't pad short chunks up to a rare long one.
    // Offsets stay per-occurrence (occ.base), so dedup never merges positions.
    const { batches, occurrences } = planBatches(chunks, NER_BATCH_SIZE)
    let processed = 0
    for (let b = 0; b < batches.length; b++) {
      const batchTexts = batches[b]
      // Сколько вхождений (с учётом дублей) закроет этот батч — прогресс
      // отдаётся ДО инференса, иначе на коротком документе (1 батч) индикатор
      // стоит на нуле всё время счёта и выглядит как зависание.
      const batchChunks = batchTexts.reduce((n, t) => n + (occurrences.get(t)?.length ?? 0), 0)
      const batchWords = batchTexts.reduce((n, t) => n + countWords(t), 0)
      post({
        requestId,
        type: 'progress',
        stage: 'detect',
        ep: activeEp,
        chunk: Math.min(processed, chunks.length),
        chunks: chunks.length,
        batch: b + 1,
        batches: batches.length,
        batchChunks,
        elapsedMs: Math.round(performance.now() - reqStart),
      })

      const bStart = performance.now()
      const res = await gliner.inference({
        texts: batchTexts,
        entities: labels,
        flatNer: true,
        threshold,
      })
      const batchMs = performance.now() - bStart
      matches.push(...expandBatchResult(batchTexts, res, occurrences, mapLabel))
      processed += batchChunks
      console.log(
        `[ner] батч ${b + 1}/${batches.length}: ${batchTexts.length} уник. текстов ` +
          `(${batchChunks} чанк(ов), ${batchWords} слов) за ${fmtMs(batchMs)} ` +
          `— ${Math.round(batchMs / Math.max(batchWords, 1))} мс/слово`,
      )

      post({
        requestId,
        type: 'progress',
        stage: 'detect',
        ep: activeEp,
        chunk: Math.min(processed, chunks.length),
        chunks: chunks.length,
        batch: b + 1,
        batches: batches.length,
        batchChunks,
        elapsedMs: Math.round(performance.now() - reqStart),
      })
    }

    const nerMs = Math.round(performance.now() - nerStart)
    const totalMs = Math.round(performance.now() - reqStart)
    const perChunk = Math.round(nerMs / Math.max(chunks.length, 1))
    console.log(
      `[ner] итого EP=${activeEp} chunks=${chunks.length} (уник. ${occurrences.size}, батчей ${batches.length}) ` +
        `nerMs=${nerMs} (${perChunk} мс/чанк) totalMs=${totalMs}` +
        (loadTiming
          ? ` | загрузка: download=${loadTiming.downloadMs}ms${loadTiming.cached ? ' (кеш)' : ''} ` +
            `session=${loadTiming.initMs}ms warmup=${loadTiming.warmupMs}ms`
          : ' | загрузка: (модель уже была готова)'),
    )
    // Тайминги загрузки платятся один раз на воркер: гасим, чтобы во втором
    // документе они не выглядели как заново потраченное время.
    loadTiming = null

    post({ requestId, type: 'done', matches })
  } catch (err) {
    post({ requestId, type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
