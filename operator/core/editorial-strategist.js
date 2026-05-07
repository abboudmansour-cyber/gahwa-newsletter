/**
 * editorial-strategist.js — Editorial Decision Engine
 *
 * GATEKEEPER LAYER: Evaluates whether every signal/story should be included
 * in the newsletter at all. Runs BEFORE fusion-engine, ensuring only
 * editorially approved content reaches DeepSeek.
 *
 * Core functions:
 *   1. Score every signal on 4 editorial dimensions (0–10 scale)
 *   2. Apply the hard PUBLISH RULE (relevanceToGCC >= 7, signalStrength >= 6, noiseLevel <= 4)
 *   3. INCLUDE / EXCLUDE / DEFER each signal
 *   4. Enforce category balance (anti-bias: maxPerCategory = 2)
 *   5. Log all rejections and editorial decisions for system learning
 *
 * This module has NO external dependencies. Node.js only. No ML. No human editors.
 * Pure deterministic editorial intelligence.
 *
 * @module editorial-strategist
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const REJECTED_LOG_PATH = path.join(ROOT, "operator", "logs", "rejected-stories.json");
const EDITORIAL_LOG_PATH = path.join(ROOT, "operator", "logs", "editorial-decisions.json");

// ── CATEGORY LABELS ────────────────────────────────────────────────────
// Maps signalType to editorial category for story balance enforcement

const SIGNAL_TYPE_TO_CATEGORY = {
  MACRO: "macro",
  MARKET: "markets",
  GEO: "geopolitics",
  AI: "ai_tech",
};

// ── MAX STORIES PER CATEGORY (anti-bias rule) ──────────────────────────
// Prevents newsletter from being dominated by a single category.
// If more than MAX_PER_CATEGORY signals qualify in one category,
// the lowest-scoring ones are deferred.

const MAX_PER_CATEGORY = 2;

// ═══════════════════════════════════════════════════════════════════════
// SCORING FUNCTIONS — Each dimension on a 0–10 scale
// ═══════════════════════════════════════════════════════════════════════

/**
 * Score GCC relevance (0–10).
 *
 * Determines how directly this signal matters to GCC audiences.
 * Region is the primary driver, modulated by impact level.
 *
 * Scale:
 *   10 — GCC-wide, HIGH impact (sovereign-level, all GCC markets)
 *    9 — KSA/UAE, HIGH impact (core economies, major moves)
 *    8 — KSA/UAE, MEDIUM impact | GCC-wide, MEDIUM impact | QA, HIGH
 *    7 — QA, MEDIUM impact
 *    6 — Below threshold (not eligible for INCLUDE)
 *    3 — LOW impact signals (should be pre-filtered, safety guard)
 */
function scoreRelevanceToGCC(signal) {
  const region = signal.region;
  const impact = signal.impact;

  // GCC-wide with HIGH impact — maximum relevance
  if (region === "GCC" && impact === "HIGH") return 10;
  if (region === "GCC" && impact === "MEDIUM") return 8;

  // KSA and UAE — core GCC economies
  if (region === "KSA" && impact === "HIGH") return 9;
  if (region === "KSA" && impact === "MEDIUM") return 7;
  if (region === "UAE" && impact === "HIGH") return 9;
  if (region === "UAE" && impact === "MEDIUM") return 7;

  // Qatar — smaller but still GCC
  if (region === "QA" && impact === "HIGH") return 8;
  if (region === "QA" && impact === "MEDIUM") return 6;

  // LOW impact — should never reach here with GCC filter active
  return 3;
}

/**
 * Score economic impact (0–10).
 *
 * Measures the signal's potential to move markets or affect economic conditions.
 * Signal type and impact level are the primary drivers.
 *
 * Scale:
 *   9  — MACRO + HIGH (oil, rates, fiscal — direct market drivers)
 *   8  — MARKET + HIGH (index moves, IPO, capital flows)
 *   7  — MACRO + MEDIUM | GEO + HIGH (geopolitical risk with economic dimension)
 *   6  — MARKET + MEDIUM | AI + HIGH
 *   5  — GEO + MEDIUM
 *   4  — AI + MEDIUM
 *   2  — LOW impact (any type)
 */
function scoreEconomicImpact(signal) {
  const type = signal.signalType;
  const impact = signal.impact;

  // Base score by impact level
  const base = impact === "HIGH" ? 7 : impact === "MEDIUM" ? 5 : 2;

  // Type-specific adjustment
  switch (type) {
    case "MACRO":
      return Math.min(10, base + 2); // HIGH→9, MEDIUM→7
    case "MARKET":
      return Math.min(10, base + 1); // HIGH→8, MEDIUM→6
    case "GEO":
      return base;                   // HIGH→7, MEDIUM→5
    case "AI":
      return Math.max(1, base - 1); // HIGH→6, MEDIUM→4
    default:
      return base;
  }
}

/**
 * Score signal strength (0–10).
 *
 * Measures confidence in the signal's accuracy and timeliness.
 * Based on the signal's confidence field (0–1), boosted by impact.
 *
 * Scale:
 *   10 — confidence 1.0 + HIGH impact
 *    9 — confidence 0.9–1.0 + MEDIUM impact, or 0.8–0.89 + HIGH
 *    8 — confidence 0.8–0.89 + MEDIUM, or 0.7–0.79 + HIGH
 *    7 — confidence 0.7–0.79 + MEDIUM
 *    6 — confidence 0.6–0.69 + HIGH
 *    5 — confidence 0.6–0.69 + MEDIUM, or 0.5–0.59 + HIGH
 *   <5 — Low confidence signals
 */
function scoreSignalStrength(signal) {
  const confidence = signal.confidence || 0.5;
  const impact = signal.impact;

  // Convert confidence 0–1 to 0–10 base
  const base = Math.round(confidence * 10);

  // HIGH impact signals get +1 (more institutional confidence)
  if (impact === "HIGH") {
    return Math.min(10, base + 1);
  }

  return base;
}

/**
 * Score noise level (0–10, LOWER is better for inclusion).
 *
 * Measures how much "signal noise" a story carries — signals that are
 * speculative, fast-changing, low-confidence, or tangentially relevant.
 *
 * Scale:
 *    1 — HIGH impact, GCC region — cleanest signal
 *    2 — HIGH impact, non-GCC but relevant | MEDIUM + GCC
 *    3 — MEDIUM impact, non-GCC
 *    4 — AI signals with HIGH impact
 *    5+ — Lower confidence, less relevant — noisy
 */
function scoreNoiseLevel(signal) {
  const impact = signal.impact;
  const region = signal.region;
  const type = signal.signalType;

  let noise;

  // Base noise from impact level
  if (impact === "HIGH") {
    noise = 2;
  } else if (impact === "MEDIUM") {
    noise = 4;
  } else {
    noise = 7; // LOW impact — inherently noisy
  }

  // GCC region reduces noise (more relevant to target audience)
  if (["GCC", "KSA", "UAE", "QA"].includes(region)) {
    noise = Math.max(1, noise - 1);
  }

  // AI/tech is inherently noisier (fast-changing, lower certainty, hype risk)
  if (type === "AI") {
    noise += 1;
  }

  return Math.min(10, Math.max(1, noise));
}

// ═══════════════════════════════════════════════════════════════════════
// SIGNAL ACCEPTANCE MODEL
// ═══════════════════════════════════════════════════════════════════════

/**
 * Evaluate a single signal against the editorial acceptance model.
 *
 * Returns the full editorial scorecard:
 * {
 *   relevanceToGCC: 0-10,
 *   economicImpact: 0-10,
 *   signalStrength: 0-10,
 *   noiseLevel: 0-10,
 *   publishDecision: "INCLUDE" | "EXCLUDE" | "DEFER",
 *   rejectionReason: string | null
 * }
 */
function evaluateSignal(signal) {
  const relevanceToGCC = scoreRelevanceToGCC(signal);
  const economicImpact = scoreEconomicImpact(signal);
  const signalStrength = scoreSignalStrength(signal);
  const noiseLevel = scoreNoiseLevel(signal);

  // ──────────────────────────────────────────────────────────────────
  // HARD PUBLISH RULE
  // ──────────────────────────────────────────────────────────────────
  // A story is eligible ONLY IF:
  //   relevanceToGCC >= 7
  //   AND signalStrength >= 6
  //   AND noiseLevel <= 4
  //
  // Otherwise:
  //   EXCLUDE — drop completely (no partial merit)
  //   DEFER  — store for future runs (has partial merit)
  // ──────────────────────────────────────────────────────────────────

  let publishDecision;
  let rejectionReason = null;

  if (relevanceToGCC >= 7 && signalStrength >= 6 && noiseLevel <= 4) {
    publishDecision = "INCLUDE";
  } else {
    // DEFER if signal has partial merit — it might become relevant later
    // (e.g., a developing story that could strengthen)
    const hasPartialMerit =
      relevanceToGCC >= 5 || signalStrength >= 4;

    // But if noise is too high even with partial merit, exclude anyway
    const isTooNoisy = noiseLevel > 6;

    if (hasPartialMerit && !isTooNoisy) {
      publishDecision = "DEFER";
    } else {
      publishDecision = "EXCLUDE";
    }

    rejectionReason = buildRejectionReason(relevanceToGCC, signalStrength, noiseLevel);
  }

  return {
    relevanceToGCC,
    economicImpact,
    signalStrength,
    noiseLevel,
    publishDecision,
    rejectionReason,
  };
}

/**
 * Build a machine-parseable rejection reason from the score breakdown.
 *
 * Returns one or more of: LOW_GCC_RELEVANCE | LOW_IMPACT | HIGH_NOISE
 * Joined with " | " for compound failures.
 */
function buildRejectionReason(relevanceToGCC, signalStrength, noiseLevel) {
  const failures = [];
  if (relevanceToGCC < 7) failures.push("LOW_GCC_RELEVANCE");
  if (signalStrength < 6) failures.push("LOW_IMPACT");
  if (noiseLevel > 4) failures.push("HIGH_NOISE");
  return failures.join(" | ");
}

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY BALANCE ENFORCEMENT (Anti-Bias)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Enforce story balance: no more than MAX_PER_CATEGORY stories per category.
 *
 * Rationale:
 *   - Prevents newsletter from becoming single-topic (all macro, all AI, etc.)
 *   - Ensures diversity of coverage across all GCC intelligence domains
 *   - Forces editorial selectivity: only the strongest signals survive
 *
 * When over capacity, the lowest-scoring signals in that category are
 * downgraded to DEFER. Signals are sorted by composite editorial score
 * so that the highest-quality content is kept.
 */
function enforceCategoryBalance(approvedSignals) {
  const categoryCounts = {};
  const balanced = [];

  // Sort by composite editorial score descending
  // Composite = relevanceToGCC + economicImpact + signalStrength - noiseLevel
  const sorted = [...approvedSignals].sort((a, b) => {
    const aScores = a.editorialScores;
    const bScores = b.editorialScores;
    const aComposite =
      aScores.relevanceToGCC + aScores.economicImpact + aScores.signalStrength - aScores.noiseLevel;
    const bComposite =
      bScores.relevanceToGCC + bScores.economicImpact + bScores.signalStrength - bScores.noiseLevel;
    return bComposite - aComposite;
  });

  for (const signal of sorted) {
    const category = SIGNAL_TYPE_TO_CATEGORY[signal.signalType] || "other";
    const currentCount = categoryCounts[category] || 0;

    if (currentCount >= MAX_PER_CATEGORY) {
      // Downgrade to DEFER — this signal would unbalance the newsletter
      signal.editorialScores.publishDecision = "DEFER";
      signal.editorialScores.rejectionReason = signal.editorialScores.rejectionReason
        ? `CATEGORY_BALANCE (max ${MAX_PER_CATEGORY}/${category}) | ${signal.editorialScores.rejectionReason}`
        : `CATEGORY_BALANCE (max ${MAX_PER_CATEGORY}/${category})`;
    } else {
      categoryCounts[category] = currentCount + 1;
    }

    balanced.push(signal);
  }

  return balanced;
}

// ═══════════════════════════════════════════════════════════════════════
// PERSISTENT LOGGING — CRITICAL FOR SYSTEM LEARNING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Append a rejected story entry to the persistent rejection log.
 *
 * Schema:
 * {
 *   "story": "",
 *   "reason": "LOW_GCC_RELEVANCE | LOW_IMPACT | HIGH_NOISE | DEFERRED: ...",
 *   "timestamp": ""
 * }
 */
function logRejectedStory(signal, reason, timestamp) {
  try {
    let log = [];
    if (fs.existsSync(REJECTED_LOG_PATH)) {
      const raw = fs.readFileSync(REJECTED_LOG_PATH, "utf-8").trim();
      if (raw) {
        log = JSON.parse(raw);
      }
    }

    // Keep bounded — last 500 entries to prevent unbounded growth
    if (log.length >= 500) {
      log = log.slice(-499);
    }

    log.push({
      story: (signal.summary || "(no summary)").slice(0, 200),
      reason,
      timestamp,
    });

    fs.mkdirSync(path.dirname(REJECTED_LOG_PATH), { recursive: true });
    fs.writeFileSync(REJECTED_LOG_PATH, JSON.stringify(log, null, 2), "utf-8");
  } catch (err) {
    console.log(`   ⚠ [EDITORIAL STRATEGIST] Failed to write rejection log: ${err.message}`);
  }
}

/**
 * Append an editorial decision entry for this run.
 *
 * Schema:
 * {
 *   "runId": "",
 *   "includedStories": [],
 *   "excludedStories": [],
 *   "deferredStories": [],
 *   "editorialRationale": ""
 * }
 */
function logEditorialDecision(runId, included, excluded, deferred, rationale) {
  try {
    let log = [];
    if (fs.existsSync(EDITORIAL_LOG_PATH)) {
      const raw = fs.readFileSync(EDITORIAL_LOG_PATH, "utf-8").trim();
      if (raw) {
        log = JSON.parse(raw);
      }
    }

    log.push({
      runId,
      timestamp: new Date().toISOString(),
      includedStories: included.map((s) => ({
        summary: (s.summary || "").slice(0, 120),
        signalType: s.signalType,
        region: s.region,
        scores: {
          relevanceToGCC: s.editorialScores.relevanceToGCC,
          economicImpact: s.editorialScores.economicImpact,
          signalStrength: s.editorialScores.signalStrength,
          noiseLevel: s.editorialScores.noiseLevel,
        },
      })),
      excludedStories: excluded.map((s) => ({
        summary: (s.summary || "").slice(0, 120),
        signalType: s.signalType,
        region: s.region,
        reason: s.editorialScores.rejectionReason || "EXCLUDED",
      })),
      deferredStories: deferred.map((s) => ({
        summary: (s.summary || "").slice(0, 120),
        signalType: s.signalType,
        region: s.region,
        reason: s.editorialScores.rejectionReason || "DEFERRED",
      })),
      editorialRationale: rationale,
    });

    // Keep bounded — last 100 entries
    if (log.length > 100) {
      log = log.slice(-100);
    }

    fs.mkdirSync(path.dirname(EDITORIAL_LOG_PATH), { recursive: true });
    fs.writeFileSync(EDITORIAL_LOG_PATH, JSON.stringify(log, null, 2), "utf-8");
  } catch (err) {
    console.log(`   ⚠ [EDITORIAL STRATEGIST] Failed to write decisions log: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// EDITORIAL RATIONALE BUILDER
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a concise, human-readable editorial rationale for this run.
 *
 * Used for transparency, debugging, and system learning analysis.
 */
function buildRationale(included, excluded, deferred) {
  const parts = [];

  if (included.length > 0) {
    // Summarize by category
    const typeCounts = {};
    for (const s of included) {
      const cat = SIGNAL_TYPE_TO_CATEGORY[s.signalType] || "other";
      typeCounts[cat] = (typeCounts[cat] || 0) + 1;
    }
    const typeSummary = Object.entries(typeCounts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    parts.push(
      `Included ${included.length} stories (${typeSummary}) — all passed GCC relevance >= 7, signal strength >= 6, noise <= 4, and category balance enforced at max ${MAX_PER_CATEGORY} per category.`
    );
  } else {
    parts.push("No stories passed editorial review — no content available that meets inclusion thresholds.");
  }

  if (excluded.length > 0) {
    // Group excluded by reason
    const reasonCounts = {};
    for (const s of excluded) {
      const reason = s.editorialScores.rejectionReason || "UNKNOWN";
      if (!reasonCounts[reason]) reasonCounts[reason] = 0;
      reasonCounts[reason]++;
    }
    const exclusionSummary = Object.entries(reasonCounts)
      .map(([k, v]) => `${v} for ${k}`)
      .join(", ");
    parts.push(`Excluded ${excluded.length} stories — failed hard publish rule with no partial merit (${exclusionSummary}).`);
  }

  if (deferred.length > 0) {
    // Group deferred by reason
    const reasonCounts = {};
    for (const s of deferred) {
      const reason = s.editorialScores.rejectionReason || "DEFERRED";
      if (!reasonCounts[reason]) reasonCounts[reason] = 0;
      reasonCounts[reason]++;
    }
    const deferralSummary = Object.entries(reasonCounts)
      .map(([k, v]) => `${v} for ${k}`)
      .join(", ");
    parts.push(`Deferred ${deferred.length} stories for future runs — had partial merit but didn't meet full inclusion thresholds (${deferralSummary}).`);
  }

  return parts.join(" ");
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN EXPORT — runEditorialReview
// ═══════════════════════════════════════════════════════════════════════

/**
 * Editorial review: evaluate all signals and return only those approved.
 *
 * This is the CORE gatekeeper function. It:
 *   1. Scores every signal on 4 editorial dimensions
 *   2. Applies the hard PUBLISH RULE (INCLUDE / EXCLUDE / DEFER)
 *   3. Enforces category balance (max MAX_PER_CATEGORY per category)
 *   4. Logs all rejections to rejected-stories.json
 *   5. Logs all editorial decisions to editorial-decisions.json
 *   6. Returns only INCLUDED signals with clean output (stripped of editorial metadata)
 *
 * @param {Array<Object>} signals - Array of normalized signals
 * @param {string} [runId="unknown"] - Unique run identifier for logging
 * @returns {Object} {
 *   approved: Array<Object>,     // Clean signals approved for fusion
 *   excluded: Array<Object>,     // Signals permanently rejected (with editorialScores)
 *   deferred: Array<Object>,     // Signals deferred for future runs (with editorialScores)
 *   editorialSummary: {          // Summary of editorial decisions
 *     totalInput: number,
 *     included: number,
 *     excluded: number,
 *     deferred: number,
 *     timestamp: string,
 *     rationale: string,
 *     categoryBalance: Object    // Per-category counts after enforcement
 *   }
 * }
 */
export function runEditorialReview(signals, runId = "unknown") {
  // ── Guard: empty input ─────────────────────────────────────────────
  if (!Array.isArray(signals) || signals.length === 0) {
    return {
      approved: [],
      excluded: [],
      deferred: [],
      editorialSummary: {
        totalInput: 0,
        included: 0,
        excluded: 0,
        deferred: 0,
        timestamp: new Date().toISOString(),
        rationale: "No signals to evaluate.",
        categoryBalance: {},
      },
    };
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log("📋 EDITORIAL STRATEGIST — Evaluating signals");
  console.log("═══════════════════════════════════════════════");
  console.log(`   Run ID: ${runId}`);
  console.log(`   Total input signals: ${signals.length}`);
  console.log(`   Max per category: ${MAX_PER_CATEGORY}`);

  // ── Step 1: Score every signal on all 4 dimensions ─────────────
  const evaluated = signals.map((signal) => {
    const scores = evaluateSignal(signal);
    return {
      ...signal,
      editorialScores: scores,
    };
  });

  // ── Step 2: Separate by publish decision ────────────────────────
  let included = evaluated.filter(
    (s) => s.editorialScores.publishDecision === "INCLUDE"
  );
  let excluded = evaluated.filter(
    (s) => s.editorialScores.publishDecision === "EXCLUDE"
  );
  let deferred = evaluated.filter(
    (s) => s.editorialScores.publishDecision === "DEFER"
  );

  // ── Step 3: Enforce category balance on INCLUDED signals ────────
  // This may downgrade some INCLUDED signals to DEFER
  const balanced = enforceCategoryBalance(included);

  const finalIncluded = balanced.filter(
    (s) => s.editorialScores.publishDecision === "INCLUDE"
  );
  const newlyDeferred = balanced.filter(
    (s) => s.editorialScores.publishDecision === "DEFER"
  );

  // Move newly deferred into the deferred pool
  deferred = [...deferred, ...newlyDeferred];

  // ── Step 4: Log all rejections (persistent, for learning) ───────
  const timestamp = new Date().toISOString();
  for (const signal of excluded) {
    logRejectedStory(
      signal,
      signal.editorialScores.rejectionReason || "EXCLUDED",
      timestamp
    );
  }
  for (const signal of deferred) {
    logRejectedStory(
      signal,
      `DEFERRED: ${signal.editorialScores.rejectionReason || "DEFERRED"}`,
      timestamp
    );
  }

  // ── Step 5: Build category balance breakdown ────────────────────
  const categoryBalance = {};
  for (const s of finalIncluded) {
    const cat = SIGNAL_TYPE_TO_CATEGORY[s.signalType] || "other";
    categoryBalance[cat] = (categoryBalance[cat] || 0) + 1;
  }

  // ── Step 6: Build editorial rationale ───────────────────────────
  const rationale = buildRationale(finalIncluded, excluded, deferred);

  // ── Step 7: Log editorial decisions for this run ────────────────
  logEditorialDecision(runId, finalIncluded, excluded, deferred, rationale);

  // ── Step 8: Print editorial summary ─────────────────────────────
  console.log(`\n   📊 Editorial Review Results:`);
  console.log(`   ✅ INCLUDED: ${finalIncluded.length}`);
  console.log(`   ❌ EXCLUDED: ${excluded.length}`);
  console.log(`   ⏭️  DEFERRED: ${deferred.length}`);
  console.log(`   📊 Category balance: ${JSON.stringify(categoryBalance)}`);
  console.log(`   📝 Rationale: ${rationale}`);
  console.log("═══════════════════════════════════════════════\n");

  // ── Step 9: Return clean signals (strip editorial metadata) ─────
  // Downstream consumers (fusion engine, DeepSeek) should only see
  // clean signal data without internal scoring metadata.
  const cleanApproved = finalIncluded.map(
    ({ editorialScores, ...signal }) => signal
  );

  return {
    approved: cleanApproved,
    excluded,
    deferred,
    editorialSummary: {
      totalInput: signals.length,
      included: finalIncluded.length,
      excluded: excluded.length,
      deferred: deferred.length,
      timestamp,
      rationale,
      categoryBalance,
    },
  };
}

/**
 * Get the current MAX_PER_CATEGORY value.
 * Exposed for testing and configuration.
 */
export function getMaxPerCategory() {
  return MAX_PER_CATEGORY;
}
