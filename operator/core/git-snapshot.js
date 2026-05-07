/**
 * git-snapshot.js — Git Snapshot Layer
 *
 * Critical infrastructure for the Git-backed execution state machine.
 *
 * Provides per-step git state capture, diff computation, and auto-commit.
 * Every operator step runs through: snapshotBefore → execute → snapshotAfter → computeDiff → persist
 *
 * This is NOT a log. It is the execution truth layer:
 *   - Before every step: capture HEAD hash
 *   - After every step: capture HEAD hash + file changes
 *   - Compute structured diff per step
 *   - Auto-commit to make each step a replayable state transition
 *
 * @module git-snapshot
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Capture git state BEFORE a step executes.
 * Returns the current HEAD hash.
 *
 * @returns {object} { headHash, timestamp }
 */
export function snapshotBefore() {
  try {
    const headHash = execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      cwd: PROJECT_ROOT,
      timeout: 5000,
    }).trim();

    console.log(`   [GIT-SNAPSHOT] Before: ${headHash.substring(0, 12)}...`);

    return {
      headHash,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`   [GIT-SNAPSHOT] ❌ snapshotBefore failed: ${err.message}`);
    return {
      headHash: null,
      timestamp: new Date().toISOString(),
      error: err.message,
    };
  }
}

/**
 * Capture git state AFTER a step executes.
 * Returns HEAD hash + all changed files (staged, unstaged, untracked).
 *
 * @returns {object} { headHash, timestamp, changedFiles, untrackedFiles }
 */
export function snapshotAfter() {
  try {
    const headHash = execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      cwd: PROJECT_ROOT,
      timeout: 5000,
    }).trim();

    // Get staged + unstaged changes
    const diffStaged = execSync(
      "git diff --cached --name-status",
      { encoding: "utf-8", cwd: PROJECT_ROOT, timeout: 5000 }
    ).trim();

    const diffUnstaged = execSync(
      "git diff --name-status",
      { encoding: "utf-8", cwd: PROJECT_ROOT, timeout: 5000 }
    ).trim();

    // Get untracked files
    const untracked = execSync(
      "git ls-files --others --exclude-standard",
      { encoding: "utf-8", cwd: PROJECT_ROOT, timeout: 5000 }
    ).trim();

    const stagedFiles = parseChangedFiles(diffStaged);
    const unstagedFiles = parseChangedFiles(diffUnstaged);
    const untrackedFiles = untracked ? untracked.split("\n").filter(Boolean) : [];

    console.log(`   [GIT-SNAPSHOT] After: ${headHash.substring(0, 12)}...`);

    return {
      headHash,
      timestamp: new Date().toISOString(),
      stagedFiles,
      unstagedFiles,
      untrackedFiles,
    };
  } catch (err) {
    console.error(`   [GIT-SNAPSHOT] ❌ snapshotAfter failed: ${err.message}`);
    return {
      headHash: null,
      timestamp: new Date().toISOString(),
      stagedFiles: [],
      unstagedFiles: [],
      untrackedFiles: [],
      error: err.message,
    };
  }
}

/**
 * Compute structured diff between before and after snapshots.
 *
 * Returns categorised file changes: added, modified, deleted.
 * Uses git diff between commits if HEAD changed, otherwise working tree diff.
 *
 * @param {object} before - Result from snapshotBefore()
 * @param {object} after  - Result from snapshotAfter()
 * @returns {object} { filesAdded: string[], filesModified: string[], filesDeleted: string[] }
 */
export function computeDiff(before, after) {
  const filesAdded = [];
  const filesModified = [];
  const filesDeleted = [];

  try {
    // ── HEAD changed → use commit-to-commit diff ───────────────────────
    if (before.headHash && after.headHash && before.headHash !== after.headHash) {
      const diffOutput = execSync(
        `git diff --name-status ${before.headHash}..${after.headHash}`,
        { encoding: "utf-8", cwd: PROJECT_ROOT, timeout: 10000 }
      ).trim();

      if (diffOutput) {
        const parsed = parseChangedFiles(diffOutput);
        for (const [status, file] of parsed) {
          if (status === "A") filesAdded.push(file);
          else if (status === "D") filesDeleted.push(file);
          else filesModified.push(file);
        }
      }

      console.log(`   [GIT-SNAPSHOT] HEAD changed: ${before.headHash.substring(0, 8)} → ${after.headHash.substring(0, 8)}`);

    // ── HEAD unchanged → use working tree diff ─────────────────────────
    } else {
      // All staged changes
      if (after.stagedFiles) {
        for (const [status, file] of after.stagedFiles) {
          if (status === "A") filesAdded.push(file);
          else if (status === "D") filesDeleted.push(file);
          else filesModified.push(file);
        }
      }

      // All unstaged changes (treat as modified)
      if (after.unstagedFiles) {
        for (const [, file] of after.unstagedFiles) {
          if (!filesModified.includes(file) && !filesAdded.includes(file)) {
            filesModified.push(file);
          }
        }
      }

      // Untracked files = added
      if (after.untrackedFiles) {
        for (const file of after.untrackedFiles) {
          if (!filesAdded.includes(file)) {
            filesAdded.push(file);
          }
        }
      }
    }
  } catch (err) {
    console.error(`   [GIT-SNAPSHOT] ❌ computeDiff failed: ${err.message}`);
  }

  // Deduplicate and sort
  return {
    filesAdded: [...new Set(filesAdded)].sort(),
    filesModified: [...new Set(filesModified)].sort(),
    filesDeleted: [...new Set(filesDeleted)].sort(),
  };
}

/**
 * Auto-commit all current changes with a descriptive, traceable message.
 *
 * The commit message format is: "exec: <step> — <runId>"
 * This makes every step a traceable, replayable git state transition.
 *
 * @param {string} step  - The step name (e.g., "generate_newsletter")
 * @param {string} runId - The run identifier
 * @returns {boolean} Whether the commit succeeded
 */
export function autoCommit(step, runId) {
  try {
    // ── Check for any changes (staged, unstaged, untracked) ─────────────
    const status = execSync("git status --porcelain", {
      encoding: "utf-8",
      cwd: PROJECT_ROOT,
      timeout: 5000,
    }).trim();

    if (!status) {
      console.log(`   [GIT] No changes to commit for step "${step}"`);
      return true;
    }

    // Stage everything
    execSync("git add -A", { stdio: "pipe", cwd: PROJECT_ROOT, timeout: 10000 });

    const commitMsg = `exec: ${step} — ${runId}`;
    execSync(
      `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`,
      { stdio: "pipe", cwd: PROJECT_ROOT, timeout: 15000 }
    );

    const newHash = execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      cwd: PROJECT_ROOT,
      timeout: 5000,
    }).trim();

    console.log(`   [GIT] ✅ Committed: "${commitMsg}"`);
    console.log(`   [GIT]    New HEAD: ${newHash.substring(0, 12)}...`);

    return true;
  } catch (err) {
    console.error(`   [GIT] ❌ Auto-commit failed: ${err.message}`);
    return false;
  }
}

/**
 * Checkout a specific git commit (for replay mode).
 * Used to reset state before re-running a failed step.
 *
 * @param {string} targetHash - The git commit hash to checkout
 * @returns {boolean} Whether the checkout succeeded
 */
export function checkoutCommit(targetHash) {
  try {
    // First reset any pending changes
    execSync("git reset --hard", { stdio: "pipe", cwd: PROJECT_ROOT, timeout: 10000 });

    // Clean untracked files
    execSync("git clean -fd", { stdio: "pipe", cwd: PROJECT_ROOT, timeout: 10000 });

    // Checkout target commit
    execSync(
      `git checkout ${targetHash}`,
      { stdio: "pipe", cwd: PROJECT_ROOT, timeout: 15000 }
    );

    console.log(`   [GIT-SNAPSHOT] 🔄 Checked out: ${targetHash.substring(0, 12)}...`);
    return true;
  } catch (err) {
    console.error(`   [GIT-SNAPSHOT] ❌ Checkout failed: ${err.message}`);
    return false;
  }
}

/**
 * Checkout the original branch/HEAD after a replay completes.
 *
 * @param {string} branchOrHash - Branch name or commit hash to return to
 * @returns {boolean} Whether the checkout succeeded
 */
export function checkoutOriginal(branchOrHash) {
  try {
    execSync(
      `git checkout ${branchOrHash}`,
      { stdio: "pipe", cwd: PROJECT_ROOT, timeout: 15000 }
    );
    console.log(`   [GIT-SNAPSHOT] ↩️  Returned to: ${branchOrHash}`);
    return true;
  } catch (err) {
    console.error(`   [GIT-SNAPSHOT] ❌ Return checkout failed: ${err.message}`);
    return false;
  }
}

/**
 * Get the current branch name.
 *
 * @returns {string} Branch name or "unknown"
 */
export function getCurrentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      cwd: PROJECT_ROOT,
      timeout: 5000,
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Verify if a specific commit exists in the repository.
 *
 * @param {string} hash - The commit hash to verify
 * @returns {boolean}
 */
export function commitExists(hash) {
  try {
    execSync(`git cat-file -t ${hash}`, {
      encoding: "utf-8",
      cwd: PROJECT_ROOT,
      timeout: 5000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

// ── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Parse `git diff --name-status` output into [status, filePath] pairs.
 *
 * Example input:
 *   M\tpath/to/file.js
 *   A\tpath/to/new-file.js
 *
 * @param {string} output - Raw git diff output
 * @returns {Array<[string, string]>} Array of [status, filePath] tuples
 */
function parseChangedFiles(output) {
  if (!output || !output.trim()) return [];
  return output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const status = parts[0].trim();
        const filePath = parts.slice(1).join("\t").trim();
        return [status, filePath];
      }
      return null;
    })
    .filter(Boolean);
}

export default {
  snapshotBefore,
  snapshotAfter,
  computeDiff,
  autoCommit,
  checkoutCommit,
  checkoutOriginal,
  getCurrentBranch,
  commitExists,
};
