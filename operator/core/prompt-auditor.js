/**
 * prompt-auditor.js — Prompt Execution Auditor & Orchestrator
 *
 * This is the THIRD component of the Prompt Execution Validator Layer.
 * It orchestrates the full validation pipeline:
 *
 *   1. BEFORE prompt execution:
 *      - Check if previous prompt was complete → block if incomplete
 *      - Log that a new prompt run is starting
 *
 *   2. AFTER prompt execution:
 *      - Scan repo for expected deliverables
 *      - Run completeness checker
 *      - Classify failure type
 *      - Persist to audit log
 *      - Block next prompt if incomplete
 *      - Generate auto-retry prompt if needed
 *
 * Pipeline:
 *   BEFORE:  auditor.startRun() → checkPreviousRun() → block if needed
 *   AFTER:   auditor.completeRun(spec) → scan → check → classify → persist → retry
 *
 * @module prompt-auditor
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkCompleteness, FAILURE_CLASSIFICATIONS, wasRunComplete } from "./prompt-completeness-checker.js";
import { mapPromptSpec, createManualSpec } from "./prompt-spec-mapper.js";

// SINGLE SOURCE OF TRUTH: Use the shared generateRunId from logger.js.
// No module shall create its own identity generation logic.
import { generateRunId } from "./logger.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = path.join(__dirname, "..", "logs", "prompt-execution-audit.json");
const MAX_AUDIT_ENTRIES = 200;
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a new prompt execution run.
 * Checks whether the previous run was complete.
 * If incomplete, blocks execution and returns a retry prompt.
 *
 * @param {object} config - Prompt run configuration
 * @param {string} config.promptName - Name/identifier for this prompt
 * @param {string} [config.promptText] - Full prompt text (optional, for spec mapping)
 * @param {object} [config.expected] - Manual override for expected deliverables
 * @param {string[]} [config.expected.files] - Expected file paths
 * @param {string[]} [config.expected.functions] - Expected function names
 * @param {string[]} [config.expected.logs] - Expected log artifacts
 * @param {boolean} [config.force] - If true, skip the previous-run completeness check
 * @returns {object} Run start result: { permitted, blockedReason, retryPrompt, runId }
 */
export function startRun(config = {}) {
  const {
    promptName = "unnamed-prompt",
    promptText = "",
    expected = {},
    force = false,
  } = config;

  const runId = generateRunId(promptName);

  console.log(`\n╔══════════════════════════════════════════════════`);
  console.log(`║ 🎬 PROMPT EXECUTION AUDITOR`);
  console.log(`║ Run:       "${promptName}"`);
  console.log(`║ Run ID:    ${runId}`);
  console.log(`║ Force:     ${force ? "YES (skip completeness check)" : "NO"}`);
  console.log(`╚══════════════════════════════════════════════════\n`);

  // ── Check if previous run was complete (block if not) ──────────────
  if (!force) {
    const previousRun = getLastRun();
    if (previousRun) {
      if (!wasRunComplete(previousRun)) {
        const blockedReason = `Previous run "${previousRun.promptName}" (${previousRun.runId}) was INCOMPLETE — score: ${previousRun.executionScore}/100, classification: ${previousRun.failureClassification}`;
        const retryPrompt = generateRetryPrompt(previousRun);

        console.log(`⛔ [AUDITOR] BLOCKED: ${blockedReason}`);
        console.log(`\n🔄 [RETRY PROMPT GENERATED]:`);
        console.log(retryPrompt);

        // Log the blocked attempt
        appendAuditEntry({
          runId,
          promptName,
          timestamp: new Date().toISOString(),
          status: "BLOCKED",
          executionScore: 0,
          failureClassification: FAILURE_CLASSIFICATIONS.NOT_EVALUATED,
          blockedReason,
          blocked: true,
          hasRetryPrompt: true,
        });

        return {
          permitted: false,
          runId,
          blockedReason,
          retryPrompt,
          previousRun,
        };
      }

      console.log(`✅ [AUDITOR] Previous run "${previousRun.promptName}" was COMPLETE — proceeding`);
    } else {
      console.log(`   [AUDITOR] No previous run found — proceeding`);
    }
  }

  // ── Log run start ─────────────────────────────────────────────────
  const runEntry = {
    runId,
    promptName,
    timestamp: new Date().toISOString(),
    status: "RUNNING",
    executionScore: null,
    failureClassification: null,
    expectedDeliverables: null,
    blocked: false,
  };

  appendAuditEntry(runEntry);

  return {
    permitted: true,
    runId,
    blockedReason: null,
    retryPrompt: null,
    previousRun: null,
  };
}

/**
 * Complete a prompt execution run and run the full validation pipeline.
 * Must be called AFTER prompt execution.
 *
 * @param {string} runId - Run ID returned by startRun()
 * @param {object} [config] - Completion configuration
 * @param {object} [config.spec] - Prompt spec (from mapPromptSpec or manual)
 * @param {boolean} [config.generateRetry] - Whether to generate retry prompt if incomplete
 * @param {object} [config.options] - Options passed to checkCompleteness
 * @returns {object} Audit entry with completeness report, retry prompt, block decision
 */
export function completeRun(runId, config = {}) {
  const {
    spec = null,
    generateRetry = true,
    options = {},
  } = config;

  console.log(`\n╔══════════════════════════════════════════════════`);
  console.log(`║ ✅ PROMPT EXECUTION COMPLETE — Running Audit`);
  console.log(`║ Run ID:  ${runId}`);
  console.log(`╚══════════════════════════════════════════════════\n`);

  // ── Step 1: Run completeness checker ─────────────────────────────
  let report;
  if (spec) {
    report = checkCompleteness(spec, options);
  } else {
    console.log(`   [AUDITOR] No spec provided — running with empty expectations`);
    report = checkCompleteness({
      promptName: runId,
      timestamp: new Date().toISOString(),
      expectedFiles: [],
      expectedFunctions: [],
      expectedLogs: [],
      expectedBehaviors: [],
      expectedDirectories: [],
      raw: "",
    }, options);
  }

  // ── Step 2: Determine block decision ─────────────────────────────
  const isComplete = report.status === "COMPLETE" && report.executionScore === 100;
  const shouldBlockNext = !isComplete;

  // ── Step 3: Generate retry prompt if needed ──────────────────────
  let retryPrompt = null;
  if (shouldBlockNext && generateRetry) {
    retryPrompt = generateRetryPrompt(report);
  }

  // ── Step 4: Build and persist audit entry ─────────────────────────
  const auditEntry = {
    runId,
    promptName: report.promptName,
    timestamp: report.timestamp,
    specTimestamp: report.specTimestamp,
    status: report.status,
    executionScore: report.executionScore,
    failureClassification: report.failureClassification,
    expectedDeliverables: report.expectedDeliverables,
    detectedFiles: report.detectedFiles,
    missingItems: report.missingItems,
    foundItems: report.foundItems,
    skippedSteps: report.skippedSteps,
    blockedNextPrompt: shouldBlockNext,
    retryPromptGenerated: retryPrompt !== null,
    retryPrompt: retryPrompt ? retryPrompt.slice(0, 1000) : null, // Store preview
  };

  // Update the existing audit entry (replace the RUNNING entry)
  updateAuditEntry(runId, auditEntry);

  // ── Step 5: Print final output ──────────────────────────────────
  const blockIcon = shouldBlockNext ? "⛔" : "✅";
  console.log(`\n${blockIcon} [AUDITOR] Audit complete for run "${runId}"`);
  console.log(`   Block next prompt: ${shouldBlockNext}`);
  console.log(`   Retry prompt generated: ${retryPrompt !== null}`);

  return {
    ...auditEntry,
    isComplete,
    shouldBlockNext,
    retryPrompt,
  };
}

/**
 * Convenience: run full audit in one call (start → execute → complete).
 * The execute function is called only if the previous run was complete.
 *
 * @param {object} config - Same as startRun config
 * @param {Function} executeFn - Async function to execute if permitted
 * @param {object} [completionConfig] - Config passed to completeRun
 * @returns {object} Full audit result
 */
export async function runAudited(config, executeFn, completionConfig = {}) {
  // ── Start (with block check) ────────────────────────────────────
  const startResult = startRun(config);

  if (!startResult.permitted) {
    return {
      started: false,
      executed: false,
      blocked: true,
      startResult,
      completionResult: null,
    };
  }

  // ── Execute ─────────────────────────────────────────────────────
  let executionResult;
  try {
    executionResult = await executeFn();
  } catch (err) {
    console.error(`[AUDITOR] Execution error: ${err.message}`);
    executionResult = { error: err.message };
  }

  // ── Complete (run audit) ────────────────────────────────────────
  const completionResult = completeRun(startResult.runId, completionConfig);

  return {
    started: true,
    executed: true,
    blocked: false,
    startResult,
    executionResult,
    completionResult,
  };
}

/**
 * Get all audit entries.
 * @returns {Array}
 */
export function getAuditLog() {
  return readAuditFile();
}

/**
 * Get the most recent audit entry.
 * @returns {object|null}
 */
export function getLastRun() {
  const log = readAuditFile();
  // Filter out BLOCKED entries — only consider actual run attempts
  const runs = log.filter((e) => e.status !== "BLOCKED" && e.runId);
  return runs.length > 0 ? runs[runs.length - 1] : null;
}

/**
 * Get the last N audit entries (most recent first).
 * @param {number} count
 * @returns {Array}
 */
export function getRecentRuns(count = 10) {
  const log = readAuditFile();
  const runs = log.filter((e) => e.status !== "BLOCKED");
  return runs.slice(-count).reverse();
}

/**
 * Check if the last run was complete without a full read.
 * @returns {boolean}
 */
export function isLastRunComplete() {
  const last = getLastRun();
  if (!last) return true; // No previous run means nothing blocked
  return wasRunComplete(last);
}

/**
 * Clear the audit log (for testing/reset purposes).
 */
export function clearAuditLog() {
  try {
    fs.writeFileSync(AUDIT_FILE, JSON.stringify([], null, 2), "utf-8");
    console.log("[AUDITOR] Audit log cleared");
  } catch (err) {
    console.error(`[AUDITOR] Could not clear audit log: ${err.message}`);
  }
}

// ── Internal Audit Log Management ────────────────────────────────────────────

/**
 * Read the audit log file.
 */
function readAuditFile() {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Write to the audit log file (append, trim to max).
 */
function appendAuditEntry(entry) {
  const log = readAuditFile();
  log.push(entry);
  const trimmed = log.length > MAX_AUDIT_ENTRIES
    ? log.slice(-MAX_AUDIT_ENTRIES)
    : log;
  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    console.error(`[AUDITOR] Could not write audit entry: ${err.message}`);
  }
}

/**
 * Update an existing audit entry by runId (replace RUNNING → final).
 */
function updateAuditEntry(runId, updatedEntry) {
  const log = readAuditFile();
  const idx = log.findIndex((e) => e.runId === runId);

  if (idx !== -1) {
    log[idx] = updatedEntry;
  } else {
    log.push(updatedEntry);
  }

  const trimmed = log.length > MAX_AUDIT_ENTRIES
    ? log.slice(-MAX_AUDIT_ENTRIES)
    : log;

  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    console.error(`[AUDITOR] Could not update audit entry: ${err.message}`);
  }
}

// ── Auto-Retry Prompt Generation ─────────────────────────────────────────────

/**
 * Generate a focused retry prompt from an incomplete audit entry.
 * The retry prompt ONLY asks to implement missing items,
 * and explicitly avoids re-implementing existing parts.
 *
 * @param {object} auditEntry - An incomplete audit entry or completeness report
 * @returns {string} Focused retry prompt
 */
export function generateRetryPrompt(auditEntry) {
  const missingFiles = auditEntry.missingItems?.files || [];
  const missingFunctions = auditEntry.missingItems?.functions || [];
  const missingLogs = auditEntry.missingItems?.logs || [];
  const missingBehaviors = auditEntry.missingItems?.behaviors || [];

  const foundFiles = auditEntry.foundItems?.files || [];
  const foundFunctions = auditEntry.foundItems?.functions || [];

  const promptName = auditEntry.promptName || "previous-run";

  if (
    missingFiles.length === 0 &&
    missingFunctions.length === 0 &&
    missingLogs.length === 0 &&
    missingBehaviors.length === 0
  ) {
    return `# RETRY PROMPT for "${promptName}"

No specific missing items detected from the previous run. 
The system flagged the previous execution as incomplete but could not identify specific gaps.

Suggested approach:
1. Review the previous run output for errors or truncation
2. Run the full prompt again with focus on completion
3. Verify all files and functions exist after execution`;
  }

  let prompt = `# FOCUSED RETRY PROMPT — "${promptName}"

## DO NOT RE-IMPLEMENT EXISTING PARTS
The following artifacts already exist and must NOT be re-created:
`;

  if (foundFiles.length > 0) {
    prompt += `\nAlready existing files (DO NOT TOUCH):\n`;
    foundFiles.forEach((f) => { prompt += `- ${f}\n`; });
  }

  if (foundFunctions.length > 0) {
    prompt += `\nAlready existing functions (DO NOT RE-DEFINE):\n`;
    foundFunctions.forEach((f) => { prompt += `- ${f}\n`; });
  }

  prompt += `\n## IMPLEMENT ONLY THE FOLLOWING MISSING ITEMS\n`;

  if (missingFiles.length > 0) {
    prompt += `\n### Missing Files — CREATE:\n`;
    missingFiles.forEach((f) => { prompt += `- CREATE "${f}"\n`; });
  }

  if (missingFunctions.length > 0) {
    prompt += `\n### Missing Functions — IMPLEMENT in any appropriate existing file:\n`;
    missingFunctions.forEach((f) => { prompt += `- EXPORT function "${f}"\n`; });
  }

  if (missingLogs.length > 0) {
    prompt += `\n### Missing Log Artifacts — WRITE:\n`;
    missingLogs.forEach((l) => { prompt += `- LOG to "${l}"\n`; });
  }

  if (missingBehaviors.length > 0) {
    prompt += `\n### Missing Behavioral Outcomes — ENSURE:\n`;
    missingBehaviors.forEach((b) => { prompt += `- ${b}\n`; });
  }

  prompt += `\n## DO NOT INVENT NEW FEATURES
Only implement the items listed above. Do NOT add extra files, functions, or capabilities beyond what is missing.

## VERIFICATION
After implementing, the completeness score must reach 100/100.
`;

  return prompt;
}

// ── generateRunId is imported from logger.js (single source of truth) ──

