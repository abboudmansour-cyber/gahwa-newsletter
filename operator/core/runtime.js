/**
 * runtime.js — Deterministic Execution Context Bootstrap
 *
 * SINGLE source of truth for execution context.
 * Forces the process into the project root and verifies the environment
 * before ANY other logic runs. Every entry point MUST call
 * ensureExecutionContext() as its FIRST import+call.
 *
 * This guarantees:
 *   - Working directory is always the project root
 *   - Git operations run from the repo root
 *   - File system writes resolve to known paths
 *   - All entry points (CLI, cron, webhook, scheduler) behave identically
 *
 * @module runtime
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ── SINGLE SOURCE OF TRUTH ──────────────────────────────────────────────
// This is the ONLY place the project root is hardcoded.
// All subsystems derive paths from this constant or use process.cwd()
// after ensureExecutionContext() sets it.
const ROOT = "/Users/AM/Documents/gahwa-newsletter";

// ── REQUIRED PATHS FOR VERIFICATION ──────────────────────────────────────
const REQUIRED_PATHS = [
  { name: ".git",              path: path.join(ROOT, ".git") },
  { name: "operator/",         path: path.join(ROOT, "operator") },
  { name: "operator/package.json", path: path.join(ROOT, "operator", "package.json") },
];

// ── PUBLIC API ───────────────────────────────────────────────────────────

/**
 * Bootstrap the execution context.
 *
 * 1. Forces process.cwd() to the project root
 * 2. Verifies critical project files/directories exist
 * 3. Logs execution trace (root, verification status, git branch)
 * 4. FAILS FAST if context is invalid
 *
 * Must be called at the VERY TOP of every entry point module,
 * before any imports that depend on cwd or any other logic.
 *
 * @throws {never} — calls process.exit(1) on failure
 */
export function ensureExecutionContext() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("🔒 EXECUTION CONTEXT BOOTSTRAP");

  // ── Step 1: Lock process to project root ────────────────────────────
  try {
    process.chdir(ROOT);
  } catch (err) {
    console.error(`❌ FATAL: Cannot change to project root: ${ROOT}`);
    console.error(`   Error: ${err.message}`);
    console.error("   The system MUST run from the Gahwa project directory.");
    process.exit(1);
  }

  // ── Step 2: Verify critical paths ───────────────────────────────────
  const checkResults = REQUIRED_PATHS.map(({ name, path: p }) => {
    const exists = fs.existsSync(p);
    if (!exists) {
      console.error(`   ❌ MISSING: ${name} — ${p}`);
    }
    return { name, exists };
  });

  const allVerified = checkResults.every((c) => c.exists);

  // ── Step 3: Execution trace logging ─────────────────────────────────
  let gitBranch = "unknown";
  try {
    gitBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    // Git may not be available in all contexts
  }

  console.log(`📁 Execution Root: ${process.cwd()}`);
  console.log(`📦 Project Verified: ${allVerified}`);
  console.log(`🌿 Git Branch: ${gitBranch}`);
  console.log("═══════════════════════════════════════════════\n");

  // ── Step 4: Fail fast on invalid context ────────────────────────────
  if (!allVerified) {
    const missingNames = checkResults
      .filter((c) => !c.exists)
      .map((c) => c.name)
      .join(", ");

    console.error("═══════════════════════════════════════════════");
    console.error("❌  INVALID EXECUTION CONTEXT");
    console.error("   The system is NOT running from the Gahwa root.");
    console.error(`   Root: ${ROOT}`);
    console.error(`   Missing: ${missingNames}`);
    console.error("");
    console.error("   Fix: Ensure you run from the project directory.");
    console.error("   Expected: /Users/AM/Documents/gahwa-newsletter");
    console.error("═══════════════════════════════════════════════");
    process.exit(1);
  }
}

// ── UTILITY EXPORTS ─────────────────────────────────────────────────────

/**
 * Get the absolute project root path.
 * Safe to use after ensureExecutionContext() has been called.
 *
 * @returns {string} The absolute path to the project root
 */
export function getRoot() {
  return ROOT;
}

/**
 * Resolve a relative path against the project root.
 * Blocks path traversal attempts.
 *
 * @param {string} relativePath - Path relative to project root
 * @returns {string} Absolute resolved path
 * @throws {Error} If path traversal is detected
 */
export function resolveRoot(relativePath) {
  const resolved = path.resolve(ROOT, relativePath);

  // Block path traversal
  if (relativePath.includes("..") || !resolved.startsWith(ROOT)) {
    throw new Error(`❌ Path traversal blocked: ${relativePath}`);
  }

  return resolved;
}
