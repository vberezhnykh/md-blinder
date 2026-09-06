// Optional, real-model CPU benchmark. Only these synthetic strings are used.
// First run: node scripts/benchmark-ner.mjs --download
// Later/offline: node scripts/benchmark-ner.mjs
// Reuse existing assets: node scripts/benchmark-ner.mjs --assets-dir .work/ner-parity
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { Tokenizer } from '@huggingface/tokenizers'
import ort from 'onnxruntime-web'
import { prepareSpanBatch, decodeSpans } from '../src/workers/glinerSpan.ts'
import { MODEL_BASE_URL, MODEL_BYTES_FP16, MODEL_REVISION } from '../src/workers/modelAssets.ts'

const args = process.argv.slice(2)
const directoryIndex = args.indexOf('--assets-dir')
const directory = path.resolve(directoryIndex >= 0 ? args[directoryIndex + 1] : '.work/ner-benchmark')
await fsp.mkdir(directory, { recursive: true })
for (const file of ['model_fp16.onnx', 'tokenizer.json', 'tokenizer_config.json']) {
  const target = path.join(directory, file)
  if (!fs.existsSync(target)) {
    if (!args.includes('--download')) throw new Error(`Missing ${file}; rerun with --download (public model: ~580 MB)`)
    const response = await fetch(`${MODEL_BASE_URL}/${file.endsWith('.onnx') ? 'onnx/' : ''}${file}`)
    if (!response.ok || !response.body) throw new Error(`Asset download failed: ${response.status}`)
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target, { flags: 'wx' }))
  }
}
if ((await fsp.stat(path.join(directory, 'model_fp16.onnx'))).size !== MODEL_BYTES_FP16) throw new Error('Model file is incomplete')
const json = JSON.parse(await fsp.readFile(path.join(directory, 'tokenizer.json'), 'utf8'))
const config = JSON.parse(await fsp.readFile(path.join(directory, 'tokenizer_config.json'), 'utf8'))
const tokenizer = new Tokenizer(json, config)
const texts = [
  'John Smith signed for Acme Ltd in London at 12 Baker Street.',
  'Иван Петров подписал договор с ООО «Альфа» в Москве, улица Лесная, дом 15.',
  'Олена Коваленко уклала договір із ТОВ «Весна» у Києві, вулиця Хрещатик, 20.',
  'Élodie Müller signed with Alpha-Beta and O\'Connor. 👩🏽‍💻 № 12345.',
  'Анна-Мария Иванова / Anna-Maria Ivanova: ACME_2026, 50 000 EUR.',
  'ТОВ «Зоря»; пошта sample@example.test; ім’я Марія, Іванівна.',
]
const labels = ['person', 'company', 'address', 'registration number']
// Recorded legacy 1.19.2 fp16/WASM spans. This is compatibility, not a claim
// that all legacy predictions are ground truth (e.g. O'Connor is ambiguous).
const legacy = [
  [[0, 10, 'person'], [22, 30, 'company'], [44, 59, 'address']],
  [[0, 11, 'person'], [31, 42, 'company'], [53, 65, 'address'], [67, 73, 'address']],
  [[0, 15, 'person'], [34, 45, 'company'], [55, 74, 'address']],
  [[0, 13, 'person'], [26, 36, 'company'], [41, 49, 'company'], [59, 66, 'registration number']],
  [[0, 18, 'person'], [21, 39, 'person']],
  [[0, 10, 'company'], [44, 59, 'person']],
]
const batch = prepareSpanBatch(texts, labels, { clsId: 1, sepId: 2, encodeWord: (word) => tokenizer.encode(word, { add_special_tokens: false }).ids })
ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist') + path.sep).href
const start = performance.now()
const session = await ort.InferenceSession.create(new Uint8Array(await fsp.readFile(path.join(directory, 'model_fp16.onnx'))), {
  executionProviders: ['wasm'], graphOptimizationLevel: 'layout', logSeverityLevel: 3,
})
const initMs = performance.now() - start
const tokenShape = [batch.batchSize, batch.tokenCount]
const spanShape = [batch.batchSize, batch.wordCount * batch.maxWidth]
const feeds = {
  input_ids: new ort.Tensor('int64', batch.inputIds, tokenShape),
  attention_mask: new ort.Tensor('int64', batch.attentionMask, tokenShape),
  words_mask: new ort.Tensor('int64', batch.wordsMask, tokenShape),
  text_lengths: new ort.Tensor('int64', batch.textLengths, [batch.batchSize, 1]),
  span_idx: new ort.Tensor('int64', batch.spanIndices, [...spanShape, 2]),
  span_mask: new ort.Tensor('bool', batch.spanMask, spanShape),
}
let outputs
try {
  const inferenceStart = performance.now()
  outputs = await session.run(feeds)
  const inferenceMs = performance.now() - inferenceStart
  const matches = decodeSpans(outputs.logits.data, batch, texts, labels, 0.5)
  const comparable = matches.map((row) => row.map(({ start, end, label }) => [start, end, label]))
  const exactLegacyAgreement = JSON.stringify(comparable) === JSON.stringify(legacy)
  console.log(JSON.stringify({ revision: MODEL_REVISION, runtime: ort.env.versions.web, backend: 'WASM, one thread, layout optimizations', texts: texts.length, spans: matches.flat().length, exactLegacyAgreement, initMs: Math.round(initMs), inferenceMs: Math.round(inferenceMs) }, null, 2))
  if (!exactLegacyAgreement) process.exitCode = 1
} finally {
  Object.values(feeds).forEach((tensor) => tensor.dispose())
  if (outputs) Object.values(outputs).forEach((tensor) => tensor.dispose())
  await session.release()
}
