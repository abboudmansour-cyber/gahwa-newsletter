/**
 * lock.js — Execution Lock Manager
 *
 * Prevents duplicate concurrent newsletter pipeline runs.
 * Uses a JSON lock file stored in tmp/gahwa-lock.json with 10-minute TTL.
 *
 * @module lock
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCK_FILE = path.join(__dirname, "..", "tmp", "gahwa-lock.json");
const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Acquire the execution lock.
 * Returns false if another run is active and lock hasn't expired.
 *
 * @param {string} branch - Git branch for lock metadata (default: "main")
 * @returns {boolean} true if lock acquired, false if already running
 */
export function acquireLock(branch = "main") {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8"));
      const lockAge = Date.now() - new Date(lockData.timestamp).getTime();

      if (lockData.running && lockAge < LOCK_TTL_MS) {
        console.log(`⚠️ Execution already running — skipping duplicate trigger`);
        return false;
      }

      if (lockData.running && lockAge >= LOCK_TTL_MS) {
        console.log(`⚠️ Stale lock found — overriding.`);
      }
    }

    fs.writeFileSync(LOCK_FILE, JSON.stringify({
      running: true,
      timestamp: new Date().toISOString(),
      branch,
    }, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error(`❌ [LOCK ERROR] Failed to acquire lock: ${err.message}`);
    return false;
  }
}

/**
 * Release the execution lock.
 * Safe to call multiple times — silently handles missing lock file.
 */
export function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (err) {
    console.error(`❌ [LOCK CLEANUP ERROR] ${err.message}`);
  }
}

/**
 * Get current lock status.
 * @returns {{ locked: boolean, age?: number, stale?: boolean, data?: object }}
 */
export function isLocked() {
  try {
    if (!fs.existsSync(LOCK_FILE)) {
      return { locked: false };
    }
    const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8"));
    const lockAge = Date.now() - new Date(lockData.timestamp).getTime();
    return {
      locked: lockData.running,
      age: Math.round(lockAge / 1000),
      stale: lockAge >= LOCK_TTL_MS,
      data: lockData,
    };
  } catch {
    return { locked: false, error: "Could not read lock file" };
  }
}
