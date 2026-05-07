/**
 * optimizer.js — Controlled Self-Optimization Engine (v1)
 *
 * This is the final layer of the Gahwa system. It enables bounded, reversible
 * prompt evolution based on evidence from feedback + truth evaluation.
 *
 * STRICT CONSTRAINTS — system MUST NEVER:
 *   - change execution pipeline
 *   - modify operator.js logic
 *   - alter Apps Script architecture
 *   - introduce new tools or APIs
 *   - rewrite system prompts entirely
 *   - self-invent new capabilities
 *
 * ALLOWED OPTIMIZATIONS (STRICT LIMIT):
 *   A. Content bias tuning (increase GCC specificity, reduce generic AI phrasing)
 *   B. Structure tuning (improve section ordering, reduce repetition)
 *   C. Signal weighting (prioritize market/news relevance scoring)
 *
 * SAFETY GATES:
 *   - confidence < 0.7 → skip optimization
 *   - at least 3 consistent failures OR at least 5 consistent improvements
 *   - automatic rollback if optimization decreases quality
 *
 * @module optimizer
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "..", "prompts");
const LOGS_DIR = path.resolve(__dirname, "..", "logs");
const OPTIMIZATION_LOG = path.join(LOGS_DIR, "optimization-log.json");
const FEEDBACK_FILE = path.join(LOGS_DIR, "feedback.json");
const TRUTH_LOG = path.join(LOGS_DIR, "truth-log.json");
const MAX_OPTIMIZATION_ENTRIES = 50;
const MIN_CONFIDENCE = 0.7;
const MIN_CONSISTENT_FAILURES = 3;
const MIN_CONSISTENT_IMPROVEMENTS = 5;

// ── Optimization types (strictly bounded) ──────────────────────────────
const OPTIMIZATION_TYPES = {
  CONTENT_BIAS: "content_bias_tuning",
  STRUCTURE: "structure_tuning",
  SIGNAL_WEIGHTING: "signal_weighting",
};

// ── ALLOWED optimization directives — each is a reversible line addition ──
// These are the ONLY modifications the optimizer can make to prompts.
const ALLOWED_DIRECTIVES = {
  [OPTIMIZATION_TYPES.CONTENT_BIAS]: {
    gccSpecificity: [
      "OPTIMIZATION: Mandate at least 3 specific GCC country references (Saudi, UAE, Qatar) with local currency amounts in every newsletter.",
      "OPTIMIZATION: Prefer mentioning GCC city-level deals (Riyadh, Dubai, Doha, Abu Dhabi) and local company names (Aramco, ADNOC, QNB, stc, Emaar).",
      "OPTIMIZATION: Every section must open with a GCC-specific data point — regional GDP, sector growth, or transaction value in SAR/AED/QAR.",
    ],
    reduceGeneric: [
      "OPTIMIZATION: Eliminate all generic AI filler phrases ('delve', 'navigate', 'landscape', 'evolving', 'robust'). Use only direct, declarative sentences.",
      "OPTIMIZATION: Replace every instance of 'the region' or 'the Gulf' with the specific country name (Saudi Arabia, UAE, Qatar, etc.).",
      "OPTIMIZATION: No sentences may begin with 'As the', 'In the ever-', or 'The dynamic'. Start with concrete facts or data.",
    ],
  },
  [OPTIMIZATION_TYPES.STRUCTURE]: {
    sectionOrdering: [
      "OPTIMIZATION: Order sections by market impact: Saudi macro first, then UAE business, then Qatar/Kuwait/energy, then fintech, then global context.",
      "OPTIMIZATION: Group related sections under thematic headers: '🇸🇦 Saudi Market', '🇦🇪 UAE & Gulf', '💡 Innovation & Fintech', '🛢 Energy & Commodities'.",
      "OPTIMIZATION: Each section must follow the pattern: market context → specific data point → actionable insight. No section may exceed 3 short paragraphs.",
    ],
    reduceRepetition: [
      "OPTIMIZATION: No two sections may repeat the same country as the primary focus. Ensure each section covers a distinct GCC market.",
      "OPTIMIZATION: Vary section structure — alternate between market data sections, deal/transaction sections, and policy/regulatory sections.",
    ],
  },
  [OPTIMIZATION_TYPES.SIGNAL_WEIGHTING]: {
    marketRelevance: [
      "OPTIMIZATION: Prioritize stories with measurable market impact: IPOs, M&A deals, sovereign fund allocations, GDP data, and regulatory changes.",
      "OPTIMIZATION: Every section must include a forward-looking statement: 'What this means for [country]' with a specific projection or implication.",
      "OPTIMIZATION: Score each story's relevance: if it doesn't tie to a GCC-specific market movement or economic indicator, replace it.",
    ],
  },
};

// ── Directive type categories mapped to weakness tags ──────────────────
const WEAKNESS_TO_DIRECTIVE_MAP = [
  { weakness: "weak GCC specificity", type: OPTIMIZATION_TYPES.CONTENT_BIAS, key: "gccSpecificity" },
  { weakness: "low market depth — missing data points", type: OPTIMIZATION_TYPES.CONTENT_BIAS, key: "reduceGeneric" },
  { weakness: "too generic AI content", type: OPTIMIZATION_TYPES.CONTENT_BIAS, key: "reduceGeneric" },
  { weakness: "generic AI filler language detected", type: OPTIMIZATION_TYPES.CONTENT_BIAS, key: "reduceGeneric" },
  { weakness: "poor readability — structure issues", type: OPTIMIZATION_TYPES.STRUCTURE, key: "sectionOrdering" },
  { weakness: "low macro insight", type: OPTIMIZATION_TYPES.SIGNAL_WEIGHTING, key: "marketRelevance" },
];

// ═══════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Safely read a JSON file. Returns default value on failure.
 */
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

/**
 * Safely write a JSON file, creating directories as needed.
 */
function writeJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.log(`[OPTIMIZER] Failed to write ${filePath}: ${err.message}`);
  }
}

/**
 * Parse a prompt version string like "v1.0" → { major: 1, minor: 0 }
 */
function parseVersion(versionStr) {
  const match = versionStr.match(/v(\d+)\.(\d+)/);
  if (!match) return { major: 1, minor: 0 };
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

/**
 * Format version object back to string: { major: 1, minor: 2 } → "v1.2"
 */
function formatVersion(version) {
  return `v${version.major}.${version.minor}`;
}

/**
 * Get the current prompt version from the prompt file header.
 * Scans newsletter_prompt_v*.md files and returns the highest version.
 * @returns {{ version: string, path: string, content: string }}
 */
function getCurrentPromptVersionInfo() {
  try {
    if (!fs.existsSync(PROMPTS_DIR)) {
      return { version: "v1.0", path: path.join(PROMPTS_DIR, "newsletter_prompt_v1.md"), content: "" };
    }
    const files = fs.readdirSync(PROMPTS_DIR);
    const promptFiles = files
      .filter((f) => f.startsWith("newsletter_prompt_v") && f.endsWith(".md"))
      .sort();

    if (promptFiles.length === 0) {
      return { version: "v1.0", path: path.join(PROMPTS_DIR, "newsletter_prompt_v1.md"), content: "" };
    }

    const latestFile = promptFiles[promptFiles.length - 1];
    const content = fs.readFileSync(path.join(PROMPTS_DIR, latestFile), "utf-8");
    return { version: latestFile.replace("newsletter_prompt_", "").replace(".md", ""), path: path.join(PROMPTS_DIR, latestFile), content };
  } catch {
    return { version: "v1.0", path: path.join(PROMPTS_DIR, "newsletter_prompt_v1.md"), content: "" };
  }
}

/**
 * Get the feedback history array.
 */
function getFeedbackHistory() {
  return readJson(FEEDBACK_FILE, []);
}

/**
 * Get the truth log array.
 */
function getTruthLog() {
  return readJson(TRUTH_LOG, []);
}

/**
 * Get optimization log array.
 */
function getOptimizationLog() {
  return readJson(OPTIMIZATION_LOG, []);
}

/**
 * Append an entry to the optimization log, trimming to MAX_OPTIMIZATION_ENTRIES.
 */
function appendOptimizationLog(entry) {
  const log = getOptimizationLog();
  log.push(entry);
  const trimmed = log.length > MAX_OPTIMIZATION_ENTRIES
    ? log.slice(-MAX_OPTIMIZATION_ENTRIES)
    : log;
  writeJson(OPTIMIZATION_LOG, trimmed);
}

// ═══════════════════════════════════════════════════════════════════════
// SCORING & EVIDENCE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculate the running quality trend from recent feedback entries.
 *
 * For each of the last N runs, compare to the N-1 runs before them.
 * Returns a trend score: positive = improving, negative = declining.
 *
 * @param {Array} feedbackHistory - Full feedback history
 * @param {number} lookback - Number of recent runs to evaluate (5-10)
 * @returns {{ trend: number, avgScore: number, prevAvgScore: number, direction: "improving"|"declining"|"stable", dataPoints: number }}
 */
function calculateQualityTrend(feedbackHistory, lookback = 7) {
  const validEntries = feedbackHistory.filter(
    (e) => e && e.score && typeof e.score.overall === "number" && e.runId !== "init"
  );

  if (validEntries.length < 4) {
    return { trend: 0, avgScore: 7, prevAvgScore: 7, direction: "stable", dataPoints: validEntries.length };
  }

  const recent = validEntries.slice(-lookback);
  const previous = validEntries.slice(-(lookback * 2), -lookback);

  if (previous.length === 0) {
    return { trend: 0, avgScore: 7, prevAvgScore: 7, direction: "stable", dataPoints: recent.length };
  }

  const avgRecent = recent.reduce((sum, e) => sum + e.score.overall, 0) / recent.length;
  const avgPrevious = previous.reduce((sum, e) => sum + e.score.overall, 0) / previous.length;
  const trend = avgRecent - avgPrevious;

  let direction = "stable";
  if (trend > 0.5) direction = "improving";
  else if (trend < -0.5) direction = "declining";

  return {
    trend: Math.round(trend * 10) / 10,
    avgScore: Math.round(avgRecent * 10) / 10,
    prevAvgScore: Math.round(avgPrevious * 10) / 10,
    direction,
    dataPoints: recent.length,
  };
}

/**
 * Count how many of the last N runs had a specific weakness tag.
 *
 * @param {Array} feedbackHistory
 * @param {string} weaknessTag
 * @param {number} lookback
 * @returns {number}
 */
function countWeaknessOccurrences(feedbackHistory, weaknessTag, lookback = 7) {
  const recent = feedbackHistory.filter((e) => e.runId !== "init").slice(-lookback);
  return recent.filter((e) => (e.weaknessTags || []).includes(weaknessTag)).length;
}

/**
 * Check if the last optimization (if any) improved or degraded quality.
 *
 * @param {Array} feedbackHistory
 * @param {Array} optimizationLog
 * @returns {{ improved: boolean|null, reason: string }}
 */
function evaluateLastOptimization(feedbackHistory, optimizationLog) {
  if (optimizationLog.length === 0) {
    return { improved: null, reason: "No previous optimization to evaluate" };
  }

  const lastOpt = optimizationLog[optimizationLog.length - 1];
  if (lastOpt.decision === "REVERTED") {
    return { improved: false, reason: "Last optimization was already reverted" };
  }

  // Find feedback entries before and after the last optimization
  const optTimestamp = lastOpt.timestamp;
  const validEntries = feedbackHistory.filter((e) => e.runId !== "init");

  const beforeOpt = validEntries.filter((e) => e.timestamp < optTimestamp).slice(-3);
  const afterOpt = validEntries.filter((e) => e.timestamp >= optTimestamp).slice(-3);

  if (beforeOpt.length < 2 || afterOpt.length < 2) {
    return { improved: null, reason: "Insufficient data to evaluate last optimization" };
  }

  const avgBefore = beforeOpt.reduce((s, e) => s + e.score.overall, 0) / beforeOpt.length;
  const avgAfter = afterOpt.reduce((s, e) => s + e.score.overall, 0) / afterOpt.length;
  const diff = avgAfter - avgBefore;

  if (diff > 0.3) {
    return { improved: true, reason: `Quality improved by ${diff.toFixed(1)} pts after optimization` };
  } else if (diff < -0.3) {
    return { improved: false, reason: `Quality degraded by ${Math.abs(diff).toFixed(1)} pts after optimization` };
  }

  return { improved: null, reason: `No significant change (${diff.toFixed(1)} pts)` };
}

/**
 * Detect the most impactful weakness to optimize based on frequency.
 *
 * @param {Array} feedbackHistory
 * @param {number} lookback
 * @returns {{ weakness: string|null, count: number, directive: object|null, optType: string|null }}
 */
function identifyTargetWeakness(feedbackHistory, lookback = 7) {
  const validEntries = feedbackHistory.filter((e) => e.runId !== "init").slice(-lookback);

  if (validEntries.length < 3) {
    return { weakness: null, count: 0, directive: null, optType: null };
  }

  // Count each weakness tag
  const weaknessCounts = {};
  for (const entry of validEntries) {
    const tags = new Set(entry.weaknessTags || []);
    for (const tag of tags) {
      if (tag !== "good quality — no major issues detected") {
        weaknessCounts[tag] = (weaknessCounts[tag] || 0) + 1;
      }
    }
  }

  // Find the most frequent weakness
  let maxCount = 0;
  let topWeakness = null;
  for (const [tag, count] of Object.entries(weaknessCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topWeakness = tag;
    }
  }

  if (!topWeakness) {
    return { weakness: null, count: 0, directive: null, optType: null };
  }

  // Find the matching directive
  const mapping = WEAKNESS_TO_DIRECTIVE_MAP.find((m) => m.weakness === topWeakness);
  if (!mapping) {
    return { weakness: topWeakness, count: maxCount, directive: null, optType: null };
  }

  const directives = ALLOWED_DIRECTIVES[mapping.type];
  const directiveList = directives[mapping.key] || [];

  if (directiveList.length === 0) {
    return { weakness: topWeakness, count: maxCount, directive: null, optType: mapping.type };
  }

  return {
    weakness: topWeakness,
    count: maxCount,
    directive: directiveList[0], // Use the first directive for this weakness
    optType: mapping.type,
  };
}

/**
 * Calculate confidence in the optimization decision based on:
 *   - Number of data points (more = higher confidence)
 *   - Consistency of weakness detection
 *   - Trend direction alignment
 *
 * @param {{ weakness: string, count: number, dataPoints: number, trend: object }}
 * @returns {number} confidence 0.0 - 1.0
 */
function calculateConfidence({ weakness, count, dataPoints, trend }) {
  // Base confidence: 0.3
  let confidence = 0.3;

  // Bonus for data points: each data point above minimum adds 0.05
  if (dataPoints >= 5) confidence += 0.2;
  else if (dataPoints >= 3) confidence += 0.1;

  // Bonus for consistent weakness: each occurrence above 50% adds 0.05
  const occurrenceRate = count / Math.max(dataPoints, 1);
  if (occurrenceRate >= 0.7) confidence += 0.2;
  else if (occurrenceRate >= 0.5) confidence += 0.1;

  // Penalty if trend direction contradicts the weakness
  if (weakness && trend.direction === "improving") {
    // If quality is improving despite the weakness, lower confidence in needing change
    confidence -= 0.1;
  }

  // Bonus if trend is declining and we have a clear weakness
  if (weakness && trend.direction === "declining") {
    confidence += 0.15;
  }

  // Clamp to 0-1
  return Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
}

// ═══════════════════════════════════════════════════════════════════════
// PROMPT MODIFICATION (BOUNDED & REVERSIBLE)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Apply an optimization directive to the current prompt.
 * Creates a backup of the current version first, then appends the directive.
 *
 * @param {string} directive - The optimization directive line to add
 * @param {string} optType - The optimization type identifier
 * @returns {{ success: boolean, newVersion: string, backupPath: string }}
 */
function applyOptimization(directive, optType) {
  const promptInfo = getCurrentPromptVersionInfo();
  const version = parseVersion(promptInfo.version);
  const newMinor = version.minor + 1;
  const newVersion = formatVersion({ major: version.major, minor: newMinor });

  const backupPath = path.join(PROMPTS_DIR, `.backup_${promptInfo.version}.md`);

  try {
    // ── 1. Create backup of current prompt ─────────────────────────────
    fs.writeFileSync(backupPath, promptInfo.content, "utf-8");
    console.log(`[OPTIMIZER] Backup created: .backup_${promptInfo.version}.md`);

    // ── 2. Build new prompt content with optimization directive ─────────
    const optimizationSection = `\n\n---\n### Optimization — v${newVersion} (${optType})\n\n> Applied: ${new Date().toISOString()}\n> Trigger: Recurring ${optType.replace(/_/g, " ")}\n\n${directive}\n`;

    const newContent = promptInfo.content + optimizationSection;

    // ── 3. Update the version header in the prompt ──────────────────────
    const headerUpdated = newContent.replace(
      /# GAHWA Newsletter Prompt — v[\d.]+/,
      `# GAHWA Newsletter Prompt — ${newVersion}`
    );

    // Update or add the version line
    let finalContent;
    if (headerUpdated.includes("**Prompt Version:**")) {
      finalContent = headerUpdated.replace(
        /\*\*Prompt Version:\*\* v[\d.]+/,
        `**Prompt Version:** ${newVersion}`
      );
    } else {
      finalContent = headerUpdated;
    }

    // ── 4. Write new version file ──────────────────────────────────────
    const newPromptPath = path.join(PROMPTS_DIR, `newsletter_prompt_v${version.major}.md`);
    fs.writeFileSync(newPromptPath, finalContent, "utf-8");
    console.log(`[OPTIMIZER] Prompt evolved: ${promptInfo.version} → ${newVersion}`);

    return {
      success: true,
      newVersion,
      backupPath,
    };
  } catch (err) {
    console.log(`[OPTIMIZER] Failed to apply optimization: ${err.message}`);
    return { success: false, newVersion: promptInfo.version, backupPath: "" };
  }
}

/**
 * Revert the prompt to the previous version.
 * Uses the backup file created by the last applyOptimization call.
 *
 * @param {string} backupVersion - The version to revert from (e.g., "v1.1")
 * @returns {{ success: boolean, revertedVersion: string }}
 */
function revertOptimization(backupVersion) {
  const promptInfo = getCurrentPromptVersionInfo();
  const backupPath = path.join(PROMPTS_DIR, `.backup_${backupVersion}.md`);

  try {
    if (!fs.existsSync(backupPath)) {
      console.log(`[OPTIMIZER] Backup not found: ${backupPath} — cannot revert`);
      return { success: false, revertedVersion: promptInfo.version };
    }

    const backupContent = fs.readFileSync(backupPath, "utf-8");

    // Write backup content back to the main prompt file
    const promptPath = path.join(PROMPTS_DIR, `newsletter_prompt_v${parseVersion(backupVersion).major}.md`);
    fs.writeFileSync(promptPath, backupContent, "utf-8");

    // Remove backup file
    fs.unlinkSync(backupPath);

    console.log(`[OPTIMIZER] Reverted: ${promptInfo.version} → ${backupVersion}`);
    return { success: true, revertedVersion: backupVersion };
  } catch (err) {
    console.log(`[OPTIMIZER] Failed to revert: ${err.message}`);
    return { success: false, revertedVersion: promptInfo.version };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API — runOptimization
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run the full optimization cycle.
 *
 * Steps:
 *   1. Evaluate last N runs (5-10) for quality trend
 *   2. Identify target weakness from feedback history
 *   3. Calculate confidence based on evidence strength
 *   4. Check safety gates (confidence >= 0.7, sufficient evidence)
 *   5. Apply optimization or keep stable or revert previous
 *   6. Log decision to optimization-log.json
 *
 * @param {object} [options]
 * @param {number} [options.lookback=7] - Number of recent runs to evaluate
 * @returns {Promise<{ optimized: boolean, decision: string, reason: string, promptVersion: string, logEntry: object }>}
 */
export async function runOptimization(options = {}) {
  const lookback = options.lookback || 7;

  console.log("\n═══════════════════════════════════════════════════");
  console.log("🧬 OPTIMIZATION ENGINE — Running cycle");
  console.log("═══════════════════════════════════════════════════\n");

  // ── Step 1: Gather data ──────────────────────────────────────────────
  const feedbackHistory = getFeedbackHistory();
  const optimizationLog = getOptimizationLog();
  const promptInfo = getCurrentPromptVersionInfo();

  console.log(`📊 Feedback entries: ${feedbackHistory.filter(e => e.runId !== "init").length}`);
  console.log(`📊 Past optimizations: ${optimizationLog.length}`);
  console.log(`📊 Current prompt: ${promptInfo.version}`);

  // ── Step 2: Evaluate quality trend ──────────────────────────────────
  const qualityTrend = calculateQualityTrend(feedbackHistory, lookback);
  console.log(`📈 Quality trend: ${qualityTrend.direction} (${qualityTrend.trend > 0 ? "+" : ""}${qualityTrend.trend})`);
  console.log(`   Avg recent: ${qualityTrend.avgScore}/10, Avg previous: ${qualityTrend.prevAvgScore}/10`);

  // ── Step 3: Evaluate last optimization for rollback check ────────────
  const lastOptEval = evaluateLastOptimization(feedbackHistory, optimizationLog);

  // ── Step 4: Identify target weakness ────────────────────────────────
  const target = identifyTargetWeakness(feedbackHistory, lookback);
  console.log(`🎯 Target weakness: ${target.weakness || "none"} (${target.count}/${lookback} runs)`);

  // ── Step 5: Calculate confidence ─────────────────────────────────────
  const confidence = calculateConfidence({
    weakness: target.weakness,
    count: target.count,
    dataPoints: qualityTrend.dataPoints,
    trend: qualityTrend,
  });
  console.log(`🎲 Confidence: ${(confidence * 100).toFixed(0)}%`);

  // ── Step 6: Decision ─────────────────────────────────────────────────
  let decision = "NO_CHANGE";
  let reason = "";
  let changesApplied = [];
  let revertedVersion = null;

  // SAFETY GATE 1: Check if last optimization degraded quality
  if (lastOptEval.improved === false && optimizationLog.length > 0) {
    const lastOpt = optimizationLog[optimizationLog.length - 1];
    const revertTarget = lastOpt.promptVersion;

    console.log(`⚠️ Last optimization degraded quality — auto-reverting from ${promptInfo.version} to ${revertTarget}`);

    const revertResult = revertOptimization(revertTarget);
    if (revertResult.success) {
      decision = "REVERTED";
      reason = `Auto-rollback: ${lastOptEval.reason}. Reverted from ${promptInfo.version} to ${revertResult.revertedVersion}.`;
      changesApplied.push(`revert: ${promptInfo.version} → ${revertResult.revertedVersion}`);
      revertedVersion = revertResult.revertedVersion;
    } else {
      decision = "NO_CHANGE";
      reason = `Wanted to revert but backup not found: ${promptInfo.version}`;
    }
  }
  // SAFETY GATE 2: Confidence must be >= 0.7
  else if (confidence < MIN_CONFIDENCE) {
    decision = "NO_CHANGE";
    reason = `Confidence ${(confidence * 100).toFixed(0)}% below threshold ${MIN_CONFIDENCE * 100}% — insufficient evidence for optimization.`;
    console.log(`⏸️ ${reason}`);
  }
  // SAFETY GATE 3: Sufficient evidence required
  else if (target.count < MIN_CONSISTENT_FAILURES && target.count < MIN_CONSISTENT_IMPROVEMENTS) {
    decision = "NO_CHANGE";
    reason = `Insufficient evidence: ${target.weakness || "no weakness"} appeared only ${target.count} times (need ${MIN_CONSISTENT_FAILURES}+ failures or ${MIN_CONSISTENT_IMPROVEMENTS}+ improvements).`;
    console.log(`⏸️ ${reason}`);
  }
  // Apply optimization
  else if (target.weakness && target.directive) {
    console.log(`⚡ Applying optimization for "${target.weakness}"...`);

    const applyResult = applyOptimization(target.directive, target.optType);
    if (applyResult.success) {
      decision = "IMPROVED";
      reason = `Optimization applied for "${target.weakness}": ${target.optType.replace(/_/g, " ")}. ` +
        `Prompt evolved: ${promptInfo.version} → ${applyResult.newVersion}.`;
      changesApplied.push(target.directive);
      console.log(`✅ ${reason}`);
    } else {
      decision = "NO_CHANGE";
      reason = `Failed to apply optimization directive for "${target.weakness}".`;
      console.log(`❌ ${reason}`);
    }
  }
  // Fallback: keep stable
  else {
    decision = "NO_CHANGE";
    reason = "No actionable weaknesses detected. System is stable.";
    console.log(`✅ ${reason}`);
  }

  // ── Step 7: Build and log optimization entry ─────────────────────────
  const finalPromptInfo = getCurrentPromptVersionInfo();
  const logEntry = {
    // ── SINGLE IDENTITY: This is a log entry identifier, not an execution identity.
    // Previously generated a Date.now() based runId that could not be traced back
    // to the pipeline. Now uses a static label since this is purely for log tracking.
    runId: "optimizer-cycle",
    timestamp: new Date().toISOString(),

    metrics: {
      truthScore: calculateTruthScore(getTruthLog()),
      qualityScore: qualityTrend.avgScore,
      gccRelevance: calculateRecentGccScore(feedbackHistory, lookback),
    },
    promptVersion: finalPromptInfo.version,
    changesApplied,
    decision,
    reason,
    confidence,
    targetWeakness: target.weakness,
    qualityTrend: qualityTrend.direction,
    trendDelta: qualityTrend.trend,
    revertedFrom: revertedVersion ? promptInfo.version : null,
    revertedTo: revertedVersion,
    previousPromptVersion: promptInfo.version,
  };

  appendOptimizationLog(logEntry);

  console.log(`\n📝 Optimization log saved — decision: ${decision}`);
  console.log(`   Prompt: ${promptInfo.version} → ${finalPromptInfo.version}`);
  console.log("═══════════════════════════════════════════════════\n");

  return {
    optimized: decision === "IMPROVED" || decision === "REVERTED",
    decision,
    reason,
    promptVersion: finalPromptInfo.version,
    logEntry,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// METRIC HELPERS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculate an aggregate truth score (0-100) from the truth log.
 */
function calculateTruthScore(truthLog) {
  if (truthLog.length === 0) return 100;
  const recent = truthLog.slice(-20);
  const mismatches = recent.filter((e) => e.mismatch === true).length;
  const score = Math.max(0, 100 - Math.round((mismatches / recent.length) * 100));
  return score;
}

/**
 * Calculate recent average GCC relevance score from feedback.
 */
function calculateRecentGccScore(feedbackHistory, lookback = 7) {
  const valid = feedbackHistory
    .filter((e) => e.runId !== "init" && typeof e.score?.gccRelevance === "number")
    .slice(-lookback);
  if (valid.length === 0) return 7;
  const avg = valid.reduce((s, e) => s + e.score.gccRelevance, 0) / valid.length;
  return Math.round(avg * 10) / 10;
}

/**
 * Get the current optimization log for inspection.
 * @returns {Array}
 */
export function getOptimizationLogEntries() {
  return getOptimizationLog();
}

/**
 * Get the current prompt version string.
 * @returns {string}
 */
export function getCurrentPromptVersion() {
  return getCurrentPromptVersionInfo().version;
}

/**
 * Reset optimization state (for testing/recovery).
 * @param {boolean} [clearLog=false] - Whether to clear the optimization log
 */
export function resetOptimizerState(clearLog = false) {
  if (clearLog) {
    writeJson(OPTIMIZATION_LOG, []);
    console.log("[OPTIMIZER] Optimization log cleared");
  }
  console.log("[OPTIMIZER] State reset complete");
}
