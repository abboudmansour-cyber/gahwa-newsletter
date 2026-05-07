/**
 * replay-engine.js — Automatic Replay Engine
 *
 * Reads the recovery-index.json, filters replayEligible entries, rebuilds
 * the original execution context (job type, date, prompt snapshot, git commit),
 * and spawns operator.js with --replay flag to re-run the pipeline.
 *
 * This is NOT a new architecture layer. It is a lightweight replay mechanism
 * built on existing logs. No external queue systems, no Redis, no Kafka.
 *
 * @module replay-engine
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { ensureExecutionContext } from "./runtime.js";
import {
  getEligibleReplays,
  getEntry,
  incrementReplayAttempt,
  markAsReplayed,
  markFailedReplay,
  getPendingReplayCount,
} from "./recovery.js";
import {
  acquireLock,
  releaseLock,
  MODES,
  printModeBanner,
} from "./state.js";

// ── Bootstrap execution context ────────────────────────────────────────────
ensureExecutionContext();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPERATOR_JS = path.join(__dirname, "..", "operator.js");
const ROOT = path.resolve(__dirname, "..", "..");

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const MAX_REPLAYS_PER_RUN = 5; // Max number of failed runs to replay in one cycle
const REPLAY_TIMEOUT_MS = 120_000; // 2 minutes per replay before timeout

// ── REPLAY EXECUTION ───────────────────────────────────────────────────────

/**
 * Run the replay engine.
 *
 * 1. Reads recovery-index.json
 * 2. Filters replayEligible: true entries
 * 3. Rebuilds execution context
 * 4. Spawns operator.js --replay for each eligible run (up to MAX_REPLAYS_PER_RUN)
 * 5. Updates recovery index on success/failure
 *
 * @returns {Promise<{replayed: number, succeeded: number, failed: number, pending: number}>}
 */
export async function runReplayEngine() {
  // ── LOOP ISOLATION: Acquire REPLAY lock ─────────────────────────────
  // Blocks if NORMAL or RECOVERY is already active (mutual exclusion).
  // This prevents replay from overlapping with a running pipeline execution.
  const replayRunId = `replay-cycle-${Date.now()}`;

  if (!acquireLock(MODES.REPLAY, replayRunId)) {
    console.log("⛔ [REPLAY-ENGINE] Cannot acquire REPLAY lock — another mode is active. Aborting replay cycle.");
    return { replayed: 0, succeeded: 0, failed: 0, pending: getPendingReplayCount() };
  }

  printModeBanner(MODES.REPLAY, `cycle ${replayRunId}`);

  try {
    const pending = getEligibleReplays();

    if (pending.length === 0) {
      console.log("[REPLAY-ENGINE] No eligible replays found — nothing to do");
      return { replayed: 0, succeeded: 0, failed: 0, pending: 0 };
    }

    console.log("\n═══════════════════════════════════════════════");
    console.log("🔄 REPLAY ENGINE STARTED");
    console.log(`   Pending replays: ${pending.length}`);
    console.log(`   Max per cycle:   ${MAX_REPLAYS_PER_RUN}`);
    console.log("═══════════════════════════════════════════════\n");

    // Process up to MAX_REPLAYS_PER_RUN entries per cycle
    const batch = pending.slice(0, MAX_REPLAYS_PER_RUN);
    let succeeded = 0;
    let failed = 0;

    for (const entry of batch) {
      console.log(`\n───────────────────────────────────────────────`);
      console.log(`🔄 Replaying run: ${entry.runId}`);
      console.log(`   Job:    ${entry.job}`);
      console.log(`   Date:   ${entry.date}`);
      console.log(`   Status: ${entry.status}`);
      console.log(`   Reason: ${entry.reason}`);
      if (entry.commit && entry.commit !== "unknown") {
        console.log(`   Commit: ${entry.commit}`);
      }

      // ── REPLAY LOOP GUARD: increment attempt counter BEFORE execution ──
      const attemptCount = incrementReplayAttempt(entry.runId);

      // Check if the guard already tripped (attempt > 2)
      const currentEntry = getEntry(entry.runId);
      if (!currentEntry || !currentEntry.replayEligible) {
        console.log(`   ⛔ Replay loop guard active — ${entry.runId} exceeded max attempts`);
        failed++;
        continue;
      }

      const success = await spawnReplayWithTimeout(entry, attemptCount);

      if (success) {
        markAsReplayed(entry.runId);
        succeeded++;
        console.log(`   ✅ REPLAY SUCCEEDED — ${entry.runId}`);
      } else {
        markFailedReplay(entry.runId, `Replay attempt ${attemptCount} failed`);
        failed++;
        console.log(`   ❌ REPLAY FAILED — ${entry.runId}`);
      }
    }

    const remaining = getPendingReplayCount();

    console.log("\n═══════════════════════════════════════════════");
    console.log("📊 REPLAY ENGINE SUMMARY");
    console.log(`   Replayed:  ${batch.length}`);
    console.log(`   Succeeded: ${succeeded}`);
    console.log(`   Failed:    ${failed}`);
    console.log(`   Remaining: ${remaining}`);
    console.log("═══════════════════════════════════════════════\n");

    return { replayed: batch.length, succeeded, failed, pending: remaining };
  } finally {
    releaseLock();
  }
}

/**
 * Spawn operator.js with --replay flag and wait for completion.
 * Uses a timeout to prevent runaway processes.
 *
 * @param {object} entry - The recovery index entry
 * @param {number} attemptCount - Current replay attempt number
 * @returns {Promise<boolean>} Whether the replay succeeded
 */
function spawnReplayWithTimeout(entry, attemptCount) {
  return new Promise((resolve) => {
    // Build args: operator.js <job> --replay
    const childArgs = [OPERATOR_JS, entry.job || "daily-newsletter", "--replay"];

    console.log(`   🚀 Spawning: node operator operator.js ${entry.job} --replay`);

    const child = spawn("node", childArgs, {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        RUN_ID: `replay-${entry.runId}-v${attemptCount}`,
        REPLAY_SOURCE: entry.runId,
        REPLAY_ATTEMPT: String(attemptCount),
      },
      shell: false,
    });

    // ── Timeout guard ──────────────────────────────────────────────────
    const timer = setTimeout(() => {
      console.log(`   ⏰ REPLAY TIMEOUT — ${entry.runId} exceeded ${REPLAY_TIMEOUT_MS / 1000}s`);
      child.kill("SIGTERM");
      resolve(false);
    }, REPLAY_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      console.log(`   ❌ Failed to spawn: ${err.message}`);
      resolve(false);
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(true);
      } else if (signal) {
        console.log(`   ❌ Killed with signal ${signal}`);
        resolve(false);
      } else {
        console.log(`   ❌ Exited with code ${code}`);
        resolve(false);
      }
    });
  });
}

/**
 * Enqueue a specific run for replay by adding it to the recovery index
 * and then triggering the replay engine immediately.
 *
 * This is called automatically after a failure.
 *
 * @param {string} runId - The failed run ID
 * @param {string} job - The job name
 * @param {string} reason - Failure reason
 * @param {object} [options]
 * @param {string} [options.date] - The run date
 * @param {string} [options.commit] - Git commit hash
 */
export async function enqueueReplay(runId, job, reason, options = {}) {
  // Import here to avoid circular dependency
  const { appendRecoveryEntry } = await import("./recovery.js");

  appendRecoveryEntry({
    runId,
    date: options.date || new Date().toISOString().slice(0, 10),
    job: job || "daily-newsletter",
    status: options.status || "FAILED",
    reason: reason || "Enqueued for automatic replay",
    commit: options.commit,
  });

  console.log(`🔁 Run ${runId} enqueued for automatic replay`);

  // Trigger the replay engine immediately
  const result = await runReplayEngine();
  return result;
}

/**
 * Run the replay engine standalone (CLI entry point).
 */
async function main() {
  const result = await runReplayEngine();
  process.exit(result.failed > 0 ? 1 : 0);
}

// Allow standalone execution: node core/replay-engine.js
const isDirectRun = process.argv[1] && process.argv[1].endsWith("replay-engine.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[REPLAY-ENGINE FATAL] ${err.message}`);
    process.exit(1);
  });
}

export default {
  runReplayEngine,
  enqueueReplay,
};
