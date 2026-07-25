// C3: NER confirmation-threshold sweep. Reads ONE e2e-detect run that captured
// per-entity NER scores (the `scored` field, from IndexedDB) and reclassifies
// confirmed-vs-below-threshold OFFLINE for several thresholds — no need to
// re-run the (slow) NER pipeline once per threshold. For each threshold T a
// group is "confirmed" (auto-anonymized) when it is structural (score === null)
// or its NER score >= T; everything else drops below the line into the B1 gray
// zone. Recall/noise are then scored exactly like scripts/score.mjs.
//
// Usage: node scripts/threshold-sweep.mjs <e2e.json>  (defaults to out-dev.json)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { norm, scoreDetections } from './scoring-core.mjs'

const inputPath = process.argv[2] || 'out-dev.json'
const e2e = JSON.parse(readFileSync(inputPath, 'utf8'))

const THRESHOLDS = [0.2, 0.25, 0.3, 0.35, 0.4]

let triage = {}
try {
  triage = JSON.parse(readFileSync('test-samples/extras-triage.json', 'utf8'))
} catch {
  triage = {}
}

const fileToGold = {}
for (const name of readdirSync('test-samples/gold')) {
  if (!/^contract-.*\.json$/.test(name)) continue
  const gold = JSON.parse(readFileSync(`test-samples/gold/${name}`, 'utf8'))
  for (const f of gold.files) fileToGold[f] = gold
}
const manifest = JSON.parse(readFileSync('test-samples/manifest.json', 'utf8'))
const fileToSet = {}
for (const doc of manifest.documents) fileToSet[doc.path.split('/').pop()] = doc.set

const triageKey = (file, type, value) => `${file}|${type}|${norm(value)}`

// Score one threshold over the whole (dev) corpus. Returns aggregate totals.
function scoreThreshold(T) {
  const totals = { HIT: 0, PARTIAL: 0, TYPE_MISMATCH: 0, MISS: 0, extras: 0, noise: 0, overCapture: 0, gold: 0 }
  for (const [file, res] of Object.entries(e2e)) {
    const gold = fileToGold[file]
    if (!gold) continue
    if (fileToSet[file] && fileToSet[file] !== 'dev') continue
    // Confirmed set at threshold T: structural (no score) OR NER score >= T.
    const detected = (res.scored || []).filter((e) => e.score === null || e.score >= T)
    totals.gold += gold.entities.length
    const { goldResults, extras } = scoreDetections(gold.entities, detected, res.sourceText)
    for (const gr of goldResults) totals[gr.status]++
    for (const de of extras) {
      totals.extras++
      const category = triage[triageKey(file, de.type, de.value)] === 'over-capture' ? 'over-capture' : 'noise'
      if (category === 'noise') totals.noise++
      else totals.overCapture++
    }
  }
  return totals
}

const rows = THRESHOLDS.map((T) => {
  const t = scoreThreshold(T)
  const recall = (t.HIT + 0.5 * t.PARTIAL) / t.gold
  const strict = t.HIT / t.gold
  return { T, recall, strict, ...t }
})

const pct = (x) => (x * 100).toFixed(1) + '%'
const header = '| Threshold | Recall | Strict | HIT | PART | TYPE | MISS | Extras | Noise | Over-capture |'
const sep = '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
const bodyLines = rows.map(
  (r) =>
    `| **${r.T.toFixed(2)}** | ${pct(r.recall)} | ${pct(r.strict)} | ${r.HIT} | ${r.PARTIAL} | ${r.TYPE_MISMATCH} | ${r.MISS} | ${r.extras} | ${r.noise} | ${r.overCapture} |`,
)

console.log(`\nNER confirmation-threshold sweep — DEV corpus (gold ${rows[0].gold})`)
console.log(`source: ${inputPath}\n`)
console.log(header)
console.log(sep)
for (const l of bodyLines) console.log(l)

const md = `# C3 — NER confirmation-threshold sweep (LOCAL ONLY, gitignored)

Offline sweep of \`NER_CONFIRM_THRESHOLD\` over the 14-doc DEV corpus from a single
e2e-detect run (\`${inputPath}\`) that captured per-group NER scores. A group is
confirmed (auto-anonymized) when structural or NER score >= T; below T it drops
into the B1 gray zone (reviewed manually, not auto-redacted). Recall/noise scored
exactly as \`scripts/score.mjs\`. Regenerate: \`node scripts/threshold-sweep.mjs ${inputPath}\`.

DEV gold entities: ${rows[0].gold}.

${header}
${sep}
${bodyLines.join('\n')}

**Reading it:** lower T ⇒ more NER spans auto-confirmed ⇒ higher recall but more
noise-extras; higher T ⇒ fewer false positives, more real spans deferred to the
gray zone (B1 still surfaces them for manual review, so a higher T trades auto-
recall for precision, not outright misses). Structural (regex) detections are
unaffected by T. The current shipped value is 0.30 (\`src/lib/anonymize/config.ts\`).
`
writeFileSync('test-samples/threshold-report.md', md)
console.log('\n-> wrote test-samples/threshold-report.md')
