import { Tokenizer } from '@huggingface/tokenizers'
import * as ort from 'onnxruntime-web/all'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import { prepareSpanBatch, decodeSpans, type SpanTokenizer, type SpanResult } from './glinerSpan'
import { loadTokenizerJson } from './modelAssets'
import type { ExecProvider } from './pickEp'

// Use the JSEP WebGPU implementation plus WASM. ORT 1.27's smaller native
// /webgpu entry lost two of six RU/UA/EN calibration entities on Intel Gen12;
// /all + JSEP passes the same model/input check. Assets match the installed
// runtime and are hashed/served by Vite from this app, not a public CDN.
ort.env.wasm.wasmPaths = { mjs: wasmModuleUrl, wasm: wasmUrl }
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false

export class Gliner {
  private session: ort.InferenceSession
  private tokenizer: SpanTokenizer

  private constructor(session: ort.InferenceSession, tokenizer: SpanTokenizer) {
    this.session = session
    this.tokenizer = tokenizer
  }

  static async create(modelBytes: Uint8Array, ep: ExecProvider): Promise<Gliner> {
    const [json, config] = await Promise.all([loadTokenizerJson('tokenizer.json'), loadTokenizerJson('tokenizer_config.json')])
    const tokenizer = new Tokenizer(json, config)
    const clsId = tokenizer.token_to_id('[CLS]')
    const sepId = tokenizer.token_to_id('[SEP]')
    if (clsId !== 1 || sepId !== 2 || tokenizer.token_to_id('<<ENT>>') !== 250103) {
      throw new Error('Токенизатор несовместим с закреплённой моделью NER')
    }
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: [ep],
      // ORT's level-4 SimplifiedLayerNormFusion breaks this fp16 graph on CPU
      // (upstream #26717). Keep the other graph optimizations and fp16 weights.
      graphOptimizationLevel: ep === 'wasm' ? 'layout' : 'all',
      logSeverityLevel: 3,
    })
    // Only the session and tokenizer survive initialization; modelBytes is not
    // retained in configuration objects for the lifetime of the worker.
    return new Gliner(session, {
      clsId, sepId,
      encodeWord: (word) => tokenizer.encode(word, { add_special_tokens: false }).ids,
    })
  }

  async inference({ texts, entities, threshold = 0.5 }: {
    texts: string[]; entities: string[]; flatNer?: boolean; threshold?: number
  }): Promise<SpanResult[][]> {
    if (!texts.length) return []
    const batch = prepareSpanBatch(texts, entities, this.tokenizer)
    const tokens = [batch.batchSize, batch.tokenCount]
    const spans = [batch.batchSize, batch.wordCount * batch.maxWidth]
    const feeds = {
      input_ids: new ort.Tensor('int64', batch.inputIds, tokens),
      attention_mask: new ort.Tensor('int64', batch.attentionMask, tokens),
      words_mask: new ort.Tensor('int64', batch.wordsMask, tokens),
      text_lengths: new ort.Tensor('int64', batch.textLengths, [batch.batchSize, 1]),
      span_idx: new ort.Tensor('int64', batch.spanIndices, [...spans, 2]),
      span_mask: new ort.Tensor('bool', batch.spanMask, spans),
    }
    let outputs: ort.InferenceSession.ReturnType | undefined
    try {
      outputs = await this.session.run(feeds)
      const logits = outputs.logits
      if (!logits || (logits.type !== 'float32' && logits.type !== 'float64')) throw new Error('Модель NER вернула неподдерживаемый результат')
      const expectedShape = [batch.batchSize, batch.wordCount, batch.maxWidth, entities.length]
      if (logits.dims.length !== expectedShape.length || logits.dims.some((dimension, index) => dimension !== expectedShape[index])) {
        throw new Error('Модель NER вернула неверную форму результата')
      }
      return decodeSpans(logits.data as Float32Array | Float64Array, batch, texts, entities, threshold)
    } finally {
      Object.values(feeds).forEach((tensor) => tensor.dispose())
      if (outputs) Object.values(outputs).forEach((tensor) => tensor.dispose())
    }
  }

  async release(): Promise<void> { await this.session.release() }
}
