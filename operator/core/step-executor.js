/**
 * step-executor.js — Step Execution Wrapper with Git-Backed State Machine
 *
 * CORE EXECUTION CONTRACT:
 * Every operator step MUST run through executeStep().
 *
 * Wraps every step execution with:
 *   snapshotBefore()  →  runStep()  →  snapshotAfter()  →  computeDiff()  →  persistTo execution-state.json
 *
 * State Machine Rules:
 *   IF step succeeds: auto-commit → update state → mark SUCCESS
 *   IF step fails:    mark FAILED → STOP pipeline OR trigger replay mode
 *   IF step partially changes files: mark PARTIAL
 *
 * @module step-executor
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import {
  snapshotBefore,
  snapshotAfter,
  computeDiff,
  autoCommit,
} from "./git-snapshot.js";
import { emitEvent } from "./event-emitter.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "..", "logs", "execution-state.json");

// ── State Persistence ──────────────────────────────────────────────────────

function ensureStateFile() {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      runId: "",
      gitCommitBefore: "",
      gitCommitAfter: "",
      steps: [],
      finalStatus: "",
    }, null, 2), "utf-8");
  }
}

function readState() {
  ensureStateFile();
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.steps) parsed.steps = [];
    return parsed;
  } catch {
    return {
      runId: "",
      gitCommitBefore: "",
      gitCommitAfter: "",
      steps: [],
      finalStatus: "",
    };
  }
}

function writeState(state) {
  ensureStateFile();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error(`[STEP-EXECUTOR] ❌ Failed to persist state: ${err.message}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize a new execution state for a run.
 *
 * @param {string} runId - Unique run identifier
 * @param {string} gitCommitBefore - Git commit hash BEFORE any step runs
 */
export function initExecutionState(runId, gitCommitBefore) {
  const state = {
    runId,
    gitCommitBefore: gitCommitBefore || "",
    gitCommitAfter: "",
    steps: [],
    finalStatus: "",
  };
  writeState(state);
  console.log(`\n   [STATE] 🔄 Initialized execution state for run: ${runId}`);
  console.log(`   [STATE]    Git before: ${gitCommitBefore ? gitCommitBefore.substring(0, 12) + "..." : "none"}`);
  return state;
}

/**
 * Execute a single pipeline step with full git-backed state tracking.
 *
 * @param {object} params
 * @param {string} params.name      - Step name (e.g., "generate_newsletter", "git", "push")
 * @param {Function} params.execute - The async function that performs the step
 * @param {string} params.runId     - The run identifier
 * @param {object} [params.options]
 * @param {boolean} [params.options.autoCommit=true] - Whether to auto-commit after success
 * @param {boolean} [params.options.stopOnFailure=false] - Whether to stop the pipeline on failure
 * @returns {Promise<{status: string, step: object, pipeline: string}>}
 *   status: "SUCCESS" | "FAILED" | "PARTIAL"
 *   pipeline: "CONTINUE" | "STOP" — whether the pipeline should continue running
 */
export async function executeStep({ name, execute, runId, options = {} }) {
  const {
    autoCommitEnabled = true,
    stopOnFailure = false,
  } = options;

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`   [STEP] "${name}" — starting...`);
  console.log(`═══════════════════════════════════════════════`);

  // ── 1. Snapshot BEFORE execution ────────────────────────────────────
  const before = snapshotBefore();

  // ── 2. Run the step ─────────────────────────────────────────────────
  let stepError = null;
  let stepResult = null;

  try {
    stepResult = await execute();
    console.log(`   [STEP] "${name}" — completed`);
  } catch (err) {
    stepError = err;
    console.error(`   [STEP] ❌ "${name}" — failed: ${err.message}`);
  }

  // ── 3. Snapshot AFTER execution ─────────────────────────────────────
  const after = snapshotAfter();

  // ── 4. Compute diff ─────────────────────────────────────────────────
  const diff = computeDiff(before, after);

  // ── 5. Determine status ─────────────────────────────────────────────
  let status;
  if (stepError) {
    status = "FAILED";
  } else {
    const totalChanges = diff.filesAdded.length + diff.filesModified.length + diff.filesDeleted.length;

    if (totalChanges === 0) {
      // Step succeeded but no files changed — could be a non-file step (e.g., webhook push)
      // Check if the step was a git/commit/push step — those are "successful" by intent
      if (name === "git" || name === "push" || name === "deliver") {
        status = "SUCCESS";
      } else {
        // A step that should have produced files but produced none → PARTIAL
        // Examples: generate_newsletter produced no files, signal processing produced no output
        const shouldProduceFiles = ["generate", "build", "create", "write", "save", "render"].some(
          (prefix) => name.toLowerCase().includes(prefix)
        );
        if (shouldProduceFiles) {
          status = "PARTIAL";
          stepError = new Error(`Step "${name}" produced no file changes (PARTIAL)`);
        } else {
          status = "SUCCESS";
        }
      }
    } else if (diff.filesAdded.length > 0 || diff.filesModified.length > 0) {
      status = "SUCCESS";
    } else {
      status = "PARTIAL";
    }
  }

  // ── 6. Auto-commit if successful ────────────────────────────────────
  let commitHash = after.headHash;
  if (status === "SUCCESS" && autoCommitEnabled) {
    const committed = autoCommit(name, runId);
    if (committed) {
      // Re-read hash after commit (uses top-level execSync import)
      try {
        commitHash = execSync("git rev-parse HEAD", {
          encoding: "utf-8",
          cwd: path.resolve(__dirname, "..", ".."),
          timeout: 5000,
        }).trim();
      } catch {
        commitHash = after.headHash;
      }
    }
  }


  // ── 7. Build step entry ─────────────────────────────────────────────
  const step = {
    step: name,
    status,
    timestamp: new Date().toISOString(),
    diff: {
      filesAdded: diff.filesAdded,
      filesModified: diff.filesModified,
      filesDeleted: diff.filesDeleted,
    },
    error: stepError ? stepError.message : null,
  };

  // ── 8. Persist to execution-state.json ──────────────────────────────
  const state = readState();
  state.steps.push(step);
  state.gitCommitAfter = commitHash;

  // ── 9. Apply state machine rules ──────────────────────────────────
  if (status === "FAILED") {
    state.finalStatus = stopOnFailure ? "FAILED" : "PARTIAL";
    writeState(state);

    // ── EVENT: Step execution failed ─────────────────────────────────────
    emitEvent({
      type: "STEP_EXECUTION",
      runId,
      data: {
        file: "",
        metadata: {
          step: name,
          status: "FAILED",
          error: stepError?.message || "Unknown error",
          stopOnFailure,
          filesAdded: diff.filesAdded.length,
          filesModified: diff.filesModified.length,
        },
      },
    });

    console.log(`\n   [STATE] ❌ Step "${name}" marked as ${status}`);
    if (stopOnFailure) {
      console.log(`   [STATE] 🛑 Pipeline STOP triggered — ${name} failed`);
    } else {
      console.log(`   [STATE] ⚠️  Pipeline CONTINUES despite ${name} failure`);
    }

    return {
      status,
      step,
      pipeline: stopOnFailure ? "STOP" : "CONTINUE",
    };
  }

  if (status === "PARTIAL") {
    // Decide if partial should stop or continue
    state.finalStatus = "PARTIAL";
    writeState(state);

    // ── EVENT: Step execution partial ────────────────────────────────────
    emitEvent({
      type: "STEP_EXECUTION",
      runId,
      data: {
        file: "",
        metadata: {
          step: name,
          status: "PARTIAL",
          error: stepError?.message || null,
          filesAdded: diff.filesAdded.length,
          filesModified: diff.filesModified.length,
          filesDeleted: diff.filesDeleted.length,
        },
      },
    });

    console.log(`\n   [STATE] ⚠️  Step "${name}" marked as PARTIAL (${diff.filesAdded.length} added, ${diff.filesModified.length} modified, ${diff.filesDeleted.length} deleted)`);
    console.log(`   [STATE] Pipeline continues (partial = non-fatal)`);

    return {
      status,
      step,
      pipeline: "CONTINUE",
    };
  }

  // SUCCESS
  state.finalStatus = "SUCCESS";
  writeState(state);

  // ── EVENT: Step execution success ──────────────────────────────────
  emitEvent({
    type: "STEP_EXECUTION",
    runId,
    data: {
      file: "",
      metadata: {
        step: name,
        status: "SUCCESS",
        filesAdded: diff.filesAdded.length,
        filesModified: diff.filesModified.length,
        filesDeleted: diff.filesDeleted.length,
        commitHash,
      },
    },
  });

  console.log(`\n   [STATE] ✅ Step "${name}" marked as SUCCESS`);
  console.log(`   [STATE]    Files: +${diff.filesAdded.length} ~${diff.filesModified.length} -${diff.filesDeleted.length}`);
  console.log(`   [STATE]    Pipeline CONTINUE`);

  return {
    status,
    step,
    pipeline: "CONTINUE",
  };
}

/**
 * Finalize the execution state at the end of a run.
 * Determines finalStatus based on all step statuses.
 *
 * @returns {object} The final state
 */
export function finalizeExecutionState() {
  const state = readState();

  if (!state.steps || state.steps.length === 0) {
    state.finalStatus = state.finalStatus || "FAILED";
    writeState(state);
    return state;
  }

  const allSuccess = state.steps.every((s) => s.status === "SUCCESS");
  const anyFailed = state.steps.some((s) => s.status === "FAILED");
  const anyPartial = state.steps.some((s) => s.status === "PARTIAL");

  if (allSuccess) {
    state.finalStatus = "SUCCESS";
  } else if (anyFailed && anyPartial) {
    state.finalStatus = "PARTIAL";
  } else if (anyFailed) {
    state.finalStatus = "FAILED";
  } else {
    state.finalStatus = "PARTIAL";
  }

  writeState(state);

  const statusIcon = state.finalStatus === "SUCCESS" ? "✅" :
                     state.finalStatus === "PARTIAL" ? "⚠️" : "❌";

  console.log(`\n   [STATE] ${statusIcon} Final status: ${state.finalStatus}`);
  console.log(`   [STATE]    Steps: ${state.steps.length} total`);
  console.log(`   [STATE]    Git:   ${state.gitCommitBefore?.substring(0, 12) || "none"} → ${state.gitCommitAfter?.substring(0, 12) || "none"}`);

  return state;
}

/**
 * Get the current execution state.
 *
 * @returns {object}
 */
export function getExecutionState() {
  return readState();
}

/**
 * Reset the execution state (for testing or fresh starts).
 */
export function resetExecutionState() {
  const empty = {
    runId: "",
    gitCommitBefore: "",
    gitCommitAfter: "",
    steps: [],
    finalStatus: "",
  };
  writeState(empty);
  return empty;
}

/**
 * Get a summary of the execution for reporting.
 *
 * @returns {object}
 */
export function getExecutionSummary() {
  const state = readState();
  const successful = state.steps.filter((s) => s.status === "SUCCESS").length;
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
    steps: state.steps.map((s) => ({
      step: s.step,
      status: s.status,
      filesChanged: s.diff.filesAdded.length + s.diff.filesModified.length + s.diff.filesDeleted.length,
    })),
  };
}

export default {
  initExecutionState,
  executeStep,
  finalizeExecutionState,
  getExecutionState,
  resetExecutionState,
  getExecutionSummary,
};
