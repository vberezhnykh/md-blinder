// Shared scoring logic for score.mjs and threshold-sweep.mjs.
//
// scoreDetections() does a mutually-exclusive (one-to-one) assignment between
// gold entities and detected entities, picking the strongest available match
// tier for each pair, then greedily assigning highest-priority pairs first so
// a single detection can never double-count against multiple gold entities
// (BUG-1) and a full-value match of the WRONG type can never outrank a
// partial match of the RIGHT type (BUG-2 — type-correctness is the primary
// sort key, tier strength only breaks ties within it).

export function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function tokens(s) {
  return new Set(norm(s).split(' ').filter(Boolean))
}

export function jaccard(a, b) {
  const A = tokens(a),
    B = tokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

// returns 'full' | 'partial' | null — existing substring/jaccard logic.
function valueMatch(goldVal, detVal) {
  const g = norm(goldVal),
    d = norm(detVal)
  if (!g || !d) return null
  if (g === d) return 'full'
  if (g.includes(d) || d.includes(g)) return 'partial'
  if (jaccard(g, d) >= 0.5) return 'partial'
  return null
}

// Organization-legal-form prefixes, for COMPANY-CORE. norm() already strips
// punctuation/quotes (« » „ " etc. all fall outside \p{L}\p{N}), so this only
// needs to drop the leading legal-form word(s).
const ORG_PREFIXES = [
  'ооо', 'оао', 'зао', 'пао', 'ао', 'ип', 'нко', 'фгуп', 'гуп',
  'llc', 'ltd', 'inc', 'plc', 'gmbh', 'corp', 'co',
]

function companyCore(value) {
  const v = norm(value)
  if (!v) return ''
  const words = v.split(' ').filter(Boolean)
  while (words.length && ORG_PREFIXES.includes(words[0])) words.shift()
  return words.join(' ')
}

// PERSON-INITIALS: does `initialsValue` look like an initials form of
// `fullValue`? Accepts both "Фамилия И.О." and "И.О. Фамилия" orderings.
// Requires: one token in the initials form is a whole word (the surname)
// that also appears as a whole word in the full form, AND every other
// "token" in the initials form is a single letter that matches the first
// letter of one of the (unused) words in the full form, in order.
function personInitialsMatch(fullValue, initialsValue) {
  const full = norm(fullValue).split(' ').filter(Boolean)
  const other = norm(initialsValue).split(' ').filter(Boolean)
  if (full.length < 2 || other.length < 2) return false

  // Split `other` into single-letter tokens (initials) and multi-letter
  // tokens (candidate surname). Handles "а.а." having been normalized to
  // "а а" by norm(), and "Окишев" staying a whole word.
  const initials = other.filter((t) => t.length === 1)
  const surnameCandidates = other.filter((t) => t.length > 1)
  if (initials.length < 1 || surnameCandidates.length !== 1) return false
  const surname = surnameCandidates[0]

  const fullIdx = full.indexOf(surname)
  if (fullIdx === -1) return false
  const remaining = full.filter((_, i) => i !== fullIdx)
  if (remaining.length < initials.length) return false

  // Every initial must match the first letter of a distinct remaining word,
  // in the same order they appear (given names then patronymic, or vice
  // versa — we don't enforce which, just order-consistency).
  let ri = 0
  for (const init of initials) {
    while (ri < remaining.length && remaining[ri][0] !== init) ri++
    if (ri >= remaining.length) return false
    ri++
  }
  return true
}

// Build a regex that matches `value` in source text with whitespace
// collapsed/normalized, so morphological gold `variants` anchor even when
// line breaks / multiple spaces sit between tokens. Returns null if `value`
// has no letters/digits to anchor on.
function buildAnchorRegex(value) {
  const raw = (value || '').trim()
  if (!raw) return null
  const parts = raw.split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(escaped.join('\\s+'), 'iu')
}

// Find the [start,end) span in sourceText of the first occurrence of any of
// `candidates` (gold.value + gold.variants), matching case-insensitively with
// normalized whitespace. Returns null if none found.
function findAnchorSpan(sourceText, candidates) {
  if (!sourceText) return null
  for (const cand of candidates) {
    const re = buildAnchorRegex(cand)
    if (!re) continue
    const m = re.exec(sourceText)
    if (m) return { start: m.index, end: m.index + m[0].length }
  }
  return null
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end
}

const TIER_RANK = { anchor: 4, exact: 3, 'company-core': 2, 'person-initials': 2, partial: 1 }

// Compute the best match tier between one gold entity and one detection.
// Returns null if no tier matches, else { tier, quality } where
// quality is 'full' for every tier except 'partial'.
function bestTier(gold, det, anchorSpan) {
  const candidates = [gold.value, ...(gold.variants || [])]

  // a) ANCHOR — positional, morphology-independent.
  if (anchorSpan && Array.isArray(det.positions)) {
    for (const pos of det.positions) {
      if (pos && typeof pos.start === 'number' && typeof pos.end === 'number' && overlaps(pos, anchorSpan)) {
        return { tier: 'anchor', quality: 'full' }
      }
    }
  }

  // b) EXACT — norm equality against value or any variant.
  for (const cand of candidates) {
    if (norm(cand) && norm(cand) === norm(det.value)) return { tier: 'exact', quality: 'full' }
  }

  // c) COMPANY-CORE — strip legal-form wrapper, compare cores.
  if (gold.type === 'COMPANY' && det.type === 'COMPANY') {
    const detCore = companyCore(det.value)
    if (detCore) {
      for (const cand of candidates) {
        const goldCore = companyCore(cand)
        if (goldCore && goldCore === detCore) return { tier: 'company-core', quality: 'full' }
      }
    }
  }

  // d) PERSON-INITIALS — initials <-> full name, both orderings.
  if (gold.type === 'PERSON' && det.type === 'PERSON') {
    for (const cand of candidates) {
      if (personInitialsMatch(cand, det.value) || personInitialsMatch(det.value, cand)) {
        return { tier: 'person-initials', quality: 'full' }
      }
    }
  }

  // e) PARTIAL — substring / jaccard on value or any variant.
  for (const cand of candidates) {
    if (valueMatch(cand, det.value) === 'partial') return { tier: 'partial', quality: 'partial' }
  }
  return null
}

/**
 * @param {Array} goldEntities - gold.entities from a contract-*.json
 * @param {Array} detected - [{ type, value, positions?: [{start,end}], count?, score? }]
 * @param {string} sourceText - full document text, for ANCHOR resolution
 * @returns {{ goldResults: Array, extras: Array }}
 */
export function scoreDetections(goldEntities, detected, sourceText) {
  const dets = detected.slice()

  // Precompute an anchor span (in sourceText) per gold entity, once.
  const anchorSpans = goldEntities.map((ge) => findAnchorSpan(sourceText, [ge.value, ...(ge.variants || [])]))

  // Build every candidate (gold, det) pair that has *some* match tier.
  const pairs = []
  goldEntities.forEach((ge, gi) => {
    dets.forEach((de, di) => {
      const m = bestTier(ge, de, anchorSpans[gi])
      if (!m) return
      const typeOk = de.type === ge.type
      pairs.push({ gi, di, tier: m.tier, quality: m.quality, typeOk })
    })
  })

  // Sort: typeOk pairs first, then by tier strength (anchor > exact >
  // company-core/person-initials > partial). This ordering is what fixes
  // BUG-2 — a correct-type PARTIAL always sorts before a wrong-type EXACT.
  pairs.sort((a, b) => {
    if (a.typeOk !== b.typeOk) return a.typeOk ? -1 : 1
    return TIER_RANK[b.tier] - TIER_RANK[a.tier]
  })

  const goldTaken = new Array(goldEntities.length).fill(false)
  const detTaken = new Array(dets.length).fill(false)
  const assignment = new Array(goldEntities.length).fill(null)

  // Pass 1: greedy one-to-one assignment among typeOk pairs (and any
  // wrong-type pairs interleaved below them by sort — those are skipped
  // here and revisited in pass 2 only if the gold is still free).
  for (const p of pairs) {
    if (!p.typeOk) continue
    if (goldTaken[p.gi] || detTaken[p.di]) continue
    goldTaken[p.gi] = true
    detTaken[p.di] = true
    assignment[p.gi] = p
  }

  // Pass 2: TYPE_MISMATCH fallback — only for gold entities still unassigned,
  // matched against detections still free, wrong type.
  for (const p of pairs) {
    if (p.typeOk) continue
    if (goldTaken[p.gi] || detTaken[p.di]) continue
    goldTaken[p.gi] = true
    detTaken[p.di] = true
    assignment[p.gi] = p
  }

  const goldResults = goldEntities.map((ge, gi) => {
    const p = assignment[gi]
    if (!p) return { gold: ge, status: 'MISS', matched: null, quality: null, matchKind: null }
    const det = dets[p.di]
    const status = !p.typeOk ? 'TYPE_MISMATCH' : p.quality === 'full' ? 'HIT' : 'PARTIAL'
    return { gold: ge, status, matched: det, quality: p.quality, matchKind: p.tier }
  })

  const extras = dets.filter((_, di) => !detTaken[di])

  return { goldResults, extras }
}

function goldSpellings(gold) {
  return [gold.value, ...(Array.isArray(gold.variants) ? gold.variants : []), ...(Array.isArray(gold.aliases) ? gold.aliases : [])]
    .filter((value) => typeof value === 'string' && /[\p{L}\p{N}]/u.test(value))
}

// Deliberately literal: aliases/morphological variants must be in the gold set.
// Do not infer a surname from a full name or count Ann inside Anna as an anchor.
function allAnchors(sourceText, spellings) {
  const spans = []
  for (const spelling of new Set(spellings)) {
    const raw = spelling.trim()
    const pattern = raw.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    const left = /^[\p{L}\p{N}]/u.test(raw) ? '(?<![\\p{L}\\p{N}])' : ''
    const right = /[\p{L}\p{N}]$/u.test(raw) ? '(?![\\p{L}\\p{N}])' : ''
    const re = new RegExp(`${left}${pattern}${right}`, 'giu')
    for (const match of sourceText.matchAll(re)) spans.push({ start: match.index, end: match.index + match[0].length })
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const unique = []
  let longestEnd = -1
  for (const span of spans) {
    // A contained short alias describes the same occurrence as a longer name.
    // Crossing matches remain separate: merging a chain of them could collapse
    // several repeated full names into one occurrence and distort the denominator.
    if (span.end <= longestEnd) continue
    unique.push({ ...span })
    longestEnd = span.end
  }
  return unique
}

function collectGoldOccurrences(goldEntities, sourceText) {
  const bySpan = new Map()
  const unanchored = []
  goldEntities.forEach((gold, goldIndex) => {
    const spans = allAnchors(sourceText, goldSpellings(gold))
    if (!spans.length) unanchored.push({ goldIndex, gold })
    for (const span of spans) {
      const key = `${span.start}:${span.end}`
      const previous = bySpan.get(key)
      if (previous) previous.goldIndices.push(goldIndex)
      else bySpan.set(key, { ...span, value: sourceText.slice(span.start, span.end), goldIndices: [goldIndex] })
    }
  })
  return { occurrences: [...bySpan.values()].sort((a, b) => a.start - b.start || b.end - a.end), unanchored }
}

/**
 * Strict occurrence recall, independent of legacy entity matching/type accuracy.
 * Every source occurrence of a gold value/variant/alias must be fully covered by
 * the union of valid active anonymize===true && !dismissed ranges. No fuzzy match,
 * first-occurrence shortcut, or value-only detection can earn coverage.
 *
 * Unanchored gold entities are reported separately, never silently treated as
 * covered or as one inferred occurrence. Missing activation flags in old capture
 * files make recall unavailable. Residual literal matches in an optional preview
 * are a separate check; their absence is not proof of complete anonymization.
 */
export function scoreOccurrenceCoverage(goldEntities, detected, sourceText, anonymizedText) {
  const sourceAvailable = typeof sourceText === 'string'
  const text = sourceAvailable ? sourceText : ''
  const { occurrences, unanchored } = collectGoldOccurrences(goldEntities, text)
  const missingActiveFlags = detected.filter((entity) => typeof entity.anonymize !== 'boolean').length
  let invalidPositions = 0
  const active = []
  for (const entity of detected) {
    if (entity.anonymize !== true || entity.dismissed) continue
    for (const position of Array.isArray(entity.positions) ? entity.positions : []) {
      if (!position || !Number.isInteger(position.start) || !Number.isInteger(position.end) ||
          position.start < 0 || position.end <= position.start || position.end > text.length) {
        invalidPositions++
        continue
      }
      active.push({ start: position.start, end: position.end })
    }
  }
  active.sort((a, b) => a.start - b.start || b.end - a.end)
  const covered = []
  for (const position of active) {
    const previous = covered.at(-1)
    if (previous && position.start <= previous.end) previous.end = Math.max(previous.end, position.end)
    else covered.push({ ...position })
  }

  let firstCover = 0
  const results = occurrences.map((occurrence) => {
    while (firstCover < covered.length && covered[firstCover].end <= occurrence.start) firstCover++
    let coveredChars = 0
    for (let index = firstCover; index < covered.length && covered[index].start < occurrence.end; index++) {
      coveredChars += Math.max(0, Math.min(occurrence.end, covered[index].end) - Math.max(occurrence.start, covered[index].start))
    }
    const status = coveredChars === occurrence.end - occurrence.start ? 'FULL' : coveredChars > 0 ? 'PARTIAL' : 'MISSED'
    return { ...occurrence, status, coveredChars }
  })
  const full = results.filter((occurrence) => occurrence.status === 'FULL').length
  const partial = results.filter((occurrence) => occurrence.status === 'PARTIAL').length
  const missed = results.length - full - partial
  const available = sourceAvailable && missingActiveFlags === 0
  return {
    available,
    sourceAvailable,
    missingActiveFlags,
    invalidPositions,
    occurrences: results,
    unanchored,
    summary: { total: results.length, full, partial, missed, unanchored: unanchored.length,
      recall: available && results.length ? full / results.length : null },
    residual: typeof anonymizedText === 'string'
      ? collectGoldOccurrences(goldEntities, anonymizedText).occurrences
      : null,
  }
}
