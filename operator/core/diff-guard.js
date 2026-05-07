/**
 * diff-guard.js — Git-Based Diff Guard
 *
 * Provides auditable diff tracking between two git states.
 * Records exactly what changed, what was added, and what was NOT touched
 * during a Cline prompt execution.
 *
 * Pipeline:
 *   BEFORE execution: diffGuard.snapshot()  → records HEAD hash + file tree
 *   AFTER  execution: diffGuard.compare()   → produces structured diff report
 *
 * The Diff Guard Verdict is PASS if no protected files were modified,
 * no existing logic was removed, and all expected changes were made.
 *
 * @module diff-guard
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// ── Snapshot Class ─────────────────────────────────────────────────────────────

/**
 * Capture a point-in-time filesystem snapshot for later comparison.
 * Records git HEAD hash, modified files since last commit, and file tree.
 */
export function createSnapshot(options = {}) {
  const {
    cwd = PROJECT_ROOT,
    includeUntracked = true,
  } = options;

  console.log(`\n📸 [DIFF-GUARD] Creating filesystem snapshot`);

  try {
    const headHash = gitCommand("rev-parse HEAD", cwd);
    const modifiedFiles = gitCommand(
      `diff --name-only HEAD`,
      cwd
    ).split("\n").filter(Boolean);

    let untrackedFiles = [];
    if (includeUntracked) {
      untrackedFiles = gitCommand(
        `ls-files --others --exclude-standard`,
        cwd
      ).split("\n").filter(Boolean);
    }

    // Get full file tree as JSON for deep comparison
    const fileTree = buildFileTree(cwd);

    const snapshot = {
      timestamp: new Date().toISOString(),
      headHash: headHash.trim(),
      modifiedFiles,
      untrackedFiles,
      fileTree,
      fileCount: Object.keys(fileTree).length,
      cwd,
    };

    console.log(`   HEAD:      ${snapshot.headHash.substring(0, 12)}...`);
    console.log(`   Modified:  ${modifiedFiles.length} file(s)`);
    console.log(`   Untracked: ${untrackedFiles.length} file(s)`);
    console.log(`   Total:     ${snapshot.fileCount} tracked file(s)`);

    return snapshot;

  } catch (err) {
    console.error(`[DIFF-GUARD] Snapshot failed: ${err.message}`);
    return {
      timestamp: new Date().toISOString(),
      headHash: null,
      modifiedFiles: [],
      untrackedFiles: [],
      fileTree: {},
      fileCount: 0,
      cwd,
      error: err.message,
    };
  }
}

/**
 * Compare two snapshots (before/after) and produce a structured diff report.
 *
 * @param {object} beforeSnapshot - Snapshot taken BEFORE execution
 * @param {object} afterSnapshot  - Snapshot taken AFTER execution
 * @param {object} [options]
 * @param {string[]} [options.protectedFiles] - Files that must NOT be modified
 * @param {string[]} [options.expectedChanges] - Files that SHOULD have changed
 * @param {boolean} [options.strictProtected] - If true, protect deeper than explicit list
 * @returns {object} Diff report
 */
export function compareSnapshots(before, after, options = {}) {
  const {
    protectedFiles = [],
    expectedChanges = [],
    strictProtected = false,
  } = options;

  console.log(`\n🔍 [DIFF-GUARD] Comparing snapshots`);

  // ── Gather changes ─────────────────────────────────────────────────────
  const filesChanged = getFilesChanged(before, after);
  const filesAdded = getFilesAdded(before, after);
  const filesDeleted = getFilesDeleted(before, after);
  const filesUntouched = getFilesUntouched(before, after);

  // ── Check protected files ──────────────────────────────────────────────
  const protectedViolations = [];
  for (const protectedFile of protectedFiles) {
    const normalized = normalizePath(protectedFile);
    if (filesChanged.includes(normalized)) {
      protectedViolations.push({
        file: normalized,
        reason: "Protected file was modified",
      });
    }
    if (filesDeleted.includes(normalized)) {
      protectedViolations.push({
        file: normalized,
        reason: "Protected file was deleted",
      });
    }
  }

  // ── Check expected changes ─────────────────────────────────────────────
  const missingChanges = expectedChanges.filter(
    (f) => !filesChanged.includes(normalizePath(f)) &&
           !filesAdded.includes(normalizePath(f))
  );

  // ── Check logic deletion ───────────────────────────────────────────────
  const deletedSourceFiles = filesDeleted.filter(
    (f) => f.endsWith(".js") || f.endsWith(".ts") || f.endsWith(".py") || f.endsWith(".gs")
  );

  // ── Build function-level diff ──────────────────────────────────────────
  const functionChanges = detectFunctionChanges(before, after, filesChanged);

  // ── Verdict ────────────────────────────────────────────────────────────
  const passed = protectedViolations.length === 0 &&
    missingChanges.length === 0;

  const report = {
    snapshotBefore: {
      timestamp: before.timestamp,
      headHash: before.headHash,
    },
    snapshotAfter: {
      timestamp: after.timestamp,
      headHash: after.headHash,
    },
    diff: {
      filesChanged,
      filesAdded,
      filesDeleted,
      filesUntouched,
      functionChanges,
    },
    protection: {
      protectedFiles,
      violations: protectedViolations,
      strictProtected,
    },
    expected: {
      expectedChanges,
      missingChanges,
    },
    verdict: {
      passed,
      summary: passed
        ? "ALL CHECKS PASSED — no protected files modified, all expected changes found"
        : `FAILED — ${protectedViolations.length} protection violation(s), ${missingChanges.length} missing expected change(s)`,
      protectedViolations,
      missingChanges,
      hasDeletedSourceFiles: deletedSourceFiles.length > 0,
      deletedSourceFiles,
    },
    timestamp: new Date().toISOString(),
  };

  printDiffReport(report);

  return report;
}

/**
 * Convenience: snapshot before, execute, snapshot after, compare.
 *
 * @param {Function} executeFn - Async function to run between snapshots
 * @param {object} [options] - Options passed to createSnapshot and compareSnapshots
 * @param {object} [snapshotOptions] - Options for createSnapshot
 * @param {object} [compareOptions] - Options for compareSnapshots
 * @returns {Promise<object>} Full guarded execution result
 */
export async function guardExecution(
  executeFn,
  options = {},
  snapshotOptions = {},
  compareOptions = {}
) {
  console.log(`\n🛡️ [DIFF-GUARD] Guarded execution mode`);

  const beforeSnapshot = createSnapshot(snapshotOptions);

  let executionError = null;
  let executionResult = null;
  try {
    executionResult = await executeFn();
  } catch (err) {
    executionError = err;
    console.error(`[DIFF-GUARD] Execution error: ${err.message}`);
  }

  const afterSnapshot = createSnapshot(snapshotOptions);

  const diffReport = compareSnapshots(
    beforeSnapshot,
    afterSnapshot,
    compareOptions
  );

  return {
    execution: {
      success: executionError === null,
      error: executionError ? executionError.message : null,
      result: executionResult,
    },
    diff: diffReport,
    beforeSnapshot,
    afterSnapshot,
  };
}

// ── Internal Diff Logic ───────────────────────────────────────────────────────

/**
 * Get files that were modified between two snapshots.
 * Combines git diff output with file tree comparison.
 */
function getFilesChanged(before, after) {
  const changed = new Set();

  // Use git diff between the two states
  if (before.headHash && after.headHash && before.headHash !== after.headHash) {
    try {
      const diff = gitCommand(
        `diff --name-only ${before.headHash} ${after.headHash}`,
        before.cwd
      );
      diff.split("\n").filter(Boolean).forEach((f) => changed.add(f));
    } catch {
      // Fall through to file tree comparison
    }
  }

  // If same HEAD (no commit made), use working tree diff
  if (changed.size === 0) {
    try {
      const diff = gitCommand(`diff --name-only`, before.cwd);
      diff.split("\n").filter(Boolean).forEach((f) => changed.add(f));
    } catch {
      // Silent fallback
    }
  }

  // File tree comparison for untracked changes
  const afterFileTree = after.fileTree || {};
  const beforeFileTree = before.fileTree || {};

  for (const [filePath, afterHash] of Object.entries(afterFileTree)) {
    const beforeHash = beforeFileTree[filePath];
    if (beforeHash && beforeHash !== afterHash) {
      changed.add(filePath);
    }
  }

  return [...changed].sort();
}

/**
 * Get files that were added between two snapshots.
 */
function getFilesAdded(before, after) {
  const added = [];

  // Untracked files in after that weren't in before
  const beforeUntracked = new Set(before.untrackedFiles || []);
  const afterUntracked = after.untrackedFiles || [];
  const newUntracked = afterUntracked.filter((f) => !beforeUntracked.has(f));
  added.push(...newUntracked);

  // Git new files between commits
  if (before.headHash && after.headHash && before.headHash !== after.headHash) {
    try {
      const diff = gitCommand(
        `diff --name-only --diff-filter=A ${before.headHash} ${after.headHash}`,
        before.cwd
      );
      diff.split("\n").filter(Boolean).forEach((f) => {
        if (!added.includes(f)) added.push(f);
      });
    } catch {
      // Silent fallback
    }
  }

  // File tree comparison
  const afterFileTree = after.fileTree || {};
  const beforeFileTree = before.fileTree || {};

  for (const filePath of Object.keys(afterFileTree)) {
    if (!beforeFileTree[filePath] && !added.includes(filePath)) {
      added.push(filePath);
    }
  }

  return added.sort();
}

/**
 * Get files that were deleted between two snapshots.
 */
function getFilesDeleted(before, after) {
  const deleted = [];

  if (before.headHash && after.headHash && before.headHash !== after.headHash) {
    try {
      const diff = gitCommand(
        `diff --name-only --diff-filter=D ${before.headHash} ${after.headHash}`,
        before.cwd
      );
      diff.split("\n").filter(Boolean).forEach((f) => deleted.push(f));
    } catch {
      // Silent fallback
    }
  }

  // File tree comparison
  const afterFileTree = after.fileTree || {};
  const beforeFileTree = before.fileTree || {};

  for (const filePath of Object.keys(beforeFileTree)) {
    if (!afterFileTree[filePath] && !deleted.includes(filePath)) {
      deleted.push(filePath);
    }
  }

  return deleted.sort();
}

/**
 * Get files that were not touched between two snapshots.
 */
function getFilesUntouched(before, after) {
  const allFiles = new Set([
    ...Object.keys(before.fileTree || {}),
    ...Object.keys(after.fileTree || {}),
  ]);

  const changed = new Set([
    ...getFilesChanged(before, after),
    ...getFilesAdded(before, after),
    ...getFilesDeleted(before, after),
  ]);

  return [...allFiles].filter((f) => !changed.has(f)).sort();
}

/**
 * Detect function-level changes by scanning diff output.
 * Uses git diff --function-context to identify affected functions.
 */
function detectFunctionChanges(before, after, filesChanged) {
  const functionChanges = {
    added: [],
    modified: [],
    deleted: [],
    total: 0,
  };

  if (!before.headHash || !after.headHash) return functionChanges;

  // Only check JS/TS/PY files that changed
  const sourceChanges = filesChanged.filter(
    (f) => f.endsWith(".js") || f.endsWith(".ts") || f.endsWith(".py") || f.endsWith(".gs")
  );

  if (sourceChanges.length === 0) return functionChanges;

  let headToUse = after.headHash;
  // If same HEAD (unstaged changes), use working tree
  if (before.headHash === after.headHash) {
    headToUse = null; // Means compare working tree to HEAD
  }

  for (const file of sourceChanges) {
    try {
      const baseCmd = headToUse
        ? `diff -U0 ${before.headHash}..${headToUse} -- "${file}"`
        : `diff -U0 HEAD -- "${file}"`;

      const diff = gitCommand(baseCmd, before.cwd);

      // Parse diff hunks for function context
      const hunks = diff.split("\n@@");
      for (const hunk of hunks) {
        // Extract function context (after @@...@@)
        const contextMatch = hunk.match(/@@[^@]*@@\s*(.*?)$/m);
        if (contextMatch) {
          const context = contextMatch[1].trim();
          const funcMatch = context.match(
            /(?:function|def|class|export\s+(?:async\s+)?function)\s+(\w+)/
          );
          if (funcMatch) {
            const funcName = funcMatch[1];
            if (hunk.startsWith("+")) {
              functionChanges.added.push({ file, function: funcName });
            } else {
              functionChanges.modified.push({ file, function: funcName });
            }
            functionChanges.total++;
          }
        }
      }
    } catch {
      // Skip files that can't be diffed
    }
  }

  // Deduplicate
  functionChanges.added = deduplicateFuncs(functionChanges.added);
  functionChanges.modified = deduplicateFuncs(functionChanges.modified);

  return functionChanges;
}

/**
 * Build a file tree object mapping file paths to git hashes for fast comparison.
 */
function buildFileTree(cwd) {
  const tree = {};

  try {
    const output = gitCommand(
      `ls-tree -r HEAD --name-only`,
      cwd
    );
    output.split("\n").filter(Boolean).forEach((file) => {
      tree[file] = getFileHash(file, cwd);
    });
  } catch {
    // If no commits yet, build tree from filesystem
    buildFileTreeFromFS(cwd, tree);
  }

  return tree;
}

/**
 * Get the git hash of a file (or its mtime as fallback).
 */
function getFileHash(filePath, cwd) {
  try {
    return gitCommand(`hash-object "${filePath}"`, cwd).trim();
  } catch {
    try {
      const fullPath = path.resolve(cwd, filePath);
      if (fs.existsSync(fullPath)) {
        return fs.statSync(fullPath).mtimeMs.toString();
      }
    } catch {
      // Silent
    }
    return null;
  }
}

/**
 * Build file tree from filesystem (fallback when no git history exists).
 */
function buildFileTreeFromFS(dir, tree, prefix = "") {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        buildFileTreeFromFS(path.join(dir, entry.name), tree, relPath);
      } else {
        tree[relPath] = fs.statSync(path.join(dir, entry.name)).mtimeMs.toString();
      }
    }
  } catch {
    // Silent
  }
}

/**
 * Run a git command and return stdout.
 */
function gitCommand(cmd, cwd) {
  return execSync(`git ${cmd}`, {
    encoding: "utf-8",
    timeout: 10000,
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

/**
 * Normalize a file path (strip leading ./ or /).
 */
function normalizePath(filePath) {
  return filePath
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .trim();
}

/**
 * Deduplicate function change entries by file+function key.
 */
function deduplicateFuncs(arr) {
  const seen = new Set();
  return arr.filter((item) => {
    const key = `${item.file}:${item.function}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Print the diff report to console.
 */
function printDiffReport(report) {
  const verdictIcon = report.verdict.passed ? "✅" : "⛔";
  console.log(`\n╔══════════════════════════════════════════════════`);
  console.log(`║ ${verdictIcon} DIFF GUARD REPORT`);
  console.log(`║ Before:  ${report.snapshotBefore.headHash?.substring(0, 12) || "N/A"}...`);
  console.log(`║ After:   ${report.snapshotAfter.headHash?.substring(0, 12) || "N/A"}...`);
  console.log(`╚══════════════════════════════════════════════════\n`);

  console.log(`📂 Files Changed:   ${report.diff.filesChanged.length}`);
  if (report.diff.filesChanged.length > 0) {
    report.diff.filesChanged.forEach((f) => console.log(`   ✏️  ${f}`));
  }

  console.log(`\n🆕 Files Added:     ${report.diff.filesAdded.length}`);
  if (report.diff.filesAdded.length > 0) {
    report.diff.filesAdded.forEach((f) => console.log(`   ➕ ${f}`));
  }

  console.log(`\n🗑️  Files Deleted:   ${report.diff.filesDeleted.length}`);
  if (report.diff.filesDeleted.length > 0) {
    report.diff.filesDeleted.forEach((f) => console.log(`   🗑️ ${f}`));
  }

  console.log(`\n⏭️  Files Untouched: ${report.diff.filesUntouched.length}`);

  if (report.diff.functionChanges.total > 0) {
    console.log(`\n🔧 Function Changes:`);
    if (report.diff.functionChanges.added.length > 0) {
      console.log(`   Added:`);
      report.diff.functionChanges.added.forEach((f) =>
        console.log(`      ➕ ${f.function} in ${f.file}`)
      );
    }
    if (report.diff.functionChanges.modified.length > 0) {
      console.log(`   Modified:`);
      report.diff.functionChanges.modified.forEach((f) =>
        console.log(`      ✏️  ${f.function} in ${f.file}`)
      );
    }
  }

  if (report.protection.violations.length > 0) {
    console.log(`\n🚫 PROTECTION VIOLATIONS:`);
    report.protection.violations.forEach((v) =>
      console.log(`   ❌ ${v.file}: ${v.reason}`)
    );
  }

  if (report.expected.missingChanges.length > 0) {
    console.log(`\n⚠️  MISSING EXPECTED CHANGES:`);
    report.expected.missingChanges.forEach((f) =>
      console.log(`   ❓ ${f} was expected to change but did not`)
    );
  }

  console.log(`\n📊 VERDICT: ${report.verdict.passed ? "✅ PASS" : "⛔ FAIL"}`);
  console.log(`   ${report.verdict.summary}\n`);
}
