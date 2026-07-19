// Functional check for Stage 8 WebGPU NER. Launches chromium with WebGPU
// enabled, probes navigator.gpu / adapter, then (optionally) runs one document
// and reports which execution provider the NER worker actually used (via the
// worker's "[ner] execution provider: …" console markers) plus the entity count.
//
// Usage: node scripts/e2e-webgpu-check.mjs [baseUrl] [file]
import { chromium } from 'playwright'

const baseUrl = process.argv[2] || 'http://localhost:4181'
const file = process.argv[3] || null

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan'],
})
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  const logs = []
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e)}`))

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  const probe = await page.evaluate(async () => {
    const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu
    let adapter = null
    let adapterInfo = null
    if (hasGpu) {
      try {
        const a = await navigator.gpu.requestAdapter()
        adapter = !!a
        if (a && a.info) adapterInfo = { vendor: a.info.vendor, architecture: a.info.architecture }
      } catch (e) {
        adapter = `error: ${String(e)}`
      }
    }
    return { hasGpu, adapter, adapterInfo }
  })
  console.log('WEBGPU PROBE:', JSON.stringify(probe))

  if (file) {
    console.log(`Running ${file} …`)
    await page.setInputFiles('input[type=file]', file)
    // Wait for the result section (NER done) — up to 6 min.
    let finished = false
    const deadline = Date.now() + 360000
    let sawLoading = false
    while (Date.now() < deadline) {
      await page.waitForTimeout(1500)
      const loading = await page.$('.status-loading').then((el) => !!el)
      const result = await page.$('.result').then((el) => !!el)
      if (loading) sawLoading = true
      if (!loading && result && sawLoading) {
        finished = true
        break
      }
    }
    await page.waitForTimeout(1000)
    const entityCount = await page.$$eval('.entity-row:not(.candidate-row)', (r) => r.length)
    const epLine = logs.find((l) => /\[ner\] execution provider:/.test(l))
    const epWarn = logs.find((l) => /webgpu failed/.test(l))
    console.log(`RUN finished=${finished} entities=${entityCount}`)
    console.log(`NER EP: ${epLine || '(marker not seen)'}`)
    if (epWarn) console.log(`NER WARN: ${epWarn}`)
  }

  // Surface any ner-related console lines for debugging.
  const nerLogs = logs.filter((l) => /ner|gpu|webgpu|wasm/i.test(l)).slice(0, 15)
  if (nerLogs.length) {
    console.log('--- ner/gpu console lines ---')
    for (const l of nerLogs) console.log(l)
  }

  await context.close()
} finally {
  await browser.close()
}
