#!/usr/bin/env node

/**
 * executor.js — Pipeline Orchestration Brain
 *
 * Handles:
 *   - runId generation and run lifecycle tracking
 *   - Spawning operator.js as a child process
 *   - Retry logic via retry.js
 *   - Logging via logger.js (success/failure + run history)
 *
 * Exposes:
 *   runJob("daily-newsletter") — full pipeline execution
 *
 * This module contains NO HTTP/webhook logic.
 * This module contains NO lock management.
 *
 * @module executor
 */

import { ensureExecutionContext } from "./core/runtime.js";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { retry } from "./core/retry.js";
import {
  generateRunId,
  logRunStart,
  logRunStep,
  logRunEnd,
  logSuccess,
  logFailure,
} from "./core/logger.js";

// ── Bootstrap execution context (MUST be called before ANY other logic) ─────
ensureExecutionContext();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPERATOR_JS = path.join(__dirname, "operator.js");
const ROOT = path.resolve(__dirname, "..");
const FEEDBACK_FILE = path.join(__dirname, "logs", "feedback.json");

/**
 * Run the full newsletter pipeline with full observability.
 *
 * Orchestrates:
 *   1. Generate unique runId
 *   2. Log run start to runs.json
 *   3. Spawn operator.js as a child process (with retry)
 *   4. Track step summary
 *   5. Finalize run entry (success or failure)
 *
 * @param {string} jobName - The job to execute (default: "daily-newsletter")
 * @returns {Promise<{success: boolean, message: string, runId: string}>}
 */
export async function runJob(jobName = "daily-newsletter") {
  const t0 = Date.now();
  const runId = generateRunId();

  // Log run start to runs.json
  logRunStart(runId, jobName);

  // Execute with retry
  const result = await retry(() => spawnOperator(jobName, runId), {
    retries: 2,
    delay: 10000,
  });

  const durationMs = Date.now() - t0;

  if (result.success) {
    // Mark all steps completed on success
    logRunStep(runId, "deepseek", true);
    logRunStep(runId, "operator", true);
    logRunStep(runId, "git", true);
    logRunStep(runId, "appsScript", true);
    logRunEnd(runId, "success", durationMs);

    logSuccess(durationMs);

    // ── Feedback loop verification ────────────────────────────────────
    // Read latest feedback entry to confirm evaluator ran in child process
    try {
      if (fs.existsSync(FEEDBACK_FILE)) {
        const rawFeedback = fs.readFileSync(FEEDBACK_FILE, "utf-8");
        const feedback = JSON.parse(rawFeedback);
        const lastEntry = feedback[feedback.length - 1];
        if (lastEntry && lastEntry.runId !== "init") {
          console.log(`[EXECUTOR] Feedback confirmed — run ${lastEntry.runId}: ` +
            `overall ${lastEntry.score.overall}/10, weaknesses: ${lastEntry.weaknessTags.join("; ")}`);
        }
      }
    } catch (err) {
      console.log(`[EXECUTOR] Feedback read skipped: ${err.message}`);
    }

    return {
      success: true,
      runId,
      message: `Pipeline completed successfully after ${result.attempts} attempt(s)`,
    };
  }


  // Failure path — always log even on failure
  const errorMsg = result.error || "Unknown error";
  logRunStep(runId, "deepseek", false);
  logRunStep(runId, "operator", false);
  logRunEnd(runId, "failed", durationMs, errorMsg);

  logFailure(errorMsg, jobName);
  return {
    success: false,
    runId,
    message: `Pipeline failed after ${result.attempts} attempt(s) — logged.`,
    error: errorMsg,
  };
}

/**
 * Spawn operator.js as a child process.
 * Resolves on exit code 0, rejects on any error or non-zero exit.
 *
 * @param {string} jobName - Job name to pass as argv
 * @param {string} runId - Run identifier for traceability
 * @returns {Promise<void>}
 */
function spawnOperator(jobName, runId) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [OPERATOR_JS, jobName], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, RUN_ID: runId },
      shell: false,
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn operator.js: ${err.message}`));
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else if (signal) {
        reject(new Error(`operator.js was killed with signal ${signal}`));
      } else {
        reject(new Error(`operator.js exited with code ${code}`));
      }
    });
  });
}
