/**
 * state.js — Global Execution State Lock
 *
 * Prevents overlapping automation loops between execution, recovery, and replay.
 * Provides mutual exclusion: only ONE mode can run at a time.
 *
 * Modes:
 *   NORMAL   — Regular pipeline execution (executor.js → operator.js)
 *   REPLAY   — Automated replay of failed runs (replay-engine.js → operator.js --replay)
 *   RECOVERY — Failure scanning and indexing (executor.js failure path)
 *
 * Lock rule:
 *   Only ONE of {NORMAL, REPLAY, RECOVERY} can be active at a time.
 *   No mode can preempt an active mode — must wait for release.
 *
 * @module state
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "..", "runtime", "state.json");

export const MODES = {
  NORMAL: "NORMAL",
  REPLAY: "REPLAY",
  RECOVERY: "RECOVERY",
};

const MODE_EMOJI = {
  NORMAL: "🧠",
  REPLAY: "🔁",
  RECOVERY: "🛠",
};

const DEFAULT_STATE = {
  mode: MODES.NORMAL,
  activeRunId: "",
  flags: {
    recoveryRunning: false,
    replayRunning: false,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

function ensureRuntimeDir() {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readState() {
  try {
    ensureRuntimeDir();
    if (!fs.existsSync(STATE_FILE)) {
      writeState({ ...DEFAULT_STATE });
      return { ...DEFAULT_STATE };
    }
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return {
      ...DEFAULT_STATE,
      ...data,
      flags: { ...DEFAULT_STATE.flags, ...(data.flags || {}) },
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(state) {
  ensureRuntimeDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Get the current execution state.
 * @returns {object} The current state object
 */
export function getState() {
  return readState();
}

/**
 * Update specific fields in the state.
 * Performs a deep merge for nested objects (e.g., flags).
 * @param {object} partial - State fields to update
 * @returns {object} The updated state
 */
export function setState(partial) {
  const current = readState();
  const merged = deepMerge(current, partial);
  writeState(merged);
  return merged;
}

/**
 * Acquire execution lock for a specific mode.
 *
 * BLOCKS if:
 *   - Another mode already holds the lock (activeRunId is set)
 *   - The same mode is already active (prevents duplicate execution)
 *
 * @param {string} mode - One of MODES: "NORMAL", "REPLAY", "RECOVERY"
 * @param {string} runId - The run identifier
 * @returns {boolean} Whether the lock was successfully acquired
 */
export function acquireLock(mode, runId) {
  const state = readState();

  // Mutual exclusion: refuse if any run is already active
  if (state.activeRunId) {
    console.log(
      `⛔ [LOCK] Cannot acquire ${mode} lock: ` +
      `${state.mode} already active (${state.activeRunId})`
    );
    return false;
  }

  const newState = {
    mode,
    activeRunId: runId || "",
    flags: {
      recoveryRunning: mode === MODES.RECOVERY,
      replayRunning: mode === MODES.REPLAY,
    },
  };

  writeState(newState);

  const emoji = MODE_EMOJI[mode] || "🔒";
  console.log(`\n${emoji} [LOCK] Acquired ${mode} lock (run: ${runId})`);
  return true;
}

/**
 * Release the current execution lock.
 * Resets state to NORMAL with no active run.
 */
export function releaseLock() {
  const state = readState();
  if (state.activeRunId) {
    const emoji = MODE_EMOJI[state.mode] || "🔒";
    console.log(`🔓 [LOCK] Released ${state.mode} lock (run: ${state.activeRunId})`);
  }
  writeState({ ...DEFAULT_STATE });
}

/**
 * Check if a specific mode would be blocked by an active lock.
 *
 * @param {string} mode - The mode to check
 * @returns {boolean} Whether the mode is blocked
 */
export function isBlocked(mode) {
  const state = readState();
  if (!state.activeRunId) return false;
  // Any active lock blocks any mode (mutual exclusion)
  return true;
}

/**
 * Check if a specific operation conflicts with current execution flags.
 * Use this for fine-grained guards in entry points.
 *
 * @param {string} operation - "replay" or "recovery"
 * @returns {boolean} Whether the operation is blocked
 */
export function isOperationBlocked(operation) {
  const state = readState();
  if (operation === "replay" && state.flags.replayRunning) {
    console.log("⛔ Blocked: replay is already running");
    return true;
  }
  if (operation === "recovery" && state.flags.recoveryRunning) {
    console.log("⛔ Blocked: recovery is already running");
    return true;
  }
  return false;
}

/**
 * Print a mode banner for the current execution context.
 * @param {string} mode - The current mode
 * @param {string} [extra] - Optional extra context (e.g., runId)
 */
export function printModeBanner(mode, extra = "") {
  const emoji = MODE_EMOJI[mode] || "⚙️";
  const line = "═".repeat(50);
  console.log(`\n${line}`);
  console.log(`${emoji} MODE: ${mode}${extra ? ` — ${extra}` : ""}`);
  console.log(`${line}\n`);
}
