/**
 * signal-normalizer.js — Signal Normalization Layer
 *
 * Converts all raw signals from the four intelligence modules into a
 * standardized format. Enforces the GCC-centric filter and validates
 * that every signal conforms to the schema.
 *
 * NORMALIZED FORMAT:
 * {
 *   signalType: "MACRO | MARKET | GEO | AI",
 *   region: "KSA | UAE | QA | GCC",
 *   impact: "LOW | MEDIUM | HIGH",
 *   confidence: 0-1,
 *   summary: "",
 *   source: ""
 * }
 *
 * GCC-CENTRIC FILTER:
 *   - Discards signals with no GCC relevance
 *   - Discards global news with no regional impact
 *   - Only includes if impact >= MEDIUM && relevanceToGCC === true
 *
 * @module signal-normalizer
 */

// ── VALID VALUES ─────────────────────────────────────────────────────────

const VALID_SIGNAL_TYPES = ["MACRO", "MARKET", "GEO", "AI"];
const VALID_REGIONS = ["KSA", "UAE", "QA", "GCC"];
const VALID_IMPACTS = ["LOW", "MEDIUM", "HIGH"];

// ── HELPER: Validate a single signal ────────────────────────────────────

/**
 * Validate that a signal conforms to the normalized schema.
 * Returns { valid: boolean, errors: string[] }
 */
function validateSignal(signal) {
  const errors = [];

  if (!signal || typeof signal !== "object") {
    return { valid: false, errors: ["Signal is not an object"] };
  }

  if (!VALID_SIGNAL_TYPES.includes(signal.signalType)) {
    errors.push(
      `Invalid signalType "${signal.signalType}". Must be one of: ${VALID_SIGNAL_TYPES.join(", ")}`
    );
  }

  if (!VALID_REGIONS.includes(signal.region)) {
    errors.push(
      `Invalid region "${signal.region}". Must be one of: ${VALID_REGIONS.join(", ")}`
    );
  }

  if (!VALID_IMPACTS.includes(signal.impact)) {
    errors.push(
      `Invalid impact "${signal.impact}". Must be one of: ${VALID_IMPACTS.join(", ")}`
    );
  }

  if (
    typeof signal.confidence !== "number" ||
    isNaN(signal.confidence) ||
    signal.confidence < 0 ||
    signal.confidence > 1
  ) {
    errors.push(
      `Invalid confidence "${signal.confidence}". Must be a number between 0 and 1.`
    );
  }

  if (!signal.summary || typeof signal.summary !== "string" || signal.summary.trim().length === 0) {
    errors.push("Missing or empty 'summary' field");
  }

  if (!signal.source || typeof signal.source !== "string" || signal.source.trim().length === 0) {
    errors.push("Missing or empty 'source' field");
  }

  return { valid: errors.length === 0, errors };
}

// ── GCC-CENTRIC FILTER ───────────────────────────────────────────────────

/**
 * Apply the GCC-centric filter rule.
 *
 * Rule:
 *   ❌ Discard signals with:
 *     - no GCC relevance (relevanceToGCC === false)
 *     - global news with no regional impact
 *
 *   Only include if:
 *     - impact >= MEDIUM
 *     - relevanceToGCC === true
 *
 * GCC relevance is determined by:
 *   - region is KSA, UAE, QA, or GCC (always relevant)
 *   - signal explicitly mentions GCC relevance
 *
 * @param {Object} signal - The signal to evaluate
 * @returns {boolean} Whether the signal passes the GCC-centric filter
 */
function passesGCCFilter(signal) {
  // Region-based filter: KSA, UAE, QA, and GCC are always relevant
  if (["KSA", "UAE", "QA", "GCC"].includes(signal.region)) {
    // Still need impact >= MEDIUM
    return signal.impact !== "LOW";
  }

  // If region is something else (global), check for explicit GCC relevance
  // This is a soft field we look for in the summary
  const summary = (signal.summary || "").toLowerCase();
  const gccKeywords = [
    "gcc", "gulf", "saudi", "uae", "dubai", "abu dhabi",
    "qatar", "doha", "riyadh", "jeddah", "oman", "muscat",
    "kuwait", "bahrain", "manama", "tadawul", "adx",
    "opec", "aramco", "adnoc", "pif", "mubadala", "qia",
  ];

  const hasGCCRelevance = gccKeywords.some((kw) => summary.includes(kw));

  if (!hasGCCRelevance) {
    return false; // No GCC relevance — discard
  }

  // Has GCC relevance and impact >= MEDIUM
  return signal.impact !== "LOW";
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────

/**
 * Normalize an array of raw signals from any intelligence module.
 *
 * Steps:
 *   1. Validate each signal against the schema
 *   2. Apply GCC-centric filter
 *   3. Return only clean, validated, filtered signals
 *
 * @param {Array<Object>} rawSignals - Array of signals from any signal generator
 * @param {Object} [options]
 * @param {boolean} [options.applyGCCFilter=true] - Whether to apply the GCC-centric filter
 * @returns {{ normalized: Array<Object>, rejected: Array<{signal: Object, reason: string}>, stats: Object }}
 */
export function normalizeSignals(rawSignals, options = {}) {
  const { applyGCCFilter = true } = options;

  if (!Array.isArray(rawSignals)) {
    return {
      normalized: [],
      rejected: [],
      stats: { total: 0, valid: 0, filtered: 0, invalid: 0 },
    };
  }

  const normalized = [];
  const rejected = [];
  let invalidCount = 0;
  let filteredCount = 0;

  for (const signal of rawSignals) {
    // Step 1: Validate schema
    const validation = validateSignal(signal);
    if (!validation.valid) {
      invalidCount++;
      rejected.push({
        signal,
        reason: `Schema validation failed: ${validation.errors.join("; ")}`,
      });
      continue;
    }

    // Step 2: Apply GCC-centric filter
    if (applyGCCFilter && !passesGCCFilter(signal)) {
      filteredCount++;
      rejected.push({
        signal,
        reason: `GCC-centric filter: impact too low (${signal.impact}) or no GCC relevance`,
      });
      continue;
    }

    // Passed all checks — add to normalized output
    normalized.push({
      signalType: signal.signalType,
      region: signal.region,
      impact: signal.impact,
      confidence: signal.confidence,
      summary: signal.summary,
      source: signal.source,
    });
  }

  return {
    normalized,
    rejected,
    stats: {
      total: rawSignals.length,
      valid: normalized.length,
      filtered: filteredCount,
      invalid: invalidCount,
    },
  };
}

/**
 * Apply additional weighting to a normalized signal.
 *
 * WEIGHTING RULE (from operator.js):
 *   if (signal.impact === "HIGH" && signal.region === "GCC") {
 *     weight *= 1.5;
 *   }
 *
 * @param {Object} signal - A normalized signal object
 * @param {number} baseWeight - Default weight (default: 1.0)
 * @returns {{ signal: Object, weight: number, boosted: boolean }}
 */
export function applySignalWeight(signal, baseWeight = 1.0) {
  let weight = baseWeight;
  let boosted = false;

  // GCC HIGH impact signals get 1.5x weight
  if (signal.impact === "HIGH" && signal.region === "GCC") {
    weight *= 1.5;
    boosted = true;
  }

  return { signal, weight: Math.round(weight * 100) / 100, boosted };
}
