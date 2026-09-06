// Local synthetic microbenchmark; no documents or network/model downloads.
import { createServer } from 'vite'
import { performance } from 'node:perf_hooks'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { detectStructural } = await server.ssrLoadModule('/src/lib/anonymize/regexDetectors.ts')
  const { buildAnonymizedText } = await server.ssrLoadModule('/src/lib/anonymize/apply.ts')
  const runs = (fn) => {
    fn()
    const samples = Array.from({ length: 7 }, () => {
      const start = performance.now()
      fn()
      return performance.now() - start
    }).sort((a, b) => a - b)
    return Number(samples[3].toFixed(2))
  }
  const scan = [8_000, 16_000, 32_000, 64_000, 256_000].map((chars) => {
    const text = 'x'.repeat(chars)
    return { chars, structuralMedianMs: runs(() => detectStructural(text)) }
  })
  const source = 'Alice signed this document.\n'.repeat(2_000)
  const entity = { id: 'a', type: 'PERSON', value: 'Alice', placeholder: '[PERSON_1]',
    anonymize: true, manual: true,
    positions: Array.from({ length: 2_000 }, (_, i) => ({ start: i * 28, end: i * 28 + 5 })) }
  console.log(JSON.stringify({ node: process.version, scan,
    exportMedianMs: runs(() => buildAnonymizedText(source, [entity])) }, null, 2))
} finally {
  await server.close()
}
