// Compares gold-standard entities against what the app actually detected.
// Usage: node scripts/score.mjs <e2e.json>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { norm, scoreDetections, scoreOccurrenceCoverage } from './scoring-core.mjs'

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
  // Match against confirmed (non-candidate) scored entities only — these now
  // carry `positions`, needed for ANCHOR matching. res.entities is kept below
  // purely for reference/display, not for scoring.
  const detected = (res.scored || []).filter((e) => !e.candidate)
  const { goldResults, extras } = scoreDetections(gold.entities, detected, res.sourceText)
  const occurrenceCoverage = scoreOccurrenceCoverage(gold.entities, res.scored || [], res.sourceText, res.anonymizedText)

  report[file] = {
    contract: gold.title,
    finished: res.finished,
    error: res.error,
    nerNotice: res.nerNotice,
    detectedCount: detected.length,
    goldResults,
    extras,
    occurrenceCoverage,
    sourceText: res.sourceText ?? null,
  }
}

// ---- print human-readable report ----
const ICON = { HIT: '✅', PARTIAL: '🟡', TYPE_MISMATCH: '🟠', MISS: '🔴' }
function makeTotals() {
  return { HIT: 0, PARTIAL: 0, TYPE_MISMATCH: 0, MISS: 0, extras: 0, noise: 0, overCapture: 0, tokens: 0, anchored: 0,
    occurrenceTotal: 0, occurrenceFull: 0, occurrencePartial: 0, occurrenceMissed: 0, unanchoredGold: 0,
    unavailableOccurrenceFiles: 0, residualFiles: 0, residualOccurrences: 0 }
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
  const coverage = r.occurrenceCoverage
  for (const t of buckets) {
    t.occurrenceTotal += coverage.summary.total
    t.occurrenceFull += coverage.summary.full
    t.occurrencePartial += coverage.summary.partial
    t.occurrenceMissed += coverage.summary.missed
    t.unanchoredGold += coverage.summary.unanchored
    if (!coverage.available) t.unavailableOccurrenceFiles++
    if (coverage.residual !== null) { t.residualFiles++; t.residualOccurrences += coverage.residual.length }
  }
  console.log(`SOURCE OCCURRENCES: full=${coverage.summary.full} partial=${coverage.summary.partial} missed=${coverage.summary.missed}; UNANCHORED GOLD ENTITIES=${coverage.summary.unanchored}`)
  if (!coverage.available) console.log(`OCCURRENCE RECALL UNAVAILABLE: source=${coverage.sourceAvailable}, missing activation flags=${coverage.missingActiveFlags}; rerun e2e-detect`)
  if (coverage.invalidPositions) console.log(`INVALID ACTIVE POSITIONS IGNORED: ${coverage.invalidPositions}`)
  if (coverage.residual !== null) console.log(`LITERAL GOLD OCCURRENCES REMAINING IN PREVIEW: ${coverage.residual.length}`)

  for (const gr of r.goldResults) {
    for (const t of buckets) t[gr.status]++
    // Legacy entity-level metric: HIT via a first-anchor or normalized exact match.
    // (ANCHOR, morphology-independent) or an exact norm() match (EXACT) —
    // This is NOT occurrence coverage. Company-core / person-initials HITs don't count here even
    // though they're also full HITs, since those rely on rule-based folding
    // rather than a direct textual/positional match.
    if (gr.status === 'HIT' && (gr.matchKind === 'anchor' || gr.matchKind === 'exact')) {
      for (const t of buckets) t.anchored++
    }
    const m = gr.matched
    const detail = m ? `  <- [${m.type}] "${m.value}" (${gr.quality}${gr.matchKind ? `/${gr.matchKind}` : ''})` : ''
    console.log(`${ICON[gr.status]} ${gr.status.padEnd(13)} ${gr.gold.type.padEnd(11)} "${gr.gold.value}"${detail}`)
  }
  if (r.extras.length) {
    console.log('  -- extra (not in gold): --')
    for (const e of r.extras) {
      for (const t of buckets) t.extras++
      // detected now comes from res.scored (has `positions`, not a UI-rendered
      // `count`), so derive an occurrence count from positions when present.
      const occCount = e.count ?? (Array.isArray(e.positions) ? e.positions.length : '?')
      console.log(`🔵 EXTRA          [${e.type}] "${e.value}" (x${occCount})`)

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
        count: occCount,
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
    const anchoredCoverage = t.anchored / goldTotal
    console.log(`DETECTION SCORE (recall, PARTIAL=0.5): ${(recall * 100).toFixed(1)}%`)
    console.log(`STRICT SCORE (full HITs only):        ${(strict * 100).toFixed(1)}%`)
    console.log(`LEGACY ENTITY ANCHOR/EXACT HIT RATE: ${(anchoredCoverage * 100).toFixed(1)}%`)
  } else {
    console.log('DETECTION SCORE (recall, PARTIAL=0.5): n/a')
    console.log('STRICT SCORE (full HITs only):        n/a')
    console.log('LEGACY ENTITY ANCHOR/EXACT HIT RATE: n/a')
  }
  const occurrenceRecall = t.occurrenceTotal && !t.unavailableOccurrenceFiles ? t.occurrenceFull / t.occurrenceTotal : null
  console.log(`STRICT ACTIVE OCCURRENCE RECALL: ${occurrenceRecall === null ? 'n/a' : `${(occurrenceRecall * 100).toFixed(1)}%`}`)
  console.log(`  SOURCE OCCURRENCES: ${t.occurrenceTotal}; FULL ${t.occurrenceFull}, PARTIAL ${t.occurrencePartial}, MISSED ${t.occurrenceMissed}`)
  console.log(`  UNANCHORED GOLD ENTITIES: ${t.unanchoredGold}; FILES WITH UNAVAILABLE INPUT: ${t.unavailableOccurrenceFiles}`)
  console.log(`  RESIDUAL LITERAL OCCURRENCES IN PREVIEW: ${t.residualFiles ? t.residualOccurrences : 'n/a'} (preview captured in ${t.residualFiles} files)`)
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
console.log('\nOccurrence recall covers exact gold value/variants/aliases anchored in the captured source, with normalized whitespace and case. Full means every character of the source span is covered by active positions; partials earn no credit. Unanchored gold and missing capture flags are explicit. Image removal and unlisted spellings are not proved by this metric; no residual literal matches is not a privacy guarantee.')
