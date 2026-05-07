/**
 * memory.js — v3 Self-Improving Feedback Loop
 *
 * Manages the newsletter run history stored in memory/newsletter-history.json.
 * Keeps last 30 runs. Never crashes the operator.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = path.join(__dirname, "memory", "newsletter-history.json");
const MAX_RUNS = 30;

/**
 * Read the current history from the memory file.
 * Returns an empty runs array on any error.
 */
function readHistory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      return { runs: [] };
    }
    const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.runs)) {
      return parsed;
    }
    return { runs: [] };
  } catch (err) {
    console.log(`[MEMORY] Failed to read history: ${err.message} — starting fresh`);
    return { runs: [] };
  }
}

/**
 * Write history to the memory file.
 * Silently fails if write fails.
 */
function writeHistory(history) {
  try {
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(history, null, 2), "utf-8");
  } catch (err) {
    console.log(`[MEMORY] Failed to write history: ${err.message}`);
  }
}

/**
 * Save a run entry to the newsletter history.
 * Keeps only the last 30 runs (oldest removed first).
 *
 * @param {object} entry - { date, job, scores, issues, commit }
 */
export function saveRun(entry) {
  try {
    if (!entry || typeof entry !== "object") {
      console.log("[MEMORY] Invalid entry — skipping");
      return;
    }

    const history = readHistory();

    // Append new entry
    history.runs.push({
      date: entry.date || new Date().toISOString(),
      job: entry.job || "unknown",
      scores: entry.scores || { clarity: 7, relevance: 7, gcc_focus: 7, readability: 7, overall: 7 },
      issues: Array.isArray(entry.issues) ? entry.issues : [],
      commit: entry.commit || "unknown",
    });

    // Keep only last 30 runs (trim from front)
    if (history.runs.length > MAX_RUNS) {
      history.runs = history.runs.slice(history.runs.length - MAX_RUNS);
    }

    writeHistory(history);

    console.log(
      `[MEMORY] Saved run #${history.runs.length} — scores: ` +
        `${entry.scores?.overall ?? "?"}/10, job: ${entry.job || "?"}`
    );
  } catch (err) {
    // Never crash — log and move on
    console.log(`[MEMORY] Failed to save run: ${err.message}`);
  }
}
