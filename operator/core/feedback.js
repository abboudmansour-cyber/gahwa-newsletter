/**
 * feedback.js — v4 Self-Improving Feedback Loop
 *
 * Manages:
 *   1. `/logs/feedback.json` — structured feedback store (last 100 entries)
 *   2. Prompt evolution — delegates to prompt-evolver.js for detection + evolution
 *   3. Improvement summary — builds the "IMPROVE THESE WEAKNESSES" input for DeepSeek
 *
 * Pure filesystem-based learning. No ML. No external services.
 *
 * Architecture: feedback storage + evolution delegation.
 * Prompt evolution logic lives in prompt-evolver.js (single responsibility).
 *
 * @module feedback
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateNewsletter } from "./evaluator.js";
import {
  checkPromptEvolution,
  buildImprovementHint,
  buildPreRunImprovementHint as evolverBuildPreRunHint,
} from "./prompt-evolver.js";
import { emitEvent } from "./event-emitter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, "..", "logs");
const FEEDBACK_FILE = path.join(LOGS_DIR, "feedback.json");
const MAX_FEEDBACK = 100;
const MAX_WEAKNESS_TAGS = 3;

// ── Safe JSON file read/write helpers ──────────────────────────────────────

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

function writeJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.log(`[FEEDBACK] Failed to write ${filePath}: ${err.message}`);
  }
}

// ── Feedback entry structure ──────────────────────────────────────────────

/**
 * Build a standardized feedback entry from evaluator output.
 *
 * @param {string} runId
 * @param {object} scores - From evaluator.js
 * @returns {object} feedback entry
 */
function buildFeedbackEntry(runId, scores) {
  return {
    runId,
    timestamp: new Date().toISOString(),
    score: {
      clarity: scores.clarity ?? 7,
      gccRelevance: scores.gccRelevance ?? 7,
      marketDepth: scores.marketDepth ?? 7,
      readability: scores.readability ?? 7,
      overall: scores.overall ?? 7,
    },
    weaknessTags: (scores.weaknessTags || []).slice(0, MAX_WEAKNESS_TAGS),
    suggestedPromptAdjustments: scores.suggestedPromptAdjustments || "",
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Full feedback pipeline:
 *   1. Evaluate newsletter
 *   2. Append structured feedback to /logs/feedback.json
 *   3. Trim to last 100 entries
 *   4. Check for prompt evolution trigger (delegates to prompt-evolver.js)
 *   5. Return feedback summary for DeepSeek ingestion
 *
 * @param {string} runId
 * @param {object} newsletter - Parsed newsletter JSON
 * @param {string} jobName - Job name for context
 * @returns {Promise<{evaluation: object, feedback: object, improvementHint: string, promptEvolved: boolean}>}
 */
export async function processFeedback(runId, newsletter, jobName = "daily-newsletter") {
  // Step 1: Evaluate
  const evaluation = evaluateNewsletter(newsletter);

  // Step 2: Build and append feedback entry
  const entry = buildFeedbackEntry(runId, evaluation);
  const history = readJson(FEEDBACK_FILE);
  history.push(entry);

  // Trim to max
  const trimmed = history.length > MAX_FEEDBACK ? history.slice(-MAX_FEEDBACK) : history;
  writeJson(FEEDBACK_FILE, trimmed);

  console.log(
    `[FEEDBACK] Saved run ${runId} — overall: ${entry.score.overall}/10, weaknesses: ${entry.weaknessTags.join(", ")}`
  );

  // ── EVENT: Feedback recorded ─────────────────────────────────────────
  emitEvent({
    type: "FEEDBACK_RECORDED",
    runId,
    data: {
      file: "",
      metadata: {
        overall: entry.score.overall,
        gccRelevance: entry.score.gccRelevance,
        clarity: entry.score.clarity,
        marketDepth: entry.score.marketDepth,
        weaknessTags: entry.weaknessTags,
      },
    },
  });

  // Step 3: Check for prompt evolution trigger (delegated to prompt-evolver.js)
  const promptEvolved = checkPromptEvolution(trimmed);
  if (promptEvolved) {
    console.log("[FEEDBACK] ⚡ Prompt evolution triggered — weaknesses detected across 3+ consecutive runs");
  }

  // Step 4: Build improvement hint for DeepSeek (delegated to prompt-evolver.js)
  const improvementHint = buildImprovementHint(trimmed, evaluation);

  return {
    evaluation,
    feedback: entry,
    improvementHint,
    promptEvolved,
  };
}

/**
 * Build a pre-run improvement hint for injection into DeepSeek prompt.
 * Uses the LAST run's feedback to tell DeepSeek what to improve BEFORE generating.
 * Called BEFORE newsletter generation (unlike buildImprovementHint which runs after).
 *
 * Delegates to prompt-evolver.js for the actual hint construction.
 *
 * @returns {string} Improvement hint section to append to DeepSeek prompt
 */
export function buildPreRunImprovementHint() {
  return evolverBuildPreRunHint();
}

/**
 * Get the feedback history for external use (e.g., by replay.js or status checks).
 * @returns {Array}
 */
export function getFeedbackHistory() {
  return readJson(FEEDBACK_FILE);
}

/**
 * Get the latest feedback entry.
 * @returns {object|null}
 */
export function getLatestFeedback() {
  const history = readJson(FEEDBACK_FILE);
  return history.length > 0 ? history[history.length - 1] : null;
}
