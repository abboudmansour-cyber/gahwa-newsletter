/**
 * recovery.js — Recovery Index Manager
 *
 * Manages the recovery-index.json, which is the single source of truth
 * for all failed/missing runs that need automated replay.
 *
 * This module is intentionally lightweight — it only reads/writes the index.
 * The replay engine (replay-engine.js) consumes this data.
 *
 * @module recovery
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECOVERY_INDEX = path.join(__dirname, "..", "logs", "recovery-index.json");
const MAX_INDEX = 500;

// ── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Read the recovery index, returning an array.
 * Handles missing or corrupted files gracefully.
 *
 * @returns {Array}
 */
function readIndex() {
  try {
    if (!fs.existsSync(RECOVERY_INDEX)) return [];
    const data = JSON.parse(fs.readFileSync(RECOVERY_INDEX, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Write entries to the recovery index, trimming to MAX_INDEX.
 *
 * @param {Array} entries
 */
function writeIndex(entries) {
  try {
    const dir = path.dirname(RECOVERY_INDEX);
    fs.mkdirSync(dir, { recursive: true });
    const trimmed = entries.length > MAX_INDEX ? entries.slice(-MAX_INDEX) : entries;
    fs.writeFileSync(RECOVERY_INDEX, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    console.error(`[RECOVERY] Could not write index: ${err.message}`);
  }
}

/**
 * Get the short git commit hash for the current HEAD.
 *
 * @returns {string}
 */
function getGitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

// ── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Append a new entry to the recovery index.
 *
 * @param {object} params
 * @param {string} params.runId     - The run ID that failed
 * @param {string} params.date      - The ISO date string of the run
 * @param {string} params.job       - The job name (e.g., "daily-newsletter")
 * @param {string} params.status    - "FAILED" | "PARTIAL" | "MISSING_PUSH"
 * @param {string} params.reason    - Human-readable failure reason
 * @param {string} [params.commit]  - Git commit hash (auto-detected if omitted)
 */
export function appendRecoveryEntry({ runId, date, job, status, reason, commit }) {
  const entries = readIndex();

  // ── Dedup: don't append if an identical runId already exists ──────────
  if (entries.some((e) => e.runId === runId)) {
    console.log(`[RECOVERY] Entry for run ${runId} already exists — skipping`);
    return;
  }

  const entry = {
    runId: runId || "unknown",
    date: date || new Date().toISOString().slice(0, 10),
    job: job || "daily-newsletter",
    status: status || "FAILED",
    reason: reason || "Unknown failure",
    commit: commit || getGitCommit(),
    replayEligible: true,
    replayAttemptCount: 0,
    createdAt: new Date().toISOString(),
  };

  entries.push(entry);
  writeIndex(entries);
  console.log(`[RECOVERY] Indexed: ${runId} — ${status} (${reason})`);
}

/**
 * Get all entries that are eligible for replay (replayEligible === true).
 *
 * @returns {Array}
 */
export function getEligibleReplays() {
  return readIndex().filter((e) => e.replayEligible === true);
}

/**
 * Get all entries in the recovery index.
 *
 * @returns {Array}
 */
export function getAllEntries() {
  return readIndex();
}

/**
 * Get a single entry by runId.
 *
 * @param {string} runId
 * @returns {object|null}
 */
export function getEntry(runId) {
  return readIndex().find((e) => e.runId === runId) || null;
}

/**
 * Increment the replay attempt counter for a runId.
 * If attempts exceed 2, sets replayEligible to false automatically.
 *
 * @param {string} runId
 * @returns {number} The new attempt count
 */
export function incrementReplayAttempt(runId) {
  const entries = readIndex();
  const idx = entries.findIndex((e) => e.runId === runId);
  if (idx === -1) return 0;

  const entry = entries[idx];
  entry.replayAttemptCount = (entry.replayAttemptCount || 0) + 1;

  // Auto-disable if exceeded max attempts (guard against replay loop)
  if (entry.replayAttemptCount > 2) {
    entry.replayEligible = false;
    entry.status = "FAILED_PERMANENT";
    entry.reason = (entry.reason || "") + " | REPLAY_ABORTED: exceeded max attempts";
    console.log(`[RECOVERY] ⛔ Replay loop guard triggered for ${runId} — marked FAILED_PERMANENT`);
  }

  entries[idx] = entry;
  writeIndex(entries);
  return entry.replayAttemptCount;
}

/**
 * Mark a run as successfully replayed — removes it from the eligible list.
 *
 * @param {string} runId
 */
export function markAsReplayed(runId) {
  const entries = readIndex();
  const idx = entries.findIndex((e) => e.runId === runId);
  if (idx === -1) return;

  entries[idx].replayEligible = false;
  entries[idx].status = "RECOVERED";
  entries[idx].reason = (entries[idx].reason || "") + " | RECOVERED via replay";
  entries[idx].recoveredAt = new Date().toISOString();
  entries[idx].recoveredByReplay = true;

  entries[idx] = entries[idx];
  writeIndex(entries);
  console.log(`[RECOVERY] ✅ Run ${runId} marked as RECOVERED`);
}

/**
 * Mark a replay as permanently failed (not eligible for further retries).
 *
 * @param {string} runId
 * @param {string} reason
 */
export function markFailedReplay(runId, reason) {
  const entries = readIndex();
  const idx = entries.findIndex((e) => e.runId === runId);
  if (idx === -1) return;

  entries[idx].replayEligible = false;
  entries[idx].status = "FAILED_PERMANENT";
  entries[idx].reason = (entries[idx].reason || "") + " | REPLAY_FAILED: " + reason;
  entries[idx].lastReplayedAt = new Date().toISOString();

  entries[idx] = entries[idx];
  writeIndex(entries);
  console.log(`[RECOVERY] ❌ Run ${runId} marked as FAILED_PERMANENT — ${reason}`);
}

/**
 * Get the count of pending (eligible) replays.
 *
 * @returns {number}
 */
export function getPendingReplayCount() {
  return readIndex().filter((e) => e.replayEligible === true).length;
}

/**
 * Remove duplicate entries with the same runId (cleanup utility).
 */
export function dedupIndex() {
  const entries = readIndex();
  const seen = new Set();
  const deduped = entries.filter((e) => {
    if (seen.has(e.runId)) return false;
    seen.add(e.runId);
    return true;
  });
  if (deduped.length !== entries.length) {
    writeIndex(deduped);
    console.log(`[RECOVERY] Deduped index: ${entries.length} → ${deduped.length} entries`);
  }
}
