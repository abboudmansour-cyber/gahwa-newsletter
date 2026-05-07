/**
 * insight-synthesizer.js — Strategic GCC Hypothesis Engine
 *
 * UPGRADES the system from "reporting + tracking narratives"
 * to "generating structured strategic hypotheses about GCC developments."
 *
 * This is NOT speculative fiction. Every insight is grounded in:
 *   - Fused signals (from fusion-engine.js)
 *   - Narrative memory (newsletter-history.json + editorial decisions)
 *   - Pre-filtered, editorially-approved stories only
 *
 * CORE RULES (non-negotiable):
 *   1. Every insight REQUIRES at least 2 independent signals
 *   2. GCC relevance MUST be HIGH
 *   3. Evidence must be time-bound (recent or recurring trend)
 *   4. No speculation without signals
 *   5. No geopolitical guesswork
 *   6. No global-only interpretations
 *
 * OUTPUT: 2–4 structured hypotheses per run
 *
 * @module insight-synthesizer
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

// ── PATHS ─────────────────────────────────────────────────────────────────

const INSIGHT_STORE_PATH = path.join(ROOT, "operator", "logs", "insights.json");
const MEMORY_PATH = path.join(ROOT, "operator", "memory", "newsletter-history.json");
const EDITORIAL_LOG_PATH = path.join(ROOT, "operator", "logs", "editorial-decisions.json");

// ── INSIGHT TYPE DEFINITIONS ──────────────────────────────────────────────

const INSIGHT_TYPES = {
  MACRO_TREND: "MACRO_TREND",
  MARKET_SHIFT: "MARKET_SHIFT",
  GEO_STRATEGY: "GEO_STRATEGY",
};

// ── STATUS TRACKING ───────────────────────────────────────────────────────

const INSIGHT_STATUS = {
  EMERGING: "EMERGING",
  CONFIRMED: "CONFIRMED",
  VALIDATED: "VALIDATED",
  WEAKENING: "WEAKENING",
  DISCARDED: "DISCARDED",
};

// ═══════════════════════════════════════════════════════════════════════════
// HYPOTHESIS PATTERNS — Signal-driven interpretation models
// ═══════════════════════════════════════════════════════════════════════════
//
// Each pattern defines HOW to interpret a set of signals into a structured
// hypothesis. Patterns are NOT free-form reasoning — they are fixed templates
// that require specific signal conditions to trigger.
//
// A pattern fires when its preconditions (signal count, types, thresholds)
// are met. This prevents speculation: a hypothesis only exists when the
// signals structurally support it.
//
// ═══════════════════════════════════════════════════════════════════════════

const HYPOTHESIS_PATTERNS = [
  // ── Pattern 1: Sovereign Digital Independence ─────────────────────
  // Triggered by: AI/HIGH signals + Macro/HIGH sovereign fund activity
  {
    id: "sovereign_digital_independence",
    name: "Sovereign Digital Independence",
    description:
      "GCC states accelerating domestic AI infrastructure to reduce foreign tech dependency",
    type: INSIGHT_TYPES.GEO_STRATEGY,
    preconditions: {
      requiredSignalTypes: ["AI"],
      minAiSignals: 1,
      minMacroSignals: 1,
      minHighImpact: 2,
      gccRegionRequired: true,
    },
    buildHypothesis: (signals, clusters) => {
      const aiSignals = signals.filter((s) => s.signalType === "AI" && s.impact === "HIGH");
      const macroSignals = signals.filter(
        (s) => s.signalType === "MACRO" && (s.region === "GCC" || s.region === "KSA") && s.impact === "HIGH"
      );
      const supportingSignals = [...aiSignals, ...macroSignals].map((s) => s.summary);

      // Default hypothesis if not enough info
      if (aiSignals.length === 0) return null;

      const topAi = aiSignals[0];
      const topMacro = macroSignals.length > 0 ? macroSignals[0] : null;

      const hypothesis = topMacro
        ? `GCC sovereign digital infrastructure push is accelerating — ${topAi.summary.split("—")[0]?.trim() || "AI infrastructure investment"} paired with ${topMacro.summary.split("—")[0]?.trim() || "sovereign fund deployment"} signals strategic intent to establish digital independence from external technology dependencies.`
        : `GCC sovereign digital infrastructure investment — ${topAi.summary.split("—")[0]?.trim() || "AI infrastructure buildout"} indicates acceleration toward domestic technology sovereignty.`;

      return {
        hypothesis,
        supportingSignals: supportingSignals.slice(0, 4),
        derivedFrom: ["AI", "MACRO"],
      };
    },
  },

  // ── Pattern 2: Non-Oil Economic Shift ──────────────────────────────
  // Triggered by: MACRO non-oil GDP + MARKET sector rotation signals
  {
    id: "non_oil_economic_shift",
    name: "Non-Oil Economic Diversification Momentum",
    description:
      "GCC non-oil sector growth outpacing oil GDP, signaling structural economic transformation",
    type: INSIGHT_TYPES.MACRO_TREND,
    preconditions: {
      requiredSignalTypes: ["MACRO"],
      minMacroSignals: 1,
      minMarketSignals: 1,
      minHighImpact: 1,
      gccRegionRequired: false,
    },
    buildHypothesis: (signals, clusters) => {
      const nonOilSignals = signals.filter(
        (s) =>
          (s.signalType === "MACRO" || s.signalType === "MARKET") &&
          s.impact === "HIGH" &&
          (s.region === "GCC" || s.region === "KSA" || s.region === "UAE")
      );

      if (nonOilSignals.length < 2) return null;

      const supportingSignals = nonOilSignals.map((s) => s.summary);

      const hasNonOilGdp = nonOilSignals.some(
        (s) => s.summary.toLowerCase().includes("non-oil") || s.summary.toLowerCase().includes("diversification")
      );

      const hypothesis = hasNonOilGdp
        ? `GCC non-oil GDP expansion outpacing traditional oil revenue growth — sustained tourism, logistics, and manufacturing gains indicate structural economic diversification is decoupling growth from hydrocarbon dependence.`
        : `GCC capital markets and fiscal indicators show sector rotation away from hydrocarbon-dependent assets toward diversified economic drivers, suggesting the post-oil economic model is gaining structural momentum.`;

      return {
        hypothesis,
        supportingSignals: supportingSignals.slice(0, 4),
        derivedFrom: ["MACRO", "MARKET"],
      };
    },
  },

  // ── Pattern 3: Geopolitical Realignment ────────────────────────────
  // Triggered by: GEO signals + trade corridor shifts
  {
    id: "geopolitical_realignment",
    name: "GCC Geopolitical Realignment",
    description:
      "GCC states repositioning diplomatic and trade relationships amid shifting global power dynamics",
    type: INSIGHT_TYPES.GEO_STRATEGY,
    preconditions: {
      requiredSignalTypes: ["GEO"],
      minGeoSingals: 1,
      minMacroSignals: 1,
      minHighImpact: 1,
      gccRegionRequired: false,
    },
    buildHypothesis: (signals, clusters) => {
      const geoSingals = signals.filter(
        (s) => s.signalType === "GEO" && s.impact === "HIGH"
      );
      const macroSignals = signals.filter(
        (s) => s.signalType === "MACRO" && s.impact === "HIGH"
      );

      if (geoSingals.length === 0) return null;

      const supportingSignals = [...geoSingals, ...macroSignals.slice(0, 1)].map((s) => s.summary);

      const hasTradeCorridor = geoSingals.some(
        (s) => s.summary.toLowerCase().includes("trade") || s.summary.toLowerCase().includes("corridor")
      );

      const hypothesis = hasTradeCorridor
        ? `GCC states are actively diversifying strategic partnerships beyond traditional Western alliances — new trade corridors and diplomatic engagements signal a multipolar alignment strategy that prioritizes economic sovereignty over historical geopolitical dependencies.`
        : `GCC diplomatic posture is shifting — sustained engagement across multiple geopolitical axes indicates a deliberate hedging strategy designed to preserve strategic autonomy in a fragmenting global order.`;

      return {
        hypothesis,
        supportingSignals: supportingSignals.slice(0, 4),
        derivedFrom: ["GEO", "MACRO"],
      };
    },
  },

  // ── Pattern 4: Capital Markets Deepening ───────────────────────────
  // Triggered by: MARKET signals + sovereign wealth deployment
  {
    id: "capital_markets_deepening",
    name: "GCC Capital Markets Deepening",
    description:
      "GCC equity markets and capital flows maturing as institutional investment infrastructure expands",
    type: INSIGHT_TYPES.MARKET_SHIFT,
    preconditions: {
      requiredSignalTypes: ["MARKET"],
      minMarketSignals: 2,
      minMacroSignals: 1,
      minHighImpact: 1,
      gccRegionRequired: false,
    },
    buildHypothesis: (signals, clusters) => {
      const marketSignals = signals.filter(
        (s) => s.signalType === "MARKET" && (s.impact === "HIGH" || s.impact === "MEDIUM")
      );
      const macroSignals = signals.filter(
        (s) => s.signalType === "MACRO" && s.impact === "HIGH"
      );

      if (marketSignals.length < 2) return null;

      const supportingSignals = [...marketSignals, ...macroSignals.slice(0, 1)].map((s) => s.summary);
      const hasIpo = marketSignals.some((s) => s.summary.toLowerCase().includes("ipo"));
      const hasInstitutional = marketSignals.some((s) => s.summary.toLowerCase().includes("institutional") || s.summary.toLowerCase().includes("flow"));

      const hypothesis = hasIpo || hasInstitutional
        ? `GCC capital markets are undergoing institutional deepening — increased IPO activity and institutional capital flows signal a structural shift from retail-dominated to institutionally-driven markets, improving price discovery and liquidity depth.`
        : `GCC equity markets show sustained institutional investor engagement — trading volumes and sector rotation patterns indicate maturing market infrastructure capable of absorbing larger capital allocations.`;

      return {
        hypothesis,
        supportingSignals: supportingSignals.slice(0, 4),
        derivedFrom: ["MARKET", "MACRO"],
      };
    },
  },

  // ── Pattern 5: AI-as-Infrastructure Race ──────────────────────────
  // Triggered by: AI signals + sovereign fund deployment patterns
  {
    id: "ai_infrastructure_race",
    name: "GCC AI Infrastructure Race",
    description:
      "GCC states competing to establish AI compute infrastructure as strategic national asset",
    type: INSIGHT_TYPES.MACRO_TREND,
    preconditions: {
      requiredSignalTypes: ["AI"],
      minAiSignals: 2,
      minMacroSignals: 1,
      minHighImpact: 2,
      gccRegionRequired: false,
    },
    buildHypothesis: (signals, clusters) => {
      const aiSignals = signals.filter((s) => s.signalType === "AI" && s.impact === "HIGH");
      const macroGccSignals = signals.filter(
        (s) => s.signalType === "MACRO" && (s.region === "GCC" || s.region === "KSA" || s.region === "UAE")
      );

      if (aiSignals.length < 2) return null;

      const supportingSignals = [...aiSignals, ...macroGccSignals.slice(0, 1)].map((s) => s.summary);

      const hypothesis = `GCC states are competing to establish AI compute infrastructure as a strategic national asset — ${aiSignals.length} high-impact AI signals (${aiSignals.map((s) => s.region).join(", ")}) indicate sovereign-level investment racing to capture the economic upside of AI before global competitors entrench advantages.`;

      return {
        hypothesis,
        supportingSignals: supportingSignals.slice(0, 4),
        derivedFrom: ["AI", "MACRO"],
      };
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// CONFIDENCE SCORING MODEL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate confidence score for a hypothesis.
 *
 * Formula:
 *   confidence = signalStrength * 0.4 + trendConsistency * 0.3 + historicalRepetition * 0.3
 *
 * Where:
 *   - signalStrength: 0-1, based on average fusion score and impact levels
 *   - trendConsistency: 0-1, how well this pattern matches current narrative clusters
 *   - historicalRepetition: 0-1, whether similar hypotheses held up historically
 *
 * Result clamped: 0 → 1
 *
 * @param {Object} hypothesisResult - Result from buildHypothesis
 * @param {Array} signals - All approved signals
 * @param {Array} clusters - Narrative clusters
 * @param {Array} pastInsights - Previous insights for historical tracking
 * @returns {number} Confidence score (0-1)
 */
function calculateConfidence(hypothesisResult, signals, clusters, pastInsights) {
  // ── Signal Strength (0-1) ──────────────────────────────────────────
  // Average confidence of all supporting signals, boosted by HIGH impact count
  const supportingSummaries = hypothesisResult.supportingSignals || [];
  const matchedSignals = signals.filter((s) =>
    supportingSummaries.some((summary) => s.summary === summary)
  );

  let signalStrength = 0.5; // default baseline
  if (matchedSignals.length > 0) {
    const avgConfidence =
      matchedSignals.reduce((sum, s) => sum + (s.confidence || 0.5), 0) /
      matchedSignals.length;

    const highImpactCount = matchedSignals.filter((s) => s.impact === "HIGH").length;
    const impactBonus = Math.min(0.2, highImpactCount * 0.05);

    signalStrength = Math.min(1, avgConfidence + impactBonus);
  }

  // ── Trend Consistency (0-1) ────────────────────────────────────────
  // How well this hypothesis aligns with current narrative clusters
  // If clusters exist and have active signals, the hypothesis is more grounded
  let trendConsistency = 0.5;
  if (clusters && clusters.length > 0) {
    const activeClusters = clusters.filter((c) => c.signalCount > 0);
    if (activeClusters.length >= 2) {
      trendConsistency = Math.min(1, 0.5 + activeClusters.length * 0.1);
    }
  }

  // ── Historical Repetition (0-1) ────────────────────────────────────
  // Look for this hypothesis pattern in past insights
  let historicalRepetition = 0.3; // default: low for first appearance
  if (pastInsights && pastInsights.length > 0) {
    const hypothesisLower = hypothesisResult.hypothesis.toLowerCase();
    const hypothesisWords = new Set(hypothesisLower.split(/\s+/).filter((w) => w.length > 4));

    let matchCount = 0;
    for (const past of pastInsights) {
      if (!past.hypothesis) continue;
      const pastLower = past.hypothesis.toLowerCase();
      const pastWords = new Set(pastLower.split(/\s+/).filter((w) => w.length > 4));

      // Calculate Jaccard similarity on key terms
      const intersection = new Set([...hypothesisWords].filter((w) => pastWords.has(w)));
      const union = new Set([...hypothesisWords, ...pastWords]);
      const similarity = intersection.size / (union.size || 1);

      if (similarity > 0.3) {
        matchCount++;
        // If this insight was confirmed or validated, boost repetition score
        if (past.status === "CONFIRMED" || past.status === "VALIDATED") {
          historicalRepetition = Math.max(historicalRepetition, 0.8);
        } else if (past.status === "WEAKENING" || past.status === "DISCARDED") {
          historicalRepetition = Math.min(historicalRepetition, 0.2);
        }
      }
    }

    // If we found matches but with low status, keep repetition moderate
    if (matchCount === 0) {
      historicalRepetition = 0.3; // new hypothesis — low historical repetition
    } else if (historicalRepetition === 0.3) {
      historicalRepetition = 0.5; // matched but unconfirmed — moderate
    }
  }

  // ── Compute weighted confidence ────────────────────────────────────
  const confidence =
    signalStrength * 0.4 + trendConsistency * 0.3 + historicalRepetition * 0.3;

  // Clamp to 0-1
  return Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
}

// ═══════════════════════════════════════════════════════════════════════════
// TIME-BOUND EVIDENCE CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify that a hypothesis is grounded in time-bound evidence.
 *
 * Checks:
 *   1. At least 2 independent signals exist to support it
 *   2. The signals are current (from this run's fusion output)
 *   3. Supporting signals have non-trivial confidence
 *
 * @param {Object} hypothesisResult - Result from buildHypothesis
 * @param {Array} signals - All approved signals from current run
 * @returns {boolean} Whether time-bound evidence requirement is satisfied
 */
function hasTimeBoundEvidence(hypothesisResult, signals) {
  const supportingSummaries = hypothesisResult.supportingSignals || [];
  if (supportingSummaries.length < 2) return false;

  // Match supporting summaries to actual signals
  let matchCount = 0;
  for (const summary of supportingSummaries) {
    const matched = signals.some((s) => s.summary === summary);
    if (matched) matchCount++;
  }

  return matchCount >= 2;
}

// ═══════════════════════════════════════════════════════════════════════════
// GATE: Only include signals with GCC relevance = HIGH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a set of signals has HIGH GCC relevance.
 *
 * @param {Array} signals - Supporting signals for a hypothesis
 * @returns {boolean}
 */
function hasHighGCCRelevance(signals) {
  if (signals.length === 0) return false;

  const gccRegions = ["GCC", "KSA", "UAE", "QA"];
  const gccCount = signals.filter((s) => gccRegions.includes(s.region)).length;

  // At least half of supporting signals must be GCC-region
  return gccCount >= Math.ceil(signals.length / 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHT MEMORY — Persist/read insight history
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read the full insight store.
 * @returns {Object} { runId, date, insights: [] }
 */
function readInsightStore() {
  try {
    if (!fs.existsSync(INSIGHT_STORE_PATH)) {
      return { runId: "", date: "", insights: [] };
    }
    const raw = fs.readFileSync(INSIGHT_STORE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.log(`[INSIGHT SYNTHESIZER] Failed to read insight store: ${err.message}`);
    return { runId: "", date: "", insights: [] };
  }
}

/**
 * Write insights to the persistent store.
 * @param {Object} store - { runId, date, insights }
 */
function writeInsightStore(store) {
  try {
    fs.mkdirSync(path.dirname(INSIGHT_STORE_PATH), { recursive: true });
    fs.writeFileSync(INSIGHT_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.log(`[INSIGHT SYNTHESIZER] Failed to write insight store: ${err.message}`);
  }
}

/**
 * Get all past insights (flattened for comparison).
 * @returns {Array} Array of past insight objects
 */
function getPastInsights() {
  const store = readInsightStore();
  return store.insights || [];
}

/**
 * Get editorial decisions for historical signal patterns.
 * @returns {Array} Editorial decision logs
 */
function getEditorialHistory() {
  try {
    if (!fs.existsSync(EDITORIAL_LOG_PATH)) return [];
    const raw = fs.readFileSync(EDITORIAL_LOG_PATH, "utf-8");
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS UPDATE LOGIC — Insight Memory Feedback Loop
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update the status of existing insights based on new run data.
 *
 * Rules:
 *   - If a hypothesis re-appears with higher confidence → status improves
 *   - If a hypothesis re-appears with lower/declining confidence → WEAKENING
 *   - If a hypothesis persists with sustained confidence over 3+ runs → CONFIRMED
 *   - If a hypothesis stays WEAKENING for 2+ runs → DISCARDED
 *   - If a hypothesis reaches CONFIRMED and persists 5+ runs → VALIDATED
 *
 * @param {Array} existingInsights - Previous insights from store
 * @param {Array} newInsights - Newly generated insights
 * @returns {Array} Updated insights with new statuses
 */
function updateInsightStatus(existingInsights, newInsights) {
  const updated = [...existingInsights];

  for (const existing of updated) {
    // Find if this insight has a match in new insights
    const existingWords = new Set(
      (existing.hypothesis || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4)
    );

    const match = newInsights.find((ni) => {
      const niWords = new Set(
        (ni.hypothesis || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4)
      );
      const intersection = new Set([...existingWords].filter((w) => niWords.has(w)));
      const union = new Set([...existingWords, ...niWords]);
      return intersection.size / (union.size || 1) > 0.3;
    });

    if (match) {
      // Hypothesis re-appeared
      if (match.confidence >= existing.confidence) {
        // Confidence maintained or improved
        switch (existing.status) {
          case "EMERGING":
            existing.status = INSIGHT_STATUS.CONFIRMED;
            break;
          case "CONFIRMED":
            // Check if persisted long enough for VALIDATED
            const confirmedRuns = existing._confirmedCount || 0;
            existing._confirmedCount = (confirmedRuns || 0) + 1;
            if (existing._confirmedCount >= 5) {
              existing.status = INSIGHT_STATUS.VALIDATED;
            }
            break;
          case "WEAKENING":
            existing.status = INSIGHT_STATUS.CONFIRMED; // recovered
            existing._weakenedCount = 0;
            break;
        }
        existing.confidence = Math.max(existing.confidence, match.confidence);
        existing._lastUpdated = new Date().toISOString();
      } else {
        // Confidence declined
        if (existing.status === "EMERGING") {
          existing.status = INSIGHT_STATUS.WEAKENING;
          existing._weakenedCount = 1;
        } else if (existing.status === "CONFIRMED" || existing.status === "WEAKENING") {
          existing._weakenedCount = (existing._weakenedCount || 0) + 1;
          if (existing._weakenedCount >= 2) {
            existing.status = INSIGHT_STATUS.DISCARDED;
          } else {
            existing.status = INSIGHT_STATUS.WEAKENING;
          }
        }
        existing._lastUpdated = new Date().toISOString();
      }
    } else {
      // Hypothesis did NOT appear in new run
      if (existing.status === "EMERGING") {
        existing._missedCount = (existing._missedCount || 0) + 1;
        if (existing._missedCount >= 2) {
          existing.status = INSIGHT_STATUS.WEAKENING;
        }
      } else if (existing.status === "CONFIRMED") {
        existing._missedCount = (existing._missedCount || 0) + 1;
        if (existing._missedCount >= 3) {
          existing.status = INSIGHT_STATUS.WEAKENING;
        }
      } else if (existing.status === "WEAKENING") {
        existing._weakenedCount = (existing._weakenedCount || 0) + 1;
        if (existing._weakenedCount >= 2) {
          existing.status = INSIGHT_STATUS.DISCARDED;
        }
      }
      existing._lastUpdated = new Date().toISOString();
    }
  }

  return updated;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — synthesizeInsights
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the strategic insight synthesis pipeline.
 *
 * Pipeline:
 *   1. Read past insights + editorial history (memory feedback loop)
 *   2. Evaluate all hypothesis patterns against current fused signals
 *   3. Apply time-bound evidence check
 *   4. Apply GCC relevance gate
 *   5. Calculate confidence scores
 *   6. Apply validation gate (confidence >= 0.65 AND at least 2 signals)
 *   7. Update insight statuses via memory feedback loop
 *   8. Persist to insight store
 *   9. Return validated insights for newsletter inclusion
 *
 * @param {Object} fusedOutput - Output from fusion-engine.js fuseSignals()
 * @param {Object} ctx - ExecutionContext (ONLY source of identity)
 * @returns {Promise<Object>} {
 *   insights: Array<Object>,   // Validated insights (passed all gates)
 *   discarded: Array<Object>,  // Insights that failed the validation gate
 *   store: Object              // Full insight store snapshot
 * }
 */
export async function synthesizeInsights(fusedOutput, ctx = { runId: "unknown" }) {
  console.log("\n═══════════════════════════════════════════════");
  console.log("🧠 INSIGHT SYNTHESIZER — Generating strategic hypotheses");
  console.log("═══════════════════════════════════════════════");

  const runId = ctx.runId;
  const currentDate = new Date().toISOString().slice(0, 10);

  // ── Step 0: Extract signals from fused output ───────────────────────
  const signals = fusedOutput.topSignals || [];
  const clusters = fusedOutput.narrativeClusters || [];

  console.log(`   Run ID: ${runId}`);
  console.log(`   Signals available: ${signals.length}`);
  console.log(`   Narrative clusters: ${clusters.length}`);

  // ── Guard: insufficient signals for hypothesis generation ───────────
  if (signals.length < 2) {
    console.log("\n   ⚠️  Insufficient signals for hypothesis generation (need >= 2).");
    console.log("   Returning empty insight set. Not a failure — signal-grounded constraint.");

    const emptyResult = {
      insights: [],
      discarded: [],
      store: readInsightStore(),
      runId,
      date: currentDate,
    };

    // Still update the store with the run marker
    const store = readInsightStore();
    store.runId = runId;
    store.date = currentDate;
    writeInsightStore(store);

    console.log("═══════════════════════════════════════════════\n");
    return emptyResult;
  }

  // ── Step 1: Read historical context ─────────────────────────────────
  console.log("\n   📖 Reading insight memory and editorial history...");
  const pastInsights = getPastInsights();
  const editorialHistory = getEditorialHistory();
  console.log(`   Past insights: ${pastInsights.length}`);
  console.log(`   Editorial history entries: ${editorialHistory.length}`);

  // ── Step 2: Evaluate all hypothesis patterns ───────────────────────
  console.log("\n   🔍 Evaluating hypothesis patterns against signals...");
  const rawHypotheses = [];

  for (const pattern of HYPOTHESIS_PATTERNS) {
    const pre = pattern.preconditions;

    // Check preconditions
    const aiCount = signals.filter((s) => s.signalType === "AI").length;
    const macroCount = signals.filter((s) => s.signalType === "MACRO").length;
    const marketCount = signals.filter((s) => s.signalType === "MARKET").length;
    const geoCount = signals.filter((s) => s.signalType === "GEO").length;
    const highImpactCount = signals.filter((s) => s.impact === "HIGH").length;
    const gccSignals = signals.filter((s) => ["GCC", "KSA", "UAE", "QA"].includes(s.region));

    // Check GCC region requirement
    if (pre.gccRegionRequired && gccSignals.length === 0) {
      console.log(`   ⏭️  Pattern "${pattern.name}" skipped — no GCC-region signals`);
      continue;
    }

    // Check signal type counts
    if (pre.minAiSignals && aiCount < pre.minAiSignals) {
      console.log(`   ⏭️  Pattern "${pattern.name}" skipped — need ${pre.minAiSignals} AI signals, have ${aiCount}`);
      continue;
    }
    if (pre.minMacroSignals && macroCount < pre.minMacroSignals) {
      console.log(`   ⏭️  Pattern "${pattern.name}" skipped — need ${pre.minMacroSignals} MACRO signals, have ${macroCount}`);
      continue;
    }
    if (pre.minMarketSignals && marketCount < pre.minMarketSignals) {
      console.log(`   ⏭️  Pattern "${pattern.name}" skipped — need ${pre.minMarketSignals} MARKET signals, have ${marketCount}`);
      continue;
    }
    if (pre.minGeoSingals && geoCount < pre.minGeoSingals) {
      console.log(`   ⏭️  Pattern "${pattern.name}" skipped — need ${pre.minGeoSingals} GEO signals, have ${geoCount}`);
      continue;
    }
    if (pre.minHighImpact && highImpactCount < pre.minHighImpact) {
      console.log(`   ⏭️  Pattern "${pattern.name}" skipped — need ${pre.minHighImpact} HIGH impact signals, have ${highImpactCount}`);
      continue;
    }

    // ── Build hypothesis ──────────────────────────────────────────
    const hypothesisResult = pattern.buildHypothesis(signals, clusters);
    if (!hypothesisResult) {
      console.log(`   ⏭️  Pattern "${pattern.name}" — buildHypothesis returned null`);
      continue;
    }

    rawHypotheses.push({
      hypothesis: hypothesisResult.hypothesis,
      supportingSignals: hypothesisResult.supportingSignals,
      derivedFrom: hypothesisResult.derivedFrom,
      patternId: pattern.id,
      patternName: pattern.name,
      type: pattern.type,
    });

    console.log(`   ✅ Pattern "${pattern.name}" — hypothesis generated`);
  }

  console.log(`\n   Raw hypotheses generated: ${rawHypotheses.length}`);

  // ── Step 3: Apply time-bound evidence check ────────────────────────
  console.log("\n   ⏱  Checking time-bound evidence...");
  const timeChecked = rawHypotheses.filter((h) => {
    const passes = hasTimeBoundEvidence(h, signals);
    if (!passes) {
      console.log(`   ❌ "${h.patternName}" — failed time-bound evidence check (< 2 independent signals)`);
    }
    return passes;
  });

  console.log(`   Passed: ${timeChecked.length}/${rawHypotheses.length}`);

  // ── Step 4: Apply GCC relevance gate ───────────────────────────────
  console.log("\n   🌍 Checking GCC relevance...");
  const gccChecked = timeChecked.filter((h) => {
    // Map supporting signal summaries back to actual signals for region check
    const matchedSignals = signals.filter((s) =>
      h.supportingSignals.some((summary) => s.summary === summary)
    );
    const passes = hasHighGCCRelevance(matchedSignals);
    if (!passes) {
      console.log(`   ❌ "${h.patternName}" — failed GCC relevance gate`);
    }
    return passes;
  });

  console.log(`   Passed: ${gccChecked.length}/${timeChecked.length}`);

  // ── Step 5: Calculate confidence for remaining hypotheses ──────────
  console.log("\n   📊 Calculating confidence scores...");
  const withConfidence = gccChecked.map((h) => {
    const matchedSignals = signals.filter((s) =>
      h.supportingSignals.some((summary) => s.summary === summary)
    );
    const confidence = calculateConfidence(h, signals, clusters, pastInsights);
    return {
      ...h,
      confidence,
      signalCount: matchedSignals.length,
    };
  });

  for (const h of withConfidence) {
    console.log(`   [${h.confidence.toFixed(2)}] ${h.patternName} — ${h.signalCount} supporting signals`);
  }

  // ── Step 6: Validation gate — confidence >= 0.65 AND >= 2 signals ──
  console.log("\n   🚧 Running validation gate...");
  const MIN_CONFIDENCE = 0.65;
  const MIN_SIGNALS = 2;

  const validated = [];
  const discarded = [];

  for (const h of withConfidence) {
    if (h.confidence >= MIN_CONFIDENCE && h.signalCount >= MIN_SIGNALS) {
      validated.push({
        hypothesis: h.hypothesis,
        supportingSignals: h.supportingSignals,
        confidence: h.confidence,
        type: h.type,
        status: INSIGHT_STATUS.EMERGING, // all new insights start as EMERGING
        signalCount: h.signalCount,
        patternName: h.patternName,
        derivedFrom: h.derivedFrom,
        generatedAt: new Date().toISOString(),
      });
      console.log(`   ✅ PASSED — "${h.patternName}" (confidence: ${h.confidence.toFixed(2)}, signals: ${h.signalCount})`);
    } else {
      discarded.push({
        hypothesis: h.hypothesis,
        supportingSignals: h.supportingSignals,
        confidence: h.confidence,
        type: h.type,
        rejectReason: `confidence=${h.confidence.toFixed(2)} (need >= ${MIN_CONFIDENCE}), signals=${h.signalCount} (need >= ${MIN_SIGNALS})`,
      });
      console.log(`   ❌ DISCARDED — "${h.patternName}" (confidence: ${h.confidence.toFixed(2)}, signals: ${h.signalCount})`);
    }
  }

  // ── Enforce max 4 insights per run ─────────────────────────────────
  const MAX_INSIGHTS = 4;
  const finalInsights = validated.slice(0, MAX_INSIGHTS);
  if (validated.length > MAX_INSIGHTS) {
    console.log(`\n   ⚠️  Truncated to ${MAX_INSIGHTS} insights (${validated.length - MAX_INSIGHTS} excluded by cap)`);
  }

  // ── Step 7: Update insight statuses via memory feedback loop ───────
  console.log("\n   🔄 Running insight memory feedback loop...");
  const store = readInsightStore();
  const updatedExisting = updateInsightStatus(store.insights, finalInsights);

  // Merge: existing (updated) + new insights
  const mergedInsights = [...updatedExisting];

  // Add new insights (the ones that don't match any existing)
  for (const ni of finalInsights) {
    const existingMatch = updatedExisting.find((ei) => {
      const eiWords = new Set(
        (ei.hypothesis || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4)
      );
      const niWords = new Set(
        (ni.hypothesis || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4)
      );
      const intersection = new Set([...eiWords].filter((w) => niWords.has(w)));
      const union = new Set([...eiWords, ...niWords]);
      return intersection.size / (union.size || 1) > 0.3;
    });

    if (!existingMatch) {
      mergedInsights.push(ni);
    }
  }

  // ── Prune DISCARDED insights older than 30 runs ────────────────────
  const prunedInsights = mergedInsights.filter((insight) => {
    if (insight.status === INSIGHT_STATUS.DISCARDED) {
      const discardAge = insight._lastUpdated
        ? (Date.now() - new Date(insight._lastUpdated).getTime()) / (1000 * 60 * 60 * 24)
        : 0;
      return discardAge < 30; // keep for 30 days for analysis
    }
    return true;
  });

  // ── Step 8: Persist to insight store ───────────────────────────────
  const updatedStore = {
    runId,
    date: currentDate,
    insights: prunedInsights,
  };
  writeInsightStore(updatedStore);

  // ── Summary ────────────────────────────────────────────────────────
  const activeCount = prunedInsights.filter(
    (i) => i.status !== INSIGHT_STATUS.DISCARDED
  ).length;

  console.log("\n═══════════════════════════════════════════════");
  console.log("✅ INSIGHT SYNTHESIS COMPLETE");
  console.log(`   Hypotheses evaluated: ${rawHypotheses.length}`);
  console.log(`   Passed validation gate: ${finalInsights.length}`);
  console.log(`   Discarded (low confidence/signals): ${discarded.length}`);
  console.log(`   Total active insights in store: ${activeCount}`);
  console.log("═══════════════════════════════════════════════\n");

  return {
    insights: finalInsights,
    discarded,
    store: updatedStore,
    runId,
    date: currentDate,
  };
}

/**
 * Format insights for newsletter inclusion.
 *
 * Generates the "🧠 Strategic GCC Insights" section text.
 *
 * @param {Array} insights - Validated insight objects
 * @returns {string} Formatted markdown section
 */
export function formatInsightsForNewsletter(insights) {
  if (!insights || insights.length === 0) {
    return "";
  }

  const insightLines = insights.map((i, idx) => {
    const reasoningLine = i.supportingSignals
      ? i.supportingSignals.slice(0, 2).join("; ")
      : "Derived from fused signal analysis";
    const confidencePct = Math.round((i.confidence || 0) * 100);

    return `  ${idx + 1}. **${i.hypothesis}**
     — Reasoning: ${reasoningLine}
     — Confidence: ${confidencePct}% | Status: ${i.status} | Type: ${i.type}`;
  });

  return `
🧠 STRATEGIC GCC INSIGHTS (Analytical Layer)

These are structured, signal-grounded hypotheses — not facts. They represent
interpretations of current GCC signal patterns for executive consideration.

${insightLines.join("\n\n")}
`.trim();
}

/**
 * Get the current insight store (for external queries).
 * @returns {Object} Full insight store
 */
export function getInsightStore() {
  return readInsightStore();
}

/**
 * Get active (non-discarded) insights for use in master context.
 * @returns {Array} Active insights
 */
export function getActiveInsights() {
  const store = readInsightStore();
  return (store.insights || []).filter(
    (i) => i.status !== INSIGHT_STATUS.DISCARDED && i.status !== INSIGHT_STATUS.WEAKENING
  );
}
