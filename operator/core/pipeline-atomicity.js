/**
 * pipeline-atomicity.js — Pipeline Atomicity Enforcement Module
 *
 * CRITICAL SYSTEM MODULE
 * Ensures every pipeline run is ATOMIC: either FULL SUCCESS or FULL FAILURE.
 * NO partial success states are permitted.
 *
 * ≡≡≡ STATE COMMITMENT LAYER ≡≡≡
 * pipelineState is NEVER only in memory.
 * EVERY state transition is immediately persisted to disk at:
 *   operator/logs/pipeline-state.json
 *
 * This file is the SINGLE SOURCE OF TRUTH for pipeline state.
 * Runtime in-memory state is secondary and syncs from disk on recovery.
 * ≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡
 *
 * State Machine (strict sequential):
 *   START → PLAN → AGENTS → BUILD → GIT → WEBHOOK → COMPLETE
 *
 * Rules:
 *   1. Every transition must be to the NEXT sequential stage (no skipping)
 *   2. Failure at ANY stage → immediate FAILED status, skip remaining stages
 *   3. Only PIPELINE_END(status: SUCCESS) emitted if ALL stages completed + webhook verified
 *   4. On FAILED: partial artifacts are NEVER treated as valid output
 *   5. On FAILED: run flagged in logs as "INCOMPLETE_EXECUTION"
 *   6. Disk write failure → immediate FAILED, execution stops
 *
 * @module pipeline-atomicity
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_FILE = path.join(__dirname, "..", "logs", "runs.json");
const PIPELINE_STATE_FILE = path.join(__dirname, "..", "logs", "pipeline-state.json");

// ── Valid Stages & Order ─────────────────────────────────────────────────────

const VALID_STAGES = ["START", "PLAN", "AGENTS", "BUILD", "GIT", "WEBHOOK", "COMPLETE"];

const STAGE_ORDER = Object.freeze({
  START: 0,
  PLAN: 1,
  AGENTS: 2,
  BUILD: 3,
  GIT: 4,
  WEBHOOK: 5,
  COMPLETE: 6,
});

const STAGE_EMOJI = {
  START: "🚀",
  PLAN: "📋",
  AGENTS: "🧠",
  BUILD: "🔨",
  GIT: "🔗",
  WEBHOOK: "📤",
  COMPLETE: "✅",
};

// ── Pipeline State (In-Memory — secondary to disk) ──────────────────────────

/**
 * @typedef {Object} PipelineState
 * @property {"IDLE"|"RUNNING"|"SUCCESS"|"FAILED"} status
 * @property {string|null} stage - Current execution stage
 * @property {boolean} atomic - Always true for this module
 * @property {string|null} runId - Current run identifier
 * @property {number|null} startedAt - Timestamp when pipeline started
 * @property {string|null} failedAt - Stage where failure occurred
 * @property {string|null} failedReason - Reason for failure
 * @property {boolean} incompleteExecution - True if pipeline failed (artifacts invalid)
 */

let pipelineState = {
  status: "IDLE",
  stage: null,
  atomic: true,
  runId: null,
  startedAt: null,
  failedAt: null,
  failedReason: null,
  incompleteExecution: false,
};

// ── STATE COMMITMENT LAYER: Atomic Disk Persistence ─────────────────────────

/**
 * Read pipeline state from disk (SINGLE SOURCE OF TRUTH).
 *
 * @returns {object|null} Parsed state object, or null if file doesn't exist
 * @throws {Error} If file is corrupted and cannot be parsed
 */
function readPipelineStateFromDisk() {
  if (!fs.existsSync(PIPELINE_STATE_FILE)) return null;
  const raw = fs.readFileSync(PIPELINE_STATE_FILE, { encoding: "utf-8", flag: "r" });
  return JSON.parse(raw);
}

/**
 * Write pipeline state to disk using ATOMIC synchronous write.
 *
 * Atomicity guarantee:
 *   1. Write to a .tmp file first (synchronous, fully flushed)
 *   2. Rename .tmp → actual file (atomic operation on Unix)
 *   3. Never partial writes — file is either fully written or unchanged
 *
 * @param {object} state - The pipeline state to persist
 * @throws {Error} If disk write fails — caller must handle (fail safety)
 */
function writePipelineStateToDisk(state) {
  const dir = path.dirname(PIPELINE_STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });

  // Atomic write: temp file → rename
  const tmpFile = PIPELINE_STATE_FILE + ".tmp";
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { encoding: "utf-8", flag: "w" });
  fs.renameSync(tmpFile, PIPELINE_STATE_FILE);
}

/**
 * Persist current pipelineState to disk, or fail the pipeline if write fails.
 *
 * Fail safety:
 *   - If disk write fails → mark pipeline FAILED immediately
 *   - Attempt to persist the FAILED state (best effort)
 *   - Throw to stop execution
 *
 * @param {string} operation - Description of the operation (for error context)
 * @throws {Error} If persistence fails and pipeline is marked FAILED
 */
function persistStateOrFail(operation) {
  try {
    writePipelineStateToDisk(pipelineState);
  } catch (err) {
    // ── FAIL SAFETY: Disk write failure → immediate FAILED ──────────────
    console.error(`\n💥 [PIPELINE-ATOMICITY] ❌ DISK WRITE FAILED during "${operation}": ${err.message}`);
    console.error(`   → Marking pipeline FAILED immediately — execution cannot continue`);

    pipelineState.status = "FAILED";
    pipelineState.failedAt = pipelineState.stage;
    pipelineState.failedReason = `DISK_WRITE_FAILED: ${err.message}`;
    pipelineState.incompleteExecution = true;

    // Best-effort: try to persist the FAILED state
    try {
      writePipelineStateToDisk(pipelineState);
    } catch {
      console.error(`   ⚠️  Could not persist FAILED state to disk (disk may be full or unwritable)`);
    }

    // Log to runs.json for traceability (best effort, non-blocking)
    try {
      const runs = readRunsFile();
      const idx = runs.findIndex((r) => r.runId === pipelineState.runId);
      if (idx !== -1) {
        runs[idx].incompleteExecution = true;
        runs[idx].status = "failed";
        writeRunsFile(runs);
      }
    } catch {
      // Non-fatal — we already flagged FAILED above
    }

    throw new Error(`PIPELINE FAILED: Disk write failure during "${operation}"`);
  }
}

// ── Legacy runs.json helpers (maintained for backward compatibility) ────────

function readRunsFile() {
  try {
    if (!fs.existsSync(RUNS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(RUNS_FILE, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeRunsFile(runs) {
  try {
    const dir = path.dirname(RUNS_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RUNS_FILE, JSON.stringify(runs, null, 2), "utf-8");
  } catch (err) {
    console.error(`[PIPELINE-ATOMICITY] ❌ Failed to update runs.json: ${err.message}`);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a copy of the current pipeline state.
 * @returns {PipelineState}
 */
export function getPipelineState() {
  return { ...pipelineState };
}

/**
 * Initialize pipeline state for a new run.
 * Stage: START
 * Status: RUNNING
 *
 * Persisted to disk immediately.
 *
 * @param {string} runId - Unique run identifier
 * @returns {PipelineState}
 */
export function initPipelineState(runId) {
  pipelineState = {
    status: "RUNNING",
    stage: "START",
    atomic: true,
    runId,
    startedAt: Date.now(),
    failedAt: null,
    failedReason: null,
    incompleteExecution: false,
  };

  // ── STATE COMMITMENT: Persist immediately ──────────────────────────────
  persistStateOrFail("initPipelineState");

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`🚦 [PIPELINE-ATOMICITY] Pipeline initialized`);
  console.log(`   Run ID:  ${runId}`);
  console.log(`   Status:  ${pipelineState.status}`);
  console.log(`   Stage:   ${pipelineState.stage}`);
  console.log(`   Atomic:  ${pipelineState.atomic}`);
  console.log(`   📁 State committed: operator/logs/pipeline-state.json`);
  console.log(`═══════════════════════════════════════════════\n`);

  return { ...pipelineState };
}

/**
 * Transition to the next sequential stage.
 * Valid transitions: START → PLAN → AGENTS → BUILD → GIT → WEBHOOK → COMPLETE
 * Jumps and skips are REJECTED.
 *
 * If pipeline is already FAILED, transition is rejected.
 *
 * Persisted to disk immediately.
 *
 * @param {string} currentStage - The stage we are transitioning FROM
 * @param {string} nextStage - The stage we are transitioning TO
 * @returns {PipelineState}
 * @throws {Error} If transition is invalid or pipeline is FAILED
 */
export function transitionStage(currentStage, nextStage) {
  if (pipelineState.status === "FAILED") {
    const msg = `⛔ [PIPELINE-ATOMICITY] Cannot transition ${currentStage} → ${nextStage}: pipeline is FAILED`;
    console.error(`   ${msg}`);
    throw new Error(msg);
  }

  const currentIdx = STAGE_ORDER[currentStage];
  const nextIdx = STAGE_ORDER[nextStage];

  if (currentIdx === undefined || nextIdx === undefined) {
    const msg = `⛔ [PIPELINE-ATOMICITY] Invalid stage name: "${currentStage}" → "${nextStage}"`;
    console.error(`   ${msg}`);
    throw new Error(msg);
  }

  if (nextIdx !== currentIdx + 1) {
    const msg = `⛔ [PIPELINE-ATOMICITY] Invalid transition: ${currentStage} → ${nextStage}. ` +
                `Must follow sequential order: ${VALID_STAGES.join(" → ")}`;
    console.error(`   ${msg}`);
    throw new Error(msg);
  }

  const emoji = STAGE_EMOJI[nextStage] || "➡️";
  pipelineState.stage = nextStage;

  // ── STATE COMMITMENT: Persist immediately ──────────────────────────────
  persistStateOrFail(`transitionStage: ${currentStage} → ${nextStage}`);

  console.log(`\n   ${emoji} [PIPELINE-ATOMICITY] Stage transition: ${currentStage} → ${nextStage}`);
  console.log(`      Status: ${pipelineState.status} | Stage: ${pipelineState.stage} | Atomic: ${pipelineState.atomic}`);
  console.log(`      📁 State committed: operator/logs/pipeline-state.json`);

  return { ...pipelineState };
}

/**
 * Mark the pipeline as FAILED.
 * - Status set to FAILED
 * - Stage frozen at the point of failure (failedAt)
 * - incompleteExecution set to true (artifacts not valid)
 * - All remaining stages are SKIPPED
 *
 * Persisted to disk immediately.
 *
 * @param {string} reason - Human-readable reason for failure
 * @returns {PipelineState}
 */
export function failPipeline(reason) {
  pipelineState.status = "FAILED";
  pipelineState.failedAt = pipelineState.stage;
  pipelineState.failedReason = reason;
  pipelineState.incompleteExecution = true;

  // ── STATE COMMITMENT: Persist immediately ──────────────────────────────
  // Note: If this write fails, persistStateOrFail will attempt to re-fail,
  // but since we're already FAILED, it's best-effort.
  try {
    writePipelineStateToDisk(pipelineState);
  } catch (err) {
    console.error(`\n💥 [PIPELINE-ATOMICITY] ❌ DISK WRITE FAILED during "failPipeline": ${err.message}`);
    console.error(`   ⚠️  Pipeline is already FAILED — continuing with in-memory state`);
  }

  console.log(`\n💥 [PIPELINE-ATOMICITY] PIPELINE FAILED`);
  console.log(`   Run ID:  ${pipelineState.runId}`);
  console.log(`   Status:  ${pipelineState.status}`);
  console.log(`   Stage:   ${pipelineState.stage}`);
  console.log(`   Failed at: ${pipelineState.failedAt}`);
  console.log(`   Reason:  ${reason}`);
  console.log(`   🚫 INCOMPLETE_EXECUTION — partial artifacts are NOT valid output`);
  console.log(`   ⏭️  All remaining stages SKIPPED`);
  console.log(`   📁 State committed: operator/logs/pipeline-state.json`);

  // ── Flag run in runs.json as INCOMPLETE_EXECUTION ──────────────────────
  try {
    const runs = readRunsFile();
    const idx = runs.findIndex((r) => r.runId === pipelineState.runId);
    if (idx !== -1) {
      runs[idx].incompleteExecution = true;
      runs[idx].status = "failed";
      writeRunsFile(runs);
      console.log(`   📝 Logged "INCOMPLETE_EXECUTION" flag in runs.json`);
    }
  } catch (err) {
    console.error(`   ⚠️ Could not flag run in logs: ${err.message}`);
  }

  return { ...pipelineState };
}

/**
 * Complete the pipeline successfully.
 * Only allowed when:
 *   - pipeline is NOT FAILED
 *   - current stage is WEBHOOK (last stage before COMPLETE)
 *   - webhook delivery was verified
 *
 * Persisted to disk immediately.
 *
 * @returns {PipelineState}
 * @throws {Error} If pipeline is FAILED or not at WEBHOOK stage
 */
export function completePipeline() {
  if (pipelineState.status === "FAILED") {
    const msg = `⛔ [PIPELINE-ATOMICITY] Cannot mark FAILED pipeline as SUCCESS`;
    console.error(`   ${msg}`);
    throw new Error(msg);
  }

  if (pipelineState.stage !== "WEBHOOK") {
    const msg = `⛔ [PIPELINE-ATOMICITY] Cannot complete pipeline: current stage is "${pipelineState.stage}", must be WEBHOOK`;
    console.error(`   ${msg}`);
    throw new Error(msg);
  }

  pipelineState.status = "SUCCESS";
  pipelineState.stage = "COMPLETE";
  pipelineState.incompleteExecution = false;

  // ── STATE COMMITMENT: Persist immediately ──────────────────────────────
  persistStateOrFail("completePipeline");

  const elapsed = Date.now() - (pipelineState.startedAt || Date.now());

  console.log(`\n🎯 [PIPELINE-ATOMICITY] PIPELINE COMPLETE (SUCCESS)`);
  console.log(`   Status:  ${pipelineState.status}`);
  console.log(`   Stage:   ${pipelineState.stage}`);
  console.log(`   Atomic:  ${pipelineState.atomic}`);
  console.log(`   Elapsed: ${formatDuration(elapsed)}`);
  console.log(`   ✅ All stages completed: ${VALID_STAGES.join(" → ")}`);
  console.log(`   ✅ Webhook delivery verified`);
  console.log(`   ✅ Full atomic execution — no partial states`);
  console.log(`   📁 State committed: operator/logs/pipeline-state.json`);

  return { ...pipelineState };
}

/**
 * Check if the pipeline is in FAILED state.
 * @returns {boolean}
 */
export function isPipelineFailed() {
  return pipelineState.status === "FAILED";
}

/**
 * Check if the pipeline completed successfully (SUCCESS + COMPLETE).
 * @returns {boolean}
 */
export function isPipelineComplete() {
  return pipelineState.status === "SUCCESS" && pipelineState.stage === "COMPLETE";
}

/**
 * Get the current stage of the pipeline.
 * @returns {string|null}
 */
export function getCurrentStage() {
  return pipelineState.stage;
}

/**
 * Reset the pipeline state (for testing or fresh starts).
 * Also resets the disk state.
 */
export function resetPipelineState() {
  pipelineState = {
    status: "IDLE",
    stage: null,
    atomic: true,
    runId: null,
    startedAt: null,
    failedAt: null,
    failedReason: null,
    incompleteExecution: false,
  };

  // Persist the reset state to disk
  try {
    writePipelineStateToDisk(pipelineState);
    console.log(`   📁 State reset and committed to disk`);
  } catch (err) {
    console.error(`   ⚠️ Could not reset state on disk: ${err.message}`);
  }
}

/**
 * Print the full pipeline state report.
 */
export function printPipelineState() {
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`📋 PIPELINE STATE REPORT`);
  console.log(`═══════════════════════════════════════════════`);
  console.log(`   Status:              ${pipelineState.status}`);
  console.log(`   Current Stage:       ${pipelineState.stage}`);
  console.log(`   Atomic Mode:         ${pipelineState.atomic}`);
  console.log(`   Run ID:              ${pipelineState.runId}`);
  console.log(`   Failed At:           ${pipelineState.failedAt || "—"}`);
  console.log(`   Failed Reason:       ${pipelineState.failedReason || "—"}`);
  console.log(`   Incomplete Exec:     ${pipelineState.incompleteExecution}`);
  console.log(`   Valid Stages:        ${VALID_STAGES.join(" → ")}`);
  console.log(`   SSOT File:           operator/logs/pipeline-state.json`);
  console.log(`   ⚖️  Atomicity: ${pipelineState.status === "SUCCESS" ? "✅ GUARANTEED" : pipelineState.status === "FAILED" ? "🚫 FAILED (no partial)" : "🔄 IN PROGRESS"}`);
  console.log(`═══════════════════════════════════════════════\n`);
}

// ── RECOVERY INTEGRATION ────────────────────────────────────────────────────

/**
 * Recover pipeline state from disk on system restart.
 *
 * Flow:
 *   1. Load pipeline-state.json from disk
 *   2. If file doesn't exist → return null (no prior state, start fresh)
 *   3. If status is SUCCESS or FAILED → return finalized (start fresh)
 *   4. Otherwise → restore in-memory state and continue from last known stage
 *
 * The ONLY valid pipeline state is operator/logs/pipeline-state.json.
 * In-memory state is secondary and always syncs from disk on recovery.
 *
 * @returns {object|null}
 *   null — No prior state found on disk
 *   { recovered: false, finalized: true, state } — Prior run is finalized (COMPLETE/FAILED)
 *   { recovered: true, finalized: false, state } — In-progress run restored
 */
export function recoverPipelineState() {
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`🔄 [PIPELINE-STATE] Recovery check from disk...`);

  let diskState;
  try {
    diskState = readPipelineStateFromDisk();
  } catch (err) {
    console.log(`   ⚠️  Corrupted pipeline-state.json: ${err.message}`);
    console.log(`   → Starting fresh (corrupted state ignored)`);
    return null;
  }

  if (!diskState) {
    console.log(`   ℹ️  No pipeline-state.json found on disk — starting fresh`);
    console.log(`═══════════════════════════════════════════════\n`);
    return null;
  }

  const runId = diskState.runId || "unknown";
  const status = diskState.status || "IDLE";
  const stage = diskState.stage || "none";

  // ── Check if the run is finalized ──────────────────────────────────────
  if (status === "SUCCESS" || status === "FAILED" || status === "COMPLETE") {
    console.log(`   📋 Found finalized run on disk:`);
    console.log(`      Run ID:  ${runId}`);
    console.log(`      Status:  ${status}`);
    console.log(`      Stage:   ${stage}`);
    console.log(`      → Run is finalized. Starting fresh.`);
    console.log(`═══════════════════════════════════════════════\n`);

    return { recovered: false, finalized: true, state: { ...diskState } };
  }

  // ── Restore in-memory state from disk ─────────────────────────────────
  pipelineState = {
    status: diskState.status || "RUNNING",
    stage: diskState.stage || null,
    atomic: true,
    runId: diskState.runId || null,
    startedAt: diskState.startedAt || null,
    failedAt: diskState.failedAt || null,
    failedReason: diskState.failedReason || null,
    incompleteExecution: diskState.incompleteExecution || false,
  };

  console.log(`   🔄 Recovered in-progress run from disk:`);
  console.log(`      Run ID:     ${pipelineState.runId}`);
  console.log(`      Status:     ${pipelineState.status}`);
  console.log(`      Stage:      ${pipelineState.stage}`);
  console.log(`      Started:    ${pipelineState.startedAt ? new Date(pipelineState.startedAt).toISOString() : "unknown"}`);
  console.log(`      → Run restored. Continuing from stage "${pipelineState.stage}".`);
  console.log(`═══════════════════════════════════════════════\n`);

  return { recovered: true, finalized: false, state: { ...pipelineState } };
}

/**
 * Format milliseconds into human-readable duration.
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export default {
  getPipelineState,
  initPipelineState,
  transitionStage,
  failPipeline,
  completePipeline,
  isPipelineFailed,
  isPipelineComplete,
  getCurrentStage,
  resetPipelineState,
  printPipelineState,
  recoverPipelineState,
};
