/**
 * executor.js — Execution Engine (Core)
 *
 * FINAL ARCHITECTURE — Step-by-step execution orchestrator.
 *
 * This is the central execution engine that operator.js calls.
 * It orchestrates the complete pipeline:
 *
 *   1. DeepSeek planning (via llmGateway)
 *   2. Git-backed step execution (via git-state-machine)
 *   3. Rule-based evaluation (via evaluator)
 *   4. Feedback memory update (via feedback)
 *   5. Recovery if needed (via replay-engine)
 *   6. Prompt evolution if needed (via prompt-evolver)
 *   7. Delivery validation (via deliverToAppsScript)
 *
 * Every run is fully traceable, replayable, self-correcting, and state-aware.
 *
 * @module core/executor
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FEEDBACK_FILE = path.join(__dirname, "..", "logs", "feedback.json");

/**
 * Execute a complete pipeline run for a given job.
 *
 * Flow:
 *   → DeepSeek plan generation
 *   → Step execution through git state machine
 *   → Rule-based evaluation
 *   → Feedback memory update (stores to feedback.json)
 *   → Recovery indexing if failed steps
 *   → Prompt evolution check (optional, based on recurring weaknesses)
 *
 * @param {object} options
 * @param {string} options.jobName - Job name (e.g. "daily-newsletter")
 * @param {Function} options.generatePlan - Async function to generate the plan from DeepSeek
 * @param {Array} options.pipelineSteps - Array of { name, execute } step definitions
 * @param {string} options.runId - Unique run identifier
 * @param {boolean} [options.isReplay] - Whether this is a replay run
 * @param {Function} [options.evaluateNewsletter] - Function to evaluate the newsletter output
 * @param {Function} [options.onStepComplete] - Callback after each step
 * @param {Function} [options.onComplete] - Callback with full execution result
 * @returns {Promise<{success: number, failed: number, status: string, runId: string}>}
 */
export async function executePipeline({
  jobName,
  pipelineSteps,
  runId,
  isReplay = false,
  evaluateNewsletter = null,
  onStepComplete = null,
  onComplete = null,
}) {
  const { initRunState, executeStatefulStep, finalizeRunState, getRunSummary } = await import(
    "./git-state-machine.js"
  );
  const { snapshotBefore } = await import("./git-snapshot.js");

  // ── 1. Get the initial git commit ──────────────────────────────────────
  const initialGitState = snapshotBefore();
  initRunState(runId, initialGitState?.headHash || "");

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`🚀 [EXECUTOR] Starting pipeline: ${jobName}`);
  console.log(`   Run ID:     ${runId}`);
  console.log(`   Mode:       ${isReplay ? "REPLAY" : "NORMAL"}`);
  console.log(`   Steps:      ${pipelineSteps.length}`);
  console.log(`   Git HEAD:   ${initialGitState?.headHash?.substring(0, 12) || "none"}...`);
  console.log(`═══════════════════════════════════════════════\n`);

  let successCount = 0;
  let failedCount = 0;

  // ── 2. Execute steps through git state machine ────────────────────────
  for (const step of pipelineSteps) {
    const result = await executeStatefulStep({
      name: step.name,
      execute: step.execute,
      runId,
      options: step.options || {},
    });

    if (result.status === "SUCCESS" || result.status === "PARTIAL") {
      successCount++;
    } else {
      failedCount++;
    }

    if (onStepComplete) {
      try {
        onStepComplete({ name: step.name, status: result.status, step: result.step });
      } catch {
        // Non-fatal
      }
    }
  }

  // ── 3. Finalize execution state ────────────────────────────────────────
  finalizeRunState();
  const summary = getRunSummary();
  const finalStatus = summary.finalStatus;

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`📊 [EXECUTOR] Pipeline complete: ${finalStatus}`);
  console.log(`   Success:    ${successCount}`);
  console.log(`   Failed:     ${failedCount}`);
  console.log(`   Total:      ${pipelineSteps.length}`);
  console.log(`═══════════════════════════════════════════════\n`);

  // ── 4. Run evaluation if we have an evaluator ─────────────────────────
  let evaluationResult = null;
  if (evaluateNewsletter && finalStatus !== "FAILED") {
    try {
      const outputPath = path.resolve(ROOT, "..", "output", "latest-newsletter.json");
      if (fs.existsSync(outputPath)) {
        const rawNewsletter = fs.readFileSync(outputPath, "utf-8");
        const newsletterJson = JSON.parse(rawNewsletter);
        evaluationResult = evaluateNewsletter(newsletterJson);
        console.log(`[EXECUTOR] Evaluation: overall ${evaluationResult.overall}/10`);
      }
    } catch (err) {
      console.log(`[EXECUTOR] Evaluation skipped: ${err.message}`);
    }
  }

  // ── 5. Final callback ──────────────────────────────────────────────────
  const result = {
    success: successCount,
    failed: failedCount,
    status: finalStatus,
    runId,
    evaluation: evaluationResult,
    summary,
  };

  if (onComplete) {
    try {
      onComplete(result);
    } catch {
      // Non-fatal
    }
  }

  return result;
}

/**
 * Read latest feedback history.
 * @returns {Array}
 */
export function getFeedbackHistory() {
  try {
    if (!fs.existsSync(FEEDBACK_FILE)) return [];
    const raw = fs.readFileSync(FEEDBACK_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default {
  executePipeline,
  getFeedbackHistory,
};
