/**
 * git-state-machine.js — Git-Backed State Machine (Core)
 *
 * FINAL ARCHITECTURE — Replaces the loose "just commit code" behavior.
 *
 * This is the SINGLE source of truth for execution state tracking against git.
 * Every operator step maps to a git commit. Provides:
 *   - beforeCommit:  the HEAD hash before a step executes
 *   - afterCommit:   the HEAD hash after a step executes
 *   - diff per step: structured file changes per step
 *   - step mapping:  lookup which commit a step produced
 *
 * The state machine ensures full replayability:
 *   - Given any runId, you can reconstruct the exact state before/after each step
 *   - Failed steps can be replayed by checking out the beforeCommit
 *
 * @module git-state-machine
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  snapshotBefore,
  snapshotAfter,
  computeDiff,
  autoCommit,
  checkoutCommit,
  checkoutOriginal,
  getCurrentBranch,
  commitExists,
} from "./git-snapshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "..", "logs", "execution-state.json");

// ── State IO ────────────────────────────────────────────────────────────────

function ensureStateFile() {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(createEmptyState(), null, 2), "utf-8");
  }
}

function createEmptyState() {
  return {
    runId: "",
    gitCommitBefore: "",
    gitCommitAfter: "",
    steps: [],
    stepCommitMap: {},
    finalStatus: "",
  };
}

function readState() {
  ensureStateFile();
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.steps) parsed.steps = [];
    if (!parsed.stepCommitMap) parsed.stepCommitMap = {};
    return parsed;
  } catch {
    return createEmptyState();
  }
}

function writeState(state) {
  ensureStateFile();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error(`[GIT-STATE-MACHINE] ❌ Failed to persist state: ${err.message}`);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize a new execution state machine for a run.
 *
 * @param {string} runId - Unique run identifier
 * @param {string} gitCommitBefore - The HEAD hash before execution starts
 * @returns {object} The initialized state
 */
export function initRunState(runId, gitCommitBefore) {
  const state = {
    runId,
    gitCommitBefore: gitCommitBefore || "",
    gitCommitAfter: "",
    steps: [],
    stepCommitMap: {},
    finalStatus: "",
  };
  writeState(state);
  console.log(`\n   [GIT-STATE-MACHINE] 🔄 Initialized run: ${runId}`);
  if (gitCommitBefore) {
    console.log(`   [GIT-STATE-MACHINE]    Git before: ${gitCommitBefore.substring(0, 12)}...`);
  }
  return state;
}

/**
 * Execute a single pipeline step through the git state machine.
 *
 * Flow:
 *   1. snapshotBefore() — capture HEAD before step
 *   2. Execute the step function
 *   3. snapshotAfter() — capture HEAD + changes after step
 *   4. computeDiff(before, after) — structured diff
 *   5. autoCommit() if step succeeded — produces a traceable commit
 *   6. Persist to execution-state.json with step-to-commit mapping
 *
 * @param {object} params
 * @param {string} params.name      - Step name (e.g., "generate_newsletter")
 * @param {Function} params.execute - The async step function
 * @param {string} params.runId     - The run identifier
 * @param {object} [params.options]
 * @param {boolean} [params.options.autoCommit=true] - Auto-commit after success
 * @returns {Promise<{status: string, step: object}>}
 */
export async function executeStatefulStep({ name, execute, runId, options = {} }) {
  const { autoCommitEnabled = true } = options;

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`   [GIT-STATE-MACHINE] Step "${name}" — executing...`);
  console.log(`═══════════════════════════════════════════════`);

  // ── 1. Snapshot BEFORE ──────────────────────────────────────────────
  const before = snapshotBefore();

  // ── 2. Run the step ─────────────────────────────────────────────────
  let stepError = null;
  try {
    await execute();
    console.log(`   [GIT-STATE-MACHINE] Step "${name}" — completed`);
  } catch (err) {
    stepError = err;
    console.error(`   [GIT-STATE-MACHINE] ❌ Step "${name}" — failed: ${err.message}`);
  }

  // ── 3. Snapshot AFTER ───────────────────────────────────────────────
  const after = snapshotAfter();

  // ── 4. Compute diff ─────────────────────────────────────────────────
  const diff = computeDiff(before, after);

  // ── 5. Determine status ─────────────────────────────────────────────
  const status = stepError
    ? "FAILED"
    : hasMeaningfulChanges(diff) || isNonFileStep(name)
      ? "SUCCESS"
      : "PARTIAL";

  // ── 6. Auto-commit if SUCCESS ───────────────────────────────────────
  let afterCommitHash = after.headHash;
  if (status === "SUCCESS" && autoCommitEnabled) {
    const committed = autoCommit(name, runId);
    if (committed) {
      try {
        afterCommitHash = execSync("git rev-parse HEAD", {
          encoding: "utf-8",
          cwd: path.resolve(__dirname, "..", ".."),
          timeout: 5000,
        }).trim();
      } catch {
        afterCommitHash = after.headHash;
      }
    }
  }

  // ── 7. Build step record ───────────────────────────────────────────
  const stepRecord = {
    step: name,
    status,
    timestamp: new Date().toISOString(),
    beforeHash: before.headHash,
    afterHash: afterCommitHash,
    diff: {
      filesAdded: diff.filesAdded,
      filesModified: diff.filesModified,
      filesDeleted: diff.filesDeleted,
    },
    error: stepError ? stepError.message : null,
  };

  // ── 8. Persist to state ─────────────────────────────────────────────
  const state = readState();
  state.steps.push(stepRecord);
  state.gitCommitAfter = afterCommitHash;
  state.stepCommitMap[name] = afterCommitHash;

  if (status === "FAILED") {
    state.finalStatus = "FAILED";
  } else if (status === "PARTIAL" && state.finalStatus !== "FAILED") {
    state.finalStatus = "PARTIAL";
  } else if (status === "SUCCESS" && state.finalStatus === "") {
    state.finalStatus = "SUCCESS";
  }

  writeState(state);

  console.log(`   [GIT-STATE-MACHINE] ✅ Step "${name}" → ${status}`);
  console.log(`   [GIT-STATE-MACHINE]    Files: +${diff.filesAdded.length} ~${diff.filesModified.length} -${diff.filesDeleted.length}`);

  return { status, step: stepRecord };
}

/**
 * Finalize the state machine for a run.
 * Determines the final status from all step statuses.
 *
 * @returns {object} The final state
 */
export function finalizeRunState() {
  const state = readState();
  if (!state.steps || state.steps.length === 0) {
    state.finalStatus = state.finalStatus || "FAILED";
    writeState(state);
    return state;
  }

  const allSuccess = state.steps.every((s) => s.status === "SUCCESS" || s.status === "SKIPPED");
  const anyFailed = state.steps.some((s) => s.status === "FAILED");

  state.finalStatus = allSuccess ? "SUCCESS" : anyFailed ? "FAILED" : "PARTIAL";
  writeState(state);

  const icon = state.finalStatus === "SUCCESS" ? "✅" : state.finalStatus === "PARTIAL" ? "⚠️" : "❌";
  console.log(`\n   [GIT-STATE-MACHINE] ${icon} Final: ${state.finalStatus}`);
  console.log(`   [GIT-STATE-MACHINE]    Steps: ${state.steps.length} total`);
  return state;
}

/**
 * Get the current state machine state.
 * @returns {object}
 */
export function getRunState() {
  return readState();
}

/**
 * Reset the state machine (for testing or fresh starts).
 */
export function resetRunState() {
  writeState(createEmptyState());
  return createEmptyState();
}

/**
 * Find the last FAILED step in the execution state.
 * Returns null if no failed step exists.
 *
 * @returns {object|null} { step, index }
 */
export function findLastFailedStep() {
  const state = readState();
  if (!state.steps || state.steps.length === 0) return null;

  for (let i = state.steps.length - 1; i >= 0; i--) {
    if (state.steps[i].status === "FAILED") {
      return { step: state.steps[i], index: i };
    }
  }
  // Check PARTIAL as secondary indicator
  for (let i = state.steps.length - 1; i >= 0; i--) {
    if (state.steps[i].status === "PARTIAL") {
      return { step: state.steps[i], index: i };
    }
  }
  return null;
}

/**
 * Get the git commit hash that was active BEFORE a given step index.
 *
 * @param {number} stepIndex - The step index to query
 * @returns {string|null} The commit hash to reset to for replay
 */
export function getCommitBeforeStep(stepIndex) {
  const state = readState();
  if (!state || !state.steps || stepIndex >= state.steps.length) return null;

  if (stepIndex === 0) return state.gitCommitBefore || null;

  // The commit before step N is stored on step N-1's afterHash
  const prevStep = state.steps[stepIndex - 1];
  if (prevStep && prevStep.afterHash) return prevStep.afterHash;

  return state.gitCommitBefore || null;
}

/**
 * Get the git commit hash that was produced BY a given step.
 *
 * @param {string} stepName - The step name to look up
 * @returns {string|null} The commit hash, or null if not found
 */
export function getCommitForStep(stepName) {
  const state = readState();
  return state?.stepCommitMap?.[stepName] || null;
}

/**
 * Get a detailed summary of the execution for reporting.
 *
 * @returns {object}
 */
export function getRunSummary() {
  const state = readState();
  const successful = state.steps.filter((s) => s.status === "SUCCESS" || s.status === "SKIPPED").length;
  const failed = state.steps.filter((s) => s.status === "FAILED").length;
  const partial = state.steps.filter((s) => s.status === "PARTIAL").length;

  return {
    runId: state.runId,
    finalStatus: state.finalStatus,
    totalSteps: state.steps.length,
    successful,
    failed,
    partial,
    gitCommitBefore: state.gitCommitBefore,
    gitCommitAfter: state.gitCommitAfter,
    stepCommitMap: state.stepCommitMap,
    steps: state.steps.map((s) => ({
      step: s.step,
      status: s.status,
      beforeHash: s.beforeHash?.substring(0, 12),
      afterHash: s.afterHash?.substring(0, 12),
      filesChanged: (s.diff?.filesAdded?.length || 0) +
                    (s.diff?.filesModified?.length || 0) +
                    (s.diff?.filesDeleted?.length || 0),
    })),
  };
}

// ── Internal Helpers ────────────────────────────────────────────────────────

function hasMeaningfulChanges(diff) {
  return (diff.filesAdded?.length || 0) + (diff.filesModified?.length || 0) > 0;
}

function isNonFileStep(name) {
  const nonFile = ["git", "push", "deliver", "validate", "check", "test"];
  return nonFile.includes(name.toLowerCase());
}

// ── Replay Helpers ──────────────────────────────────────────────────────────

/**
 * Prepare the git workspace for replaying from a specific step.
 * Checks out the pre-step commit state.
 *
 * @param {object} failedInfo - { step, index } from findLastFailedStep()
 * @param {string} currentBranch - The branch to return to after replay
 * @returns {Promise<{ok: boolean, targetCommit: string|null}>}
 */
export function prepareReplayWorkspace(failedInfo, currentBranch) {
  if (!failedInfo) {
    return { ok: false, targetCommit: null };
  }

  const targetCommit = getCommitBeforeStep(failedInfo.index);
  if (!targetCommit) {
    console.log(`   [GIT-STATE-MACHINE] ❌ Cannot determine target commit for replay`);
    return { ok: false, targetCommit: null };
  }

  if (!commitExists(targetCommit)) {
    console.log(`   [GIT-STATE-MACHINE] ❌ Commit ${targetCommit.substring(0, 12)}... not found`);
    return { ok: false, targetCommit };
  }

  console.log(`   [GIT-STATE-MACHINE] 🎯 Replay target: ${targetCommit.substring(0, 12)}...`);

  const checkoutOk = checkoutCommit(targetCommit);
  if (!checkoutOk) {
    return { ok: false, targetCommit };
  }

  return { ok: true, targetCommit };
}

export default {
  initRunState,
  executeStatefulStep,
  finalizeRunState,
  getRunState,
  resetRunState,
  findLastFailedStep,
  getCommitBeforeStep,
  getCommitForStep,
  getRunSummary,
  prepareReplayWorkspace,
};
