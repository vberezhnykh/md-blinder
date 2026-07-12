// Compares gold-standard entities against what the app actually detected.
// Usage: node scripts/score.mjs <e2e.json>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const e2e = JSON.parse(readFileSync(process.argv[2], 'utf8'))

// Load the extras triage store (which extras are known over-capture vs noise).
// Absence is fine — every extra just defaults to "noise" per the TZ.
let triage = {}
try {
  triage = JSON.parse(readFileSync('test-samples/extras-triage.json', 'utf8'))
} catch {
  triage = {}
}

// Load every gold/contract-*.json and index it by the files it covers.
const fileToGold = {}
for (const name of readdirSync('test-samples/gold')) {
  if (!/^contract-.*\.json$/.test(name)) continue
  const gold = JSON.parse(readFileSync(`test-samples/gold/${name}`, 'utf8'))
  for (const f of gold.files) fileToGold[f] = gold
}

// Load the manifest and index each document's dev/holdout set by basename.
const manifest = JSON.parse(readFileSync('test-samples/manifest.json', 'utf8'))
const fileToSet = {}
for (const doc of manifest.documents) fileToSet[basename(doc.path)] = doc.set

function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}
function tokens(s) {
  return new Set(norm(s).split(' ').filter(Boolean))
}
function jaccard(a, b) {
  const A = tokens(a), B = tokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}
// returns 'full' | 'partial' | null
function valueMatch(goldVal, detVal) {
  const g = norm(goldVal), d = norm(detVal)
  if (!g || !d) return null
  if (g === d) return 'full'
  if (g.includes(d) || d.includes(g)) return 'partial'
  if (jaccard(g, d) >= 0.5) return 'partial'
  return null
}

function triageKey(file, type, value) {
  return `${file}|${type}|${norm(value)}`
}

// Up to 50 chars on each side of the first case-insensitive occurrence of
// `value` in `sourceText`. Returns null if either is missing or no match.
function findContext(sourceText, value) {
  if (!sourceText || !value) return null
  const idx = sourceText.toLowerCase().indexOf(value.toLowerCase())
  if (idx === -1) return null
  const start = Math.max(0, idx - 50)
  const end = Math.min(sourceText.length, idx + value.length + 50)
  const left = sourceText.slice(start, idx)
  const matched = sourceText.slice(idx, idx + value.length)
  const right = sourceText.slice(idx + value.length, end)
  return `…${left}‹${matched}›${right}…`
}

const report = {}

for (const [file, res] of Object.entries(e2e)) {
  const gold = fileToGold[file]
  if (!gold) {
    console.error(`[warn] no gold standard for "${file}" — skipping`)
    continue
  }
  const detected = (res.entities || []).slice()
  const usedDet = new Set()
  const goldResults = []

  for (const ge of gold.entities) {
    let best = null // { det, quality, typeOk }
    detected.forEach((de, i) => {
      const q = valueMatch(ge.value, de.value)
      if (!q) return
      const typeOk = de.type === ge.type
      const score = (q === 'full' ? 2 : 1) + (typeOk ? 0.5 : 0)
      if (!best || score > best.score) best = { i, det: de, quality: q, typeOk, score }
    })
    if (best) usedDet.add(best.i)
    goldResults.push({
      gold: ge,
      status: !best ? 'MISS' : best.typeOk ? (best.quality === 'full' ? 'HIT' : 'PARTIAL') : 'TYPE_MISMATCH',
      matched: best ? best.det : null,
      quality: best ? best.quality : null,
    })
  }

  const extras = detected.filter((_, i) => !usedDet.has(i))

  report[file] = {
    contract: gold.title,
    finished: res.finished,
    error: res.error,
    nerNotice: res.nerNotice,
    detectedCount: detected.length,
    goldResults,
    extras,
    sourceText: res.sourceText ?? null,
  }
}

// ---- print human-readable report ----
const ICON = { HIT: '✅', PARTIAL: '🟡', TYPE_MISMATCH: '🟠', MISS: '🔴' }
function makeTotals() {
  return { HIT: 0, PARTIAL: 0, TYPE_MISMATCH: 0, MISS: 0, extras: 0, noise: 0, overCapture: 0, tokens: 0 }
}
const totals = { dev: makeTotals(), holdout: makeTotals(), combined: makeTotals() }
const extrasFlat = []

for (const [file, r] of Object.entries(report)) {
  console.log('\n' + '='.repeat(70))
  console.log(file)
  console.log(r.contract)
  console.log(`finished=${r.finished} nerNotice=${r.nerNotice}${r.error ? ' ERROR=' + r.error : ''} detected=${r.detectedCount}`)
  console.log('-'.repeat(70))

  const set = fileToSet[file]
  if (!set) console.error(`[warn] no set for "${file}"`)
  const buckets = set ? [totals[set], totals.combined] : [totals.combined]

  const fileTokens = r.sourceText ? r.sourceText.trim().split(/\s+/).filter(Boolean).length : 0
  for (const t of buckets) t.tokens += fileTokens

  for (const gr of r.goldResults) {
    for (const t of buckets) t[gr.status]++
    const m = gr.matched
    const detail = m ? `  <- [${m.type}] "${m.value}" (${gr.quality})` : ''
    console.log(`${ICON[gr.status]} ${gr.status.padEnd(13)} ${gr.gold.type.padEnd(11)} "${gr.gold.value}"${detail}`)
  }
  if (r.extras.length) {
    console.log('  -- extra (not in gold): --')
    for (const e of r.extras) {
      for (const t of buckets) t.extras++
      console.log(`🔵 EXTRA          [${e.type}] "${e.value}" (x${e.count})`)

      const key = triageKey(file, e.type, e.value)
      const category = triage[key] === 'over-capture' ? 'over-capture' : 'noise'
      for (const t of buckets) {
        if (category === 'noise') t.noise++
        else t.overCapture++
      }
      extrasFlat.push({
        file,
        gold: r.contract,
        type: e.type,
        value: e.value,
        count: e.count,
        context: findContext(r.sourceText, e.value),
        category,
      })
    }
  }
}

extrasFlat.sort((a, b) => {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1
  if (a.category !== b.category) return a.category === 'noise' ? -1 : 1
  return 0
})
writeFileSync('out-extras.json', JSON.stringify(extrasFlat, null, 2))

// ---- headline metric ----
// Recall-first score (spec prioritises recall): a full HIT = 1 point, a PARTIAL
// (right entity, truncated value) = 0.5, MISS/TYPE_MISMATCH = 0. Denominator is
// the gold entity count. Extras (false positives) are reported separately as a
// precision signal — they are NOT subtracted, so the two numbers move independently.
function printSummary(label, t) {
  const goldTotal = t.HIT + t.PARTIAL + t.TYPE_MISMATCH + t.MISS
  console.log(`\n— ${label} —`)
  console.log(`HIT: ${t.HIT}  PARTIAL: ${t.PARTIAL}  TYPE_MISMATCH: ${t.TYPE_MISMATCH}  MISS: ${t.MISS}`)
  console.log(`GOLD ENTITIES: ${goldTotal}`)
  if (goldTotal) {
    const recall = (t.HIT + 0.5 * t.PARTIAL) / goldTotal
    const strict = t.HIT / goldTotal
    console.log(`DETECTION SCORE (recall, PARTIAL=0.5): ${(recall * 100).toFixed(1)}%`)
    console.log(`STRICT SCORE (full HITs only):        ${(strict * 100).toFixed(1)}%`)
  } else {
    console.log('DETECTION SCORE (recall, PARTIAL=0.5): n/a')
    console.log('STRICT SCORE (full HITs only):        n/a')
  }
  console.log(`FALSE POSITIVES (extras): ${t.extras}`)
  console.log(`  of which: noise ${t.noise} / over-capture ${t.overCapture}`)
  const noisePer1k = t.tokens > 0 ? t.noise / (t.tokens / 1000) : null
  console.log(`NOISE per 1000 tokens: ${noisePer1k !== null ? noisePer1k.toFixed(2) : 'n/a'}`)
}

console.log('\n' + '#'.repeat(70))
printSummary('DEV', totals.dev)
printSummary('HOLDOUT', totals.holdout)
printSummary('COMBINED', totals.combined)

console.log('\n' + '#'.repeat(70))
console.log('TOTALS[dev]:', JSON.stringify(totals.dev))
console.log('TOTALS[holdout]:', JSON.stringify(totals.holdout))
console.log('TOTALS[combined]:', JSON.stringify(totals.combined))
