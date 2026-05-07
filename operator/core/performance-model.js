/**
 * performance-model.js — Rule-Based Performance Scoring Model (v1)
 *
 * Pure deterministic performance analysis. No ML. No external services.
 * Calculates scoring signals from feedback history + event store.
 *
 * OUTPUT SIGNALS:
 *   GCC_Relevance_Trend  — avg of last N runs' gcc_score
 *   Insight_Decay        — repeated "low macro insight" tag frequency
 *   Content_Quality      — weighted average clarity + readability + market depth
 *   Weakness_Frequency   — per-weakness count in recent runs
 *   Topic_Performance    — GCC relevance trends over time
 *
 * Used by optimizer.js to make evidence-based config adjustments.
 *
 * @module performance-model
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, "..", "logs");
const FEEDBACK_FILE = path.join(LOGS_DIR, "feedback.json");
const TRUTH_LOG = path.join(LOGS_DIR, "truth-log.json");

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_LOOKBACK = 10;
const SCORE_WEIGHTS = {
  clarity: 0.25,
  gccRelevance: 0.35,
  marketDepth: 0.25,
  readability: 0.15,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : defaultValue;
  } catch {
    return defaultValue;
  }
}

// ── Scoring Signal Calculators ───────────────────────────────────────────────

/**
 * Calculate GCC Relevance Trend over recent runs.
 *
 * @param {Array} feedbackHistory - Full feedback entries
 * @param {number} lookback - Number of recent runs
 * @returns {{ average: number, min: number, max: number, trend: "rising"|"falling"|"stable", dataPoints: number }}
 */
function calculateGccRelevanceTrend(feedbackHistory, lookback = DEFAULT_LOOKBACK) {
  const valid = feedbackHistory
    .filter((e) => e.runId !== "init" && typeof e.score?.gccRelevance === "number")
    .slice(-lookback);

  if (valid.length < 2) {
    return { average: 7, min: 7, max: 7, trend: "stable", dataPoints: valid.length };
  }

  const scores = valid.map((e) => e.score.gccRelevance);
  const average = scores.reduce((s, v) => s + v, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  // Compare first half vs second half for trend
  const mid = Math.floor(scores.length / 2);
  const firstHalf = scores.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const secondHalf = scores.slice(mid).reduce((s, v) => s + v, 0) / (scores.length - mid);

  let trend = "stable";
  if (secondHalf - firstHalf > 0.5) trend = "rising";
  else if (firstHalf - secondHalf > 0.5) trend = "falling";

  return {
    average: Math.round(average * 100) / 100,
    min,
    max,
    trend,
    dataPoints: valid.length,
  };
}

/**
 * Calculate Insight Decay — measures how often "low macro insight"
 * or "low market depth" weaknesses appear.
 *
 * @param {Array} feedbackHistory
 * @param {number} lookback
 * @returns {{ decayScore: number, insightWeaknessRate: number, depthWeaknessRate: number, raw: object }}
 */
function calculateInsightDecay(feedbackHistory, lookback = DEFAULT_LOOKBACK) {
  const valid = feedbackHistory
    .filter((e) => e.runId !== "init")
    .slice(-lookback);

  if (valid.length < 3) {
    return { decayScore: 0, insightWeaknessRate: 0, depthWeaknessRate: 0, raw: {} };
  }

  const insightCount = valid.filter((e) =>
    (e.weaknessTags || []).includes("low macro insight")
  ).length;

  const depthCount = valid.filter((e) =>
    (e.weaknessTags || []).includes("low market depth — missing data points")
  ).length;

  const insightRate = insightCount / valid.length;
  const depthRate = depthCount / valid.length;

  // Decay score: 0 = no decay (good), 1 = severe decay (bad)
  const decayScore = Math.min(1, (insightRate * 0.6 + depthRate * 0.4));

  return {
    decayScore: Math.round(decayScore * 100) / 100,
    insightWeaknessRate: Math.round(insightRate * 100) / 100,
    depthWeaknessRate: Math.round(depthRate * 100) / 100,
    raw: { insightCount, depthCount, totalRuns: valid.length },
  };
}

/**
 * Calculate overall Content Quality — weighted average of clarity,
 * readability, and market depth scores.
 *
 * @param {Array} feedbackHistory
 * @param {number} lookback
 * @returns {{ composite: number, clarity: number, readability: number, marketDepth: number, dataPoints: number }}
 */
function calculateContentQuality(feedbackHistory, lookback = DEFAULT_LOOKBACK) {
  const valid = feedbackHistory
    .filter((e) => e.runId !== "init")
    .slice(-lookback);

  if (valid.length === 0) {
    return { composite: 7, clarity: 7, readability: 7, marketDepth: 7, dataPoints: 0 };
  }

  const clarity = valid.reduce((s, e) => s + (e.score.clarity || 7), 0) / valid.length;
  const readability = valid.reduce((s, e) => s + (e.score.readability || 7), 0) / valid.length;
  const marketDepth = valid.reduce((s, e) => s + (e.score.marketDepth || 7), 0) / valid.length;

  const composite =
    clarity * SCORE_WEIGHTS.clarity +
    readability * SCORE_WEIGHTS.readability +
    marketDepth * SCORE_WEIGHTS.marketDepth;

  return {
    composite: Math.round(composite * 100) / 100,
    clarity: Math.round(clarity * 100) / 100,
    readability: Math.round(readability * 100) / 100,
    marketDepth: Math.round(marketDepth * 100) / 100,
    dataPoints: valid.length,
  };
}

/**
 * Calculate weakness frequency — how often each weakness appears.
 *
 * @param {Array} feedbackHistory
 * @param {number} lookback
 * @returns {Array<{tag: string, count: number, rate: number}>}
 */
function calculateWeaknessFrequency(feedbackHistory, lookback = DEFAULT_LOOKBACK) {
  const valid = feedbackHistory
    .filter((e) => e.runId !== "init")
    .slice(-lookback);

  if (valid.length === 0) return [];

  const counts = {};
  for (const entry of valid) {
    const tags = new Set(entry.weaknessTags || []);
    for (const tag of tags) {
      if (tag !== "good quality — no major issues detected") {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }
  }

  return Object.entries(counts)
    .map(([tag, count]) => ({
      tag,
      count,
      rate: Math.round((count / valid.length) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Calculate truth accuracy trend from truth log.
 *
 * @param {number} lookback
 * @returns {{ accuracy: number, mismatchRate: number, dataPoints: number }}
 */
function calculateTruthAccuracy(lookback = 20) {
  const truthLog = readJson(TRUTH_LOG, []);
  const recent = truthLog.slice(-lookback);

  if (recent.length === 0) {
    return { accuracy: 100, mismatchRate: 0, dataPoints: 0 };
  }

  const mismatches = recent.filter((e) => e.mismatch === true).length;
  const accuracy = Math.max(0, 100 - Math.round((mismatches / recent.length) * 100));

  return {
    accuracy,
    mismatchRate: Math.round((mismatches / recent.length) * 100),
    dataPoints: recent.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate all performance metrics from feedback history.
 *
 * @param {number} [lookback=10]
 * @returns {object} Complete performance snapshot
 */
export function calculatePerformanceMetrics(lookback = DEFAULT_LOOKBACK) {
  const feedbackHistory = readJson(FEEDBACK_FILE, []);

  const gccTrend = calculateGccRelevanceTrend(feedbackHistory, lookback);
  const insightDecay = calculateInsightDecay(feedbackHistory, lookback);
  const contentQuality = calculateContentQuality(feedbackHistory, lookback);
  const weaknessFreq = calculateWeaknessFrequency(feedbackHistory, lookback);
  const truthAccuracy = calculateTruthAccuracy();

  // ── Composite Health Score ──────────────────────────────────────────
  // Weighted: GCC relevance (35%) + content quality (30%) + truth (20%) + decay penalty (15%)
  const gccScore = (gccTrend.average / 10) * 35;
  const qualityScore = (contentQuality.composite / 10) * 30;
  const truthScore = (truthAccuracy.accuracy / 100) * 20;
  const decayPenalty = (1 - insightDecay.decayScore) * 15;
  const compositeHealth = Math.round((gccScore + qualityScore + truthScore + decayPenalty) * 10) / 10;

  // ── Most impactful weakness ──────────────────────────────────────────
  const topWeakness = weaknessFreq.length > 0 ? weaknessFreq[0] : null;

  return {
    timestamp: new Date().toISOString(),
    compositeHealth,
    gccRelevanceTrend: gccTrend,
    insightDecay,
    contentQuality,
    weaknessFrequency: weaknessFreq,
    truthAccuracy,
    topWeakness: topWeakness
      ? { tag: topWeakness.tag, rate: topWeakness.rate }
      : null,
    lookback,
    signals: {
      gccScore: gccTrend.average,
      insightDecayScore: insightDecay.decayScore,
      contentQualityScore: contentQuality.composite,
      truthScore: truthAccuracy.accuracy,
      healthScore: compositeHealth,
    },
  };
}

/**
 * Get the list of tracked weakness tags from evaluator.
 * Static reference — not dependent on run data.
 *
 * @returns {string[]}
 */
export function getWeaknessTags() {
  return [
    "weak GCC specificity",
    "low market depth — missing data points",
    "too generic AI content",
    "generic AI filler language detected",
    "poor readability — structure issues",
    "low macro insight",
  ];
}

/**
 * Get version info.
 * @returns {string}
 */
export function getModelVersion() {
  return "1.0.0";
}

export default {
  calculatePerformanceMetrics,
  getWeaknessTags,
  getModelVersion,
};
