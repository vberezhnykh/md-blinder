// Compares gold-standard entities against what the app actually detected.
// Usage: node scripts/score.mjs <e2e.json>
import { readFileSync, readdirSync } from 'node:fs'

const e2e = JSON.parse(readFileSync(process.argv[2], 'utf8'))

// Load every gold/contract-*.json and index it by the files it covers.
const fileToGold = {}
for (const name of readdirSync('test-samples/gold')) {
  if (!/^contract-.*\.json$/.test(name)) continue
  const gold = JSON.parse(readFileSync(`test-samples/gold/${name}`, 'utf8'))
  for (const f of gold.files) fileToGold[f] = gold
}

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
  }
}

// ---- print human-readable report ----
const ICON = { HIT: '✅', PARTIAL: '🟡', TYPE_MISMATCH: '🟠', MISS: '🔴' }
let totals = { HIT: 0, PARTIAL: 0, TYPE_MISMATCH: 0, MISS: 0, extras: 0 }

for (const [file, r] of Object.entries(report)) {
  console.log('\n' + '='.repeat(70))
  console.log(file)
  console.log(r.contract)
  console.log(`finished=${r.finished} nerNotice=${r.nerNotice}${r.error ? ' ERROR=' + r.error : ''} detected=${r.detectedCount}`)
  console.log('-'.repeat(70))
  for (const gr of r.goldResults) {
    totals[gr.status === 'HIT' ? 'HIT' : gr.status === 'PARTIAL' ? 'PARTIAL' : gr.status === 'TYPE_MISMATCH' ? 'TYPE_MISMATCH' : 'MISS']++
    const m = gr.matched
    const detail = m ? `  <- [${m.type}] "${m.value}" (${gr.quality})` : ''
    console.log(`${ICON[gr.status]} ${gr.status.padEnd(13)} ${gr.gold.type.padEnd(11)} "${gr.gold.value}"${detail}`)
  }
  if (r.extras.length) {
    console.log('  -- extra (not in gold): --')
    for (const e of r.extras) {
      totals.extras++
      console.log(`🔵 EXTRA          [${e.type}] "${e.value}" (x${e.count})`)
    }
  }
}

console.log('\n' + '#'.repeat(70))
console.log('TOTALS:', JSON.stringify(totals))
