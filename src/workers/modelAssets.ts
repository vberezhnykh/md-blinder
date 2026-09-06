export const MODEL_REVISION = '6ddaeb9413b0e71ad8457da1aab378a165b24058'
export const MODEL_BASE_URL = `https://huggingface.co/onnx-community/gliner_multi-v2.1/resolve/${MODEL_REVISION}`
export const MODEL_URL_FP16 = `${MODEL_BASE_URL}/onnx/model_fp16.onnx`
export const MODEL_BYTES_FP16 = 579_717_643
export const MODEL_CACHE = `md-blinder-ner-v2-${MODEL_REVISION}`

async function openCache(): Promise<Cache | null> {
  try { return await caches.open(MODEL_CACHE) } catch { return null }
}

/** Pinned tokenizer assets share the model cache and remain usable offline. */
export async function loadTokenizerJson(file: 'tokenizer.json' | 'tokenizer_config.json'): Promise<object> {
  const url = `${MODEL_BASE_URL}/${file}`
  const cache = await openCache()
  const cached = await cache?.match(url).catch(() => undefined)
  if (cached) {
    try { return await cached.json() } catch { await cache?.delete(url).catch(() => false) }
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Не удалось загрузить токенизатор NER: HTTP ${response.status}`)
  const json: object = await response.json()
  // Only valid JSON may enter the reusable tokenizer cache.
  await cache?.put(url, Response.json(json)).catch(() => {})
  return json
}

/** One destination allocation for the immutable model, no retained chunk list. */
export async function loadBinaryAsset(
  url: string,
  expectedBytes: number,
  onPct: (pct: number, cached: boolean) => void,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; cached: boolean }> {
  const cache = await openCache()
  const cached = await cache?.match(url).catch(() => undefined)
  if (cached) {
    try {
      const bytes = new Uint8Array(await cached.arrayBuffer())
      if (bytes.byteLength === expectedBytes) {
        onPct(100, true)
        return { bytes, cached: true }
      }
    } catch { /* An unreadable entry must not poison subsequent retries. */ }
    await cache?.delete(url).catch(() => false)
  }
  const controller = new AbortController()
  const response = await fetch(url, { signal: controller.signal })
  if (!response.ok) throw new Error(`Не удалось загрузить модель NER: HTTP ${response.status}`)
  // Feed Cache Storage concurrently from the response stream. Avoid constructing
  // a second 580 MB JS byte array just for a cache Response.
  const saving = cache?.put(url, response.clone()).catch(() => {})
  let bytes: Uint8Array<ArrayBuffer>
  if (response.body) {
    bytes = new Uint8Array(expectedBytes)
    const reader = response.body.getReader()
    let received = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (received + value.byteLength > bytes.byteLength) throw new Error('Неверный размер модели NER')
        bytes.set(value, received)
        received += value.byteLength
        onPct(Math.min(99, Math.round(received / bytes.byteLength * 100)), false)
      }
      if (received !== bytes.byteLength) throw new Error('Загрузка модели NER прервалась до завершения')
    } catch (error) {
      // Abort the shared upstream first. Cancelling one side of a tee alone
      // waits for the Cache Storage branch and can hang on an open response.
      controller.abort()
      void reader.cancel().catch(() => {})
      void saving?.then(() => cache?.delete(url)).catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== expectedBytes) {
      await saving
      await cache?.delete(url).catch(() => false)
      throw new Error('Неверный размер модели NER')
    }
  }
  await saving
  onPct(100, false)
  return { bytes, cached: false }
}

export function loadModelBytes(onPct: (pct: number, cached: boolean) => void) {
  return loadBinaryAsset(MODEL_URL_FP16, MODEL_BYTES_FP16, onPct)
}
