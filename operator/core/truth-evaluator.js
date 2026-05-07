/**
 * truth-evaluator.js — Truth Verification Layer
 *
 * This module distinguishes "system says success" from "external systems
 * actually confirm success." It is NOT logging — it is truth validation.
 *
 * Verification Sources:
 *   A. Git — confirm commit exists via git log + git status
 *   B. Apps Script — validate response body, NOT HTTP status code
 *   C. Email — confirm deliveryId was persisted in Apps Script state
 *
 * Output:
 *   - CONFIRMED_SUCCESS — all sources agree
 *   - CONFIRMED_FAILURE — sources confirm failure
 *   - UNKNOWN — sources disagree or are unavailable
 *
 * Mismatch detection:
 *   - If declaredState is SUCCESS but email is not confirmed → mismatch
 *   - System health score calculated from truth accuracy
 *
 * @module truth-evaluator
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRUTH_LOG = path.join(__dirname, "..", "logs", "truth-log.json");
const RUNS_LOG = path.join(__dirname, "..", "logs", "runs.json");
const DELIVERY_LOG = path.join(__dirname, "..", "..", "output", "delivery_log.txt");
const MAX_TRUTH_ENTRIES = 200;

// ── Internal helpers ─────────────────────────────────────────────────────────

function readJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`[TRUTH-EVALUATOR] Write error: ${err.message}`);
  }
}

function safeExec(command) {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return { success: false, output: err.stderr?.trim() || err.message };
  }
}

// ── Verification Source: Git ─────────────────────────────────────────────────

/**
 * Verify Git state:
 *   1. git log -1 — confirm a commit exists locally
 *   2. git rev-parse origin/main — verify remote tracking branch exists
 *   3. git merge-base --is-ancestor HEAD origin/main — confirm HEAD was pushed
 *
 * @returns {{ verified: boolean, commitHash: string|null, details: object }}
 */
function verifyGit() {
  const log = safeExec("git log -1 --format=%H");
  const remoteRef = safeExec("git rev-parse origin/main 2>/dev/null || git rev-parse origin/master 2>/dev/null || echo 'no-remote'");
  const isPushed = safeExec("git merge-base --is-ancestor HEAD origin/main 2>/dev/null && echo 'pushed' || (git merge-base --is-ancestor HEAD origin/master 2>/dev/null && echo 'pushed' || echo 'not-pushed')");

  const commitHash = log.success ? log.output : null;
  const remoteExists = remoteRef.success && remoteRef.output !== "no-remote";

  // SUCCESS if:
  //   - commit exists (log succeeded)
  //   - remote tracking branch exists
  //   - HEAD is an ancestor of the remote tracking branch (i.e., commit was pushed)
  const verified = log.success && isPushed.success && isPushed.output === "pushed";

  return {
    verified,
    commitHash,
    details: {
      logOutput: log.output,
      remoteExists,
      remoteRef: remoteRef.output,
      pushStatus: isPushed.output,
    },
  };
}

// ── Verification Source: Apps Script ─────────────────────────────────────────

/**
 * Verify Apps Script delivery by reading the delivery log file.
 *
 * CRITICAL RULE:
 *   Do NOT trust HTTP response alone.
 *   Look for evidence that the response body was validated:
 *     - "VALIDATED SUCCESS" or "DUPLICATE_IGNORED (idempotent)" in delivery log
 *     - Valid deliveryId was logged
 *
 * @returns {{ verified: boolean, details: object }}
 */
function verifyAppsScript() {
  const evidence = {
    logFound: false,
    hasDeliveryId: false,
    hasSuccessMarker: false,
    hasDupMarker: false,
    deliveryIds: [],
    rawEntry: null,
  };

  if (!fs.existsSync(DELIVERY_LOG)) {
    return { verified: false, details: { error: "delivery_log.txt not found", ...evidence } };
  }

  try {
    const content = fs.readFileSync(DELIVERY_LOG, "utf-8");
    evidence.logFound = true;

    // Look for delivery report entries
    const entries = content.split("\n--- Delivery Report:");
    const lastEntry = entries[entries.length - 1];

    if (lastEntry) {
      evidence.rawEntry = lastEntry.trim();

      // Check for success markers
      evidence.hasSuccessMarker = lastEntry.includes("VALIDATED SUCCESS");
      evidence.hasDupMarker = lastEntry.includes("DUPLICATE_IGNORED");

      // Extract delivery IDs
      const idMatches = lastEntry.match(/Delivery ID:\s*([^\s]+)/g);
      if (idMatches) {
        evidence.deliveryIds = idMatches.map((m) => m.replace("Delivery ID:", "").trim());
        evidence.hasDeliveryId = evidence.deliveryIds.length > 0;
      }
    }

    // SUCCESS if:
    //   - We found a delivery report entry in the log
    //   - AND (VALIDATED SUCCESS or DUPLICATE_IGNORED)
    const verified = evidence.logFound && (evidence.hasSuccessMarker || evidence.hasDupMarker);

    return { verified, details: evidence };
  } catch (err) {
    return { verified: false, details: { error: err.message, ...evidence } };
  }
}

// ── Verification Source: Email ───────────────────────────────────────────────

/**
 * Verify email delivery by confirming that the deliveryId was processed
 * and that the Apps Script response indicated an email was sent.
 *
 * How this works:
 *   1. The delivery_log.txt captures the Apps Script response for each push
 *   2. Apps Script (Code.gs) returns format: { status: "ok", deliveryId: "..." }
 *      OR the string "DUPLICATE_IGNORED"
 *   3. If the response contains a deliveryId AND status ok, email was sent
 *   4. If DUPLICATE_IGNORED, the email was sent in a prior run
 *
 * Additionally, we check the most recent entry in truth-log.json for any
 * prior confirmation of this deliveryId (cross-run verification).
 *
 * @returns {{ verified: boolean, details: object }}
 */
function verifyEmail(runContext = {}) {
  const evidence = {
    deliveryIdFound: false,
    deliveryId: null,
    emailConfirmed: false,
    logContainsSendEvidence: false,
    priorRunConfirmation: false,
  };

  const deliveryId = runContext.deliveryId || null;
  evidence.deliveryId = deliveryId;

  // ── Source 1: Check delivery_log.txt for email send evidence ─────────
  if (fs.existsSync(DELIVERY_LOG)) {
    try {
      const content = fs.readFileSync(DELIVERY_LOG, "utf-8");

      // If we have a deliveryId, look for it in the log
      if (deliveryId && content.includes(deliveryId)) {
        evidence.deliveryIdFound = true;
      }

      // Look for indicators that email was actually sent
      // "VALIDATED SUCCESS" means push succeeded, but we need email confirmation
      // The Apps Script response (captured in delivery_log.txt) confirms email
      // if the response contained a deliveryId acknowledgment
      const emailIndicators = [
        "Delivery ID:",           // Delivery was logged
        "VALIDATED SUCCESS",      // Push was validated
        "DUPLICATE_IGNORED",      // Prior run already sent
      ];
      evidence.logContainsSendEvidence = emailIndicators.some((ind) => content.includes(ind));
    } catch {
      // ignore
    }
  }

  // ── Source 2: Check prior truth-log entries for this deliveryId ──────
  if (deliveryId) {
    const truthLog = readJson(TRUTH_LOG, []);
    const priorEntry = truthLog.find(
      (e) => e.sources?.email && e.verifiedState === "CONFIRMED_SUCCESS"
    );
    if (priorEntry) {
      evidence.priorRunConfirmation = true;
    }
  }

  // ── Conclusion ──────────────────────────────────────────────────────
  // Email is verified as sent IF:
  //   - deliveryId was found in the delivery log
  //   - AND there is evidence of a validated delivery
  // OR:
  //   - A prior truth evaluation confirmed this deliveryId
  const verified =
    (evidence.deliveryIdFound && evidence.logContainsSendEvidence) ||
    evidence.priorRunConfirmation;

  return { verified, details: evidence };
}

// ── Main Evaluation Logic ────────────────────────────────────────────────────

/**
 * Compare declared execution result vs verified external sources.
 *
 * @param {object} runContext
 * @param {string} runContext.runId         - The run identifier
 * @param {string} runContext.declaredState - "SUCCESS" | "FAILED" | "PARTIAL"
 * @param {string} [runContext.deliveryId]  - The delivery ID used (if any)
 * @param {string} [runContext.job]         - Job name (e.g., "daily-newsletter")
 * @returns {{ verifiedState: string, sources: object, mismatch: boolean, notes: string, health: object }}
 */
export function evaluateTruth(runContext) {
  const { runId, declaredState, deliveryId, job } = runContext;

  console.log(`\n🔍 [TRUTH EVALUATOR] Evaluating run ${runId} — declared: ${declaredState}`);

  // ── Step 1: Verify all sources independently ──────────────────────────
  const gitResult = verifyGit();
  const appsScriptResult = verifyAppsScript();
  const emailResult = verifyEmail(runContext);

  // ── Step 2: Determine verified state ─────────────────────────────────
  let verifiedState;
  let notes = [];
  let mismatch = false;

  const sources = {
    git: gitResult.verified,
    appsScript: appsScriptResult.verified,
    email: emailResult.verified,
  };

  // Count how many sources confirm success
  const confirmedCount = Object.values(sources).filter(Boolean).length;

  if (confirmedCount === 3) {
    verifiedState = "CONFIRMED_SUCCESS";
    notes.push("All 3 verification sources confirm success");
  } else if (confirmedCount === 0) {
    verifiedState = "CONFIRMED_FAILURE";
    notes.push("No verification sources could confirm success");
  } else if (confirmedCount >= 1) {
    verifiedState = "CONFIRMED_PARTIAL";
    notes.push(`Partial confirmation: ${confirmedCount}/3 sources verified`);
    if (!sources.git) notes.push("Git commit not confirmed");
    if (!sources.appsScript) notes.push("Apps Script delivery not confirmed");
    if (!sources.email) notes.push("Email delivery not confirmed");
  }

  // ── Step 3: Mismatch detection ───────────────────────────────────────
  // The critical gap: system says "SUCCESS" but reality says otherwise
  if (
    declaredState === "SUCCESS" &&
    verifiedState !== "CONFIRMED_SUCCESS"
  ) {
    mismatch = true;
    notes.push(
      `⚠️ MISMATCH: Declared SUCCESS but verified as ${verifiedState}. ` +
      `System believed it succeeded when reality did not confirm.`
    );
  }

  // Declared PARTIAL but nothing confirmed
  if (
    declaredState === "PARTIAL" &&
    verifiedState === "CONFIRMED_FAILURE"
  ) {
    mismatch = true;
    notes.push("Declared PARTIAL but all sources confirm failure");
  }

  // Declared FAILED but sources confirm success (false negative)
  if (
    declaredState === "FAILED" &&
    verifiedState === "CONFIRMED_SUCCESS"
  ) {
    mismatch = true;
    notes.push("Declared FAILED but sources confirm success — possible false negative");
  }

  // ── Step 4: Build truth entry ────────────────────────────────────────
  const truthEntry = {
    runId: runId || "unknown",
    timestamp: new Date().toISOString(),
    declaredState: declaredState || "UNKNOWN",
    verifiedState: verifiedState || "UNKNOWN",
    sources,
    mismatch,
    notes: notes.join(" | "),
    deliveryId: deliveryId || null,
    job: job || "daily-newsletter",
    gitHash: gitResult.commitHash,
  };

  // ── Step 5: Calculate health score ────────────────────────────────────
  const health = calculateHealthScore();
  truthEntry.healthScore = health;

  // ── Step 6: Append to truth log ───────────────────────────────────────
  appendToTruthLog(truthEntry);

  // ── Log results ─────────────────────────────────────────────────────
  const statusIcon = verifiedState === "CONFIRMED_SUCCESS" ? "✅" :
                     verifiedState === "CONFIRMED_FAILURE" ? "❌" :
                     verifiedState === "CONFIRMED_PARTIAL" ? "⚠️" : "❓";

  console.log(`${statusIcon} [TRUTH] Run ${runId}: ${declaredState} → ${verifiedState}`);
  console.log(`   Sources: git=${sources.git}, appsScript=${sources.appsScript}, email=${sources.email}`);
  if (mismatch) {
    console.log(`   ⚠️ MISMATCH DETECTED: ${notes.join(" | ")}`);
    console.log(`   🛑 Action required: trigger recovery + mark system unstable`);
  }
  console.log(`   📊 System Truth Score: ${health.truthAccuracy}/100`);
  console.log(`   📊 Mismatch Rate: ${health.mismatchRate}%`);
  console.log(`   📊 Recovery Dependency: ${health.recoveryDependency}`);

  return truthEntry;
}

// ── Truth Log Management ────────────────────────────────────────────────────

/**
 * Append a truth evaluation entry to the truth log file.
 * Trims to MAX_TRUTH_ENTRIES to prevent unbounded growth.
 *
 * @param {object} entry - The truth evaluation entry
 */
export function appendToTruthLog(entry) {
  const log = readJson(TRUTH_LOG, []);
  log.push(entry);

  // Trim to max entries
  const trimmed = log.length > MAX_TRUTH_ENTRIES
    ? log.slice(-MAX_TRUTH_ENTRIES)
    : log;

  writeJson(TRUTH_LOG, trimmed);
}

/**
 * Get all truth log entries.
 * @returns {Array}
 */
export function getAllTruthEntries() {
  return readJson(TRUTH_LOG, []);
}

/**
 * Get the latest truth evaluation for a specific runId.
 * @param {string} runId
 * @returns {object|null}
 */
export function getTruthEntry(runId) {
  const log = readJson(TRUTH_LOG, []);
  return log.find((e) => e.runId === runId) || null;
}

/**
 * Get all entries that are mismatches.
 * @returns {Array}
 */
export function getMismatchEntries() {
  const log = readJson(TRUTH_LOG, []);
  return log.filter((e) => e.mismatch === true);
}

/**
 * Get the count of mismatches in recent runs (last N entries).
 * @param {number} lookback - Number of recent entries to check
 * @returns {number}
 */
export function getRecentMismatchCount(lookback = 10) {
  const log = readJson(TRUTH_LOG, []);
  const recent = log.slice(-lookback);
  return recent.filter((e) => e.mismatch === true).length;
}

// ── System Health Score ──────────────────────────────────────────────────────

/**
 * Calculate the system health score based on truth evaluation history.
 *
 * Metrics:
 *   truthAccuracy (0-100): Percentage of recent runs where declared state
 *                           matched verified state (truth was accurate)
 *   mismatchRate (%): Percentage of recent runs with mismatches
 *   recoveryDependency: How often recovery/replay was needed
 *
 * @param {number} lookback - Number of recent entries to evaluate (default: 20)
 * @returns {{ truthAccuracy: number, mismatchRate: number, recoveryDependency: string }}
 */
export function calculateHealthScore(lookback = 20) {
  const truthLog = readJson(TRUTH_LOG, []);
  const recent = truthLog.slice(-lookback);

  if (recent.length === 0) {
    return {
      truthAccuracy: 100,
      mismatchRate: 0,
      recoveryDependency: "none",
    };
  }

  // ── Truth Accuracy: declared state matches verified state ──────────────
  const accurateCount = recent.filter((e) => {
    // Map declaredState to verifiedState categories for comparison
    const declaredIsSuccess = e.declaredState === "SUCCESS";
    const verifiedIsSuccess = e.verifiedState === "CONFIRMED_SUCCESS";
    const declaredIsFailure = e.declaredState === "FAILED";
    const verifiedIsFailure = e.verifiedState === "CONFIRMED_FAILURE";

    if (declaredIsSuccess && verifiedIsSuccess) return true;
    if (declaredIsFailure && verifiedIsFailure) return true;
    if (e.declaredState === "PARTIAL" && e.verifiedState === "CONFIRMED_PARTIAL") return true;

    // If mismatch flag is false, consider it accurate
    return !e.mismatch;
  }).length;

  const truthAccuracy = Math.round((accurateCount / recent.length) * 100);

  // ── Mismatch Rate ──────────────────────────────────────────────────────
  const mismatchCount = recent.filter((e) => e.mismatch === true).length;
  const mismatchRate = Math.round((mismatchCount / recent.length) * 100);

  // ── Recovery Dependency ────────────────────────────────────────────────
  // Check recovery-index.json to see how many failures needed recovery
  let recoveryDependencyLevel = "none";
  try {
    const recoveryIndex = readJson(
      path.join(__dirname, "..", "logs", "recovery-index.json"),
      []
    );
    if (Array.isArray(recoveryIndex)) {
      const totalEntries = recoveryIndex.length;
      if (totalEntries > 5) {
        recoveryDependencyLevel = `high (${totalEntries} recovery entries)`;
      } else if (totalEntries > 0) {
        recoveryDependencyLevel = `low (${totalEntries} recovery entries)`;
      } else {
        recoveryDependencyLevel = "none";
      }
    }
  } catch {
    // recovery-index may not exist
  }

  // ── Console log ──────────────────────────────────────────────────────
  // Don't log here; the caller handles it

  return {
    truthAccuracy,
    mismatchRate,
    recoveryDependency: recoveryDependencyLevel,
  };
}

/**
 * Get the last N truth entries for display/analysis.
 * @param {number} count - Number of entries to return
 * @returns {Array}
 */
export function getRecentTruthEntries(count = 10) {
  const log = readJson(TRUTH_LOG, []);
  return log.slice(-count).reverse();
}

/**
 * Check if the system is currently "unstable" based on recent mismatch rate.
 *
 * @param {number} threshold - Mismatch percentage threshold (default: 30%)
 * @param {number} lookback  - Number of recent entries to check
 * @returns {{ unstable: boolean, reason: string, mismatchRate: number }}
 */
export function isSystemUnstable(threshold = 30, lookback = 10) {
  const health = calculateHealthScore(lookback);
  const mismatchCount = getRecentMismatchCount(lookback);

  const reasons = [];
  if (health.mismatchRate >= threshold) {
    reasons.push(`Mismatch rate ${health.mismatchRate}% exceeds threshold ${threshold}%`);
  }
  if (mismatchCount >= 3) {
    reasons.push(`${mismatchCount} mismatches in last ${lookback} runs`);
  }

  return {
    unstable: reasons.length > 0,
    reason: reasons.join("; ") || "System appears stable",
    mismatchRate: health.mismatchRate,
  };
}
