/**
 * logger.js — Execution Logging Module
 *
 * Logs successful and failed runs to /logs/success.json and /logs/failed.json.
 * Also maintains a runs.json with full execution history (last 200 entries).
 * Keeps only the last 100 entries per success/failed log.
 *
 * @module logger
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "..", "logs");
const FAILED_FILE = path.join(LOGS_DIR, "failed.json");
const SUCCESS_FILE = path.join(LOGS_DIR, "success.json");
const RUNS_FILE = path.join(LOGS_DIR, "runs.json");
const MAX_ENTRIES = 100;
const MAX_RUNS = 200;

/**
 * Generate a short random ID for run tracking.
 * Format: YYYY-MM-DD-XXXXX where XXXXX is a 5-char alphanumeric
 * @returns {string}
 */
export function generateRunId() {
  const date = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).substring(2, 7);
  return `${date}-${rand}`;
}

// Ensure logs directory exists at module load
try {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch (err) {
  console.error(`[FATAL] Cannot create logs directory: ${err.message}`);
  process.exit(1);
}

/**
 * Read a JSON log file, returning an array.
 * Handles missing or corrupted files gracefully.
 *
 * @param {string} filePath
 * @returns {Array}
 */
function readLog(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Write a log entry to a JSON file, keeping only the last MAX_ENTRIES.
 *
 * @param {string} filePath
 * @param {object} entry
 */
function appendLog(filePath, entry, limit = MAX_ENTRIES) {
  try {
    const entries = readLog(filePath);
    entries.push(entry);
    const trimmed = entries.length > limit ? entries.slice(-limit) : entries;
    fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    console.error(`[LOG ERROR] Could not write to ${filePath}: ${err.message}`);
  }
}

/**
 * Format milliseconds into human-readable duration.
 *
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

/**
 * Log a successful run.
 *
 * @param {number} durationMs - Execution duration in milliseconds
 */
export function logSuccess(durationMs) {
  appendLog(SUCCESS_FILE, {
    timestamp: new Date().toISOString(),
    duration: formatDuration(durationMs),
    status: "SUCCESS",
  });
}

/**
 * Log a failed run.
 *
 * @param {string} error - Error message
 * @param {string} context - Execution context (e.g., "daily-newsletter")
 */
export function logFailure(error, context = "daily-newsletter") {
  appendLog(FAILED_FILE, {
    timestamp: new Date().toISOString(),
    error: error || "Unknown error",
    context,
  });
}

/**
 * Log a generic run event with custom metadata.
 *
 * @param {string} event - Event name (e.g., "run_started", "lock_acquired")
 * @param {object} metadata - Additional data to log
 */
export function logRun(event, metadata = {}) {
  appendLog(SUCCESS_FILE, {
    timestamp: new Date().toISOString(),
    event,
    ...metadata,
  });
}

/**
 * Get count of entries in each log.
 * @returns {{ failed: number, success: number }}
 */
export function logCounts() {
  return {
    failed: readLog(FAILED_FILE).length,
    success: readLog(SUCCESS_FILE).length,
    runs: readLog(RUNS_FILE).length,
  };
}

/**
 * Log the start of a run to runs.json.
 *
 * @param {string} runId - Unique run identifier
 * @param {string} job - Job name (e.g., "daily-newsletter")
 */
export function logRunStart(runId, job = "daily-newsletter") {
  const entry = {
    runId,
    timestamp: new Date().toISOString(),
    status: "running",
    job,
    durationMs: 0,
    stepSummary: {
      deepseek: false,
      operator: false,
      git: false,
      appsScript: false,
    },
    error: null,
  };
  appendLog(RUNS_FILE, entry, MAX_RUNS);
  return entry;
}

/**
 * Update a run's step status in runs.json.
 *
 * @param {string} runId - Unique run identifier
 * @param {string} step - Step name (deepseek, operator, git, appsScript)
 * @param {boolean} status - Whether the step completed successfully
 */
export function logRunStep(runId, step, status) {
  const runs = readLog(RUNS_FILE);
  const idx = runs.findIndex((r) => r.runId === runId);
  if (idx === -1) return;

  const run = runs[idx];
  run.stepSummary[step] = status;
  runs[idx] = run;
  const trimmed = runs.length > MAX_RUNS ? runs.slice(-MAX_RUNS) : runs;
  try {
    fs.writeFileSync(RUNS_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    console.error(`[LOG ERROR] Could not update run ${runId}: ${err.message}`);
  }
}

/**
 * Finalize a run in runs.json with its final status.
 *
 * @param {string} runId - Unique run identifier
 * @param {string} status - "success" or "failed"
 * @param {number} durationMs - Total execution duration
 * @param {string|null} error - Error message if failed
 */
export function logRunEnd(runId, status, durationMs, error = null) {
  const runs = readLog(RUNS_FILE);
  const idx = runs.findIndex((r) => r.runId === runId);
  if (idx === -1) return;

  const run = runs[idx];
  run.status = status;
  run.durationMs = durationMs;
  run.error = error;
  runs[idx] = run;
  const trimmed = runs.length > MAX_RUNS ? runs.slice(-MAX_RUNS) : runs;
  try {
    fs.writeFileSync(RUNS_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    console.error(`[LOG ERROR] Could not finalize run ${runId}: ${err.message}`);
  }
}

/**
 * Get a specific run by runId from runs.json.
 * @param {string} runId
 * @returns {object|null}
 */
export function getRun(runId) {
  const runs = readLog(RUNS_FILE);
  return runs.find((r) => r.runId === runId) || null;
}

/**
 * Get all runs from runs.json.
 * @returns {Array}
 */
export function getAllRuns() {
  return readLog(RUNS_FILE);
}
