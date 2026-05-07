/**
 * fault.js — Self-Healing Execution Layer
 *
 * Provides:
 *   - Failure classification (TRANSIENT / PERMANENT / BLOCKED / UNKNOWN)
 *   - Step-level retry with backoff (up to 2 retries for transient failures)
 *   - File-level rollback (delete created files, restore modified from backup)
 *   - Structured failure logging to /logs/failures.json
 *
 * @module fault
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "..", "logs");
const FAILURES_FILE = path.join(LOGS_DIR, "failures.json");
const MAX_FAILURES = 100;

// ── FAILURE CLASSIFICATION ──────────────────────────────────────────────

/**
 * Classify a failure based on error message content.
 *
 * @param {string} error - The error message to classify
 * @returns {"TRANSIENT"|"PERMANENT"|"BLOCKED"|"UNKNOWN"}
 */
export function classifyFailure(error) {
  if (!error || typeof error !== "string") return "UNKNOWN";

  const msg = error.toLowerCase();

  // ── TRANSIENT: Retryable failures ────────────────────────────────────
  // Git network issues, API timeouts, file locks, service unavailability
  const transientPatterns = [
    "git network",
    "timeout",
    "econnrefused",
    "econnreset",
    "enotfound",
    "socket hang up",
    "etimedout",
    "file lock",
    "eagain",
    "ebusy",
    "rate limit",
    "service unavailable",
    "502",
    "503",
    "429",
    "git push",
    "fetch failed",
    "network error",
    "eai_again",
    "eisdir", // directory-related retryable FS operations
  ];
  if (transientPatterns.some((p) => msg.includes(p))) return "TRANSIENT";

  // ── PERMANENT: Non-retryable failures ────────────────────────────────
  // Invalid JSON, missing file paths, syntax errors in step
  const permanentPatterns = [
    "invalid json",
    "syntaxerror",
    "enoent",
    "eexist",
    "missing file",
    "path traversal",
    "blocked path",
    "invalid instruction",
    "malformed",
    "parse error",
    "empty",
    "undefined is not",
    "cannot read property",
    "typeerror",
  ];
  if (permanentPatterns.some((p) => msg.includes(p))) return "PERMANENT";

  // ── BLOCKED: Safety policy violations ────────────────────────────────
  // Safety policy violations, forbidden fs actions
  const blockedPatterns = [
    "safety",
    "blocked",
    "forbidden",
    "policy violation",
    "not allowed",
    "permission denied",
    "eacces",
    "security",
  ];
  if (blockedPatterns.some((p) => msg.includes(p))) return "BLOCKED";

  // ── UNKNOWN: Anything else ───────────────────────────────────────────
  return "UNKNOWN";
}

// ── STEP-LEVEL RETRY LOGIC ──────────────────────────────────────────────

/**
 * Execute a step function with retry logic.
 *
 * - Up to 2 retries on failure (total 3 attempts)
 * - Retries only for TRANSIENT or UNKNOWN failures
 * - Does NOT retry PERMANENT or BLOCKED failures
 * - Waits 2 seconds between retries
 *
 * @param {Function} fn - Async step function to execute
 * @param {object} [context={}] - Step metadata (type, action, path)
 * @param {string} [runId="unknown"] - Current run ID for traceability
 * @returns {Promise<{success: boolean, retryCount: number, classification: string|null, error: string|null}>}
 */
export async function executeWithRetry(fn, context = {}, runId = "unknown") {
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 2000;

  let retryCount = 0;
  let lastError = null;
  let classification = "UNKNOWN";

  for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt++) {
    try {
      await fn();
      // Success — return clean result
      return { success: true, retryCount, classification: null, error: null };
    } catch (err) {
      lastError = err;
      const errorMsg = err.message || String(err);
      classification = classifyFailure(errorMsg);

      console.log(
        `   ⚠️ [ATTEMPT ${attempt}/${1 + MAX_RETRIES}] ${classification}: ${errorMsg}`
      );

      // PERMANENT and BLOCKED failures — do NOT retry
      if (classification === "PERMANENT" || classification === "BLOCKED") {
        console.log(`   🛑 ${classification} failure — no retry`);
        break;
      }

      // TRANSIENT and UNKNOWN — retry up to MAX_RETRIES times
      if (attempt <= MAX_RETRIES) {
        retryCount++;
        console.log(
          `   ⏳ Retrying in ${RETRY_DELAY_MS / 1000}s... ` +
            `(${MAX_RETRIES - attempt + 1} retries remaining)`
        );
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  // All attempts exhausted
  return {
    success: false,
    retryCount,
    classification,
    error: lastError?.message || "Unknown error",
  };
}

// ── ROLLBACK LOGIC ──────────────────────────────────────────────────────

/**
 * Create a backup of a file before modification.
 *
 * @param {string} filePath - Absolute path of the file to back up
 * @returns {string|null} Backup path, or null if file doesn't exist
 */
export function backupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const backupPath = filePath + ".bak";
      fs.copyFileSync(filePath, backupPath);
      console.log(`   📋 [BACKUP] Created backup: ${path.basename(backupPath)}`);
      return backupPath;
    }
  } catch (err) {
    console.log(`   ⚠️ [BACKUP ERROR] ${err.message}`);
  }
  return null;
}

/**
 * Rollback file system changes for a failed step.
 *
 * Rules:
 *   - If file was CREATED → delete it
 *   - If file was MODIFIED → restore from backup if available
 *   - Git commits are NEVER auto-reverted (logged only)
 *
 * @param {Array} changes - Array of change records
 * @returns {boolean} Whether any rollback was performed
 */
export function rollbackChanges(changes) {
  if (!changes || changes.length === 0) return false;

  let performed = false;

  for (const change of changes) {
    try {
      switch (change.type) {
        case "create":
          if (fs.existsSync(change.path)) {
            fs.unlinkSync(change.path);
            console.log(`   🔄 [ROLLBACK] Deleted created file: ${change.path}`);
            performed = true;
          }
          break;

        case "modify":
          if (change.backup && fs.existsSync(change.backup)) {
            const content = fs.readFileSync(change.backup, "utf-8");
            fs.writeFileSync(change.path, content, "utf-8");
            fs.unlinkSync(change.backup);
            console.log(`   🔄 [ROLLBACK] Restored file from backup: ${change.path}`);
            performed = true;
          }
          break;

        case "git":
          // Git commits are NEVER auto-reverted — log only
          console.log(
            `   📝 [ROLLBACK INFO] Git commit NOT reverted: "${change.message}"`
          );
          break;

        default:
          break;
      }
    } catch (err) {
      console.log(
        `   ⚠️ [ROLLBACK ERROR] Could not revert ${change.path}: ${err.message}`
      );
    }
  }

  return performed;
}

// ── FAILURE LOG STRUCTURE ───────────────────────────────────────────────

/**
 * Append a failure entry to /logs/failures.json.
 * Automatically trims to the last 100 entries.
 *
 * @param {string} runId - Unique run identifier
 * @param {object|string} step - The step that failed
 * @param {string} error - Error message
 * @param {string} classification - Failure classification
 * @param {number} retryCount - Number of retries attempted
 * @param {boolean} rollbackPerformed - Whether rollback was executed
 */
export function logFailureEntry(
  runId,
  step,
  error,
  classification,
  retryCount,
  rollbackPerformed = false
) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });

    let entries = [];
    if (fs.existsSync(FAILURES_FILE)) {
      try {
        entries = JSON.parse(fs.readFileSync(FAILURES_FILE, "utf-8"));
        if (!Array.isArray(entries)) entries = [];
      } catch {
        entries = [];
      }
    }

    entries.push({
      runId: runId || "unknown",
      step: typeof step === "object" ? JSON.stringify(step) : String(step),
      error: error || "Unknown error",
      classification: classification || "UNKNOWN",
      retryCount: retryCount || 0,
      timestamp: new Date().toISOString(),
      rollbackPerformed: !!rollbackPerformed,
    });

    // Trim to last 100 entries
    if (entries.length > MAX_FAILURES) {
      entries = entries.slice(-MAX_FAILURES);
    }

    fs.writeFileSync(FAILURES_FILE, JSON.stringify(entries, null, 2), "utf-8");
    console.log(`   📝 [FAILURE LOGGED] ${FAILURES_FILE}`);
  } catch (err) {
    console.error(
      `[FAILURE LOG ERROR] Could not write to failures.json: ${err.message}`
    );
  }
}

// ── HELPER ───────────────────────────────────────────────────────────────

/**
 * Promise-based sleep helper.
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
