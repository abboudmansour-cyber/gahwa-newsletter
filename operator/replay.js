#!/usr/bin/env node

/**
 * replay.js — Simple Replay Script
 *
 * Re-executes a past run by runId.
 *
 * Usage:
 *   node replay.js <runId>                # Re-execute operator.js for this run
 *   node replay.js <runId> --no-deepseek  # Skip DeepSeek, just re-run operator
 *
 * This loads logs/runs.json, finds the run, and spawns operator.js.
 *
 * @module replay
 */

import { ensureExecutionContext } from "./core/runtime.js";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { getRun } from "./core/logger.js";

// ── Bootstrap execution context (MUST be called before ANY other logic) ─────
ensureExecutionContext();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPERATOR_JS = path.join(__dirname, "operator.js");
const ROOT = path.resolve(__dirname, "..");

function printUsage() {
  console.log(`
Usage:
  node replay.js <runId>                Re-execute a past run
  node replay.js <runId> --no-deepseek  Re-execute without DeepSeek regeneration

Examples:
  node replay.js 2026-05-07-8f3k2
  node replay.js 2026-05-07-8f3k2 --no-deepseek

To find runIds, check: cat logs/runs.json | jq '.[].runId'
`);
}

async function main() {
  const args = process.argv.slice(2);
  const runId = args[0];
  const noDeepseek = args.includes("--no-deepseek");

  if (!runId || runId.startsWith("--")) {
    printUsage();
    process.exit(1);
  }

  // Load run metadata from runs.json
  const run = getRun(runId);
  if (!run) {
    console.error(`❌ Run "${runId}" not found in logs/runs.json`);
    console.error("   Use: cat operator/logs/runs.json | jq '.[].runId'");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════");
  console.log("🔄 REPLAY MODE");
  console.log("   Run ID:   ", run.runId);
  console.log("   Job:      ", run.job);
  console.log("   Status:   ", run.status);
  console.log("   Timestamp:", run.timestamp);
  if (run.error) console.log("   Error:    ", run.error);
  console.log("   Re-execute operator.js:", noDeepseek ? "YES (skip DeepSeek)" : "YES (full)");
  console.log("═══════════════════════════════════════════════\n");

  // Execute operator.js as a child process
  const childArgs = [OPERATOR_JS, run.job || "daily-newsletter"];
  if (noDeepseek) childArgs.push("--no-deepseek");

  const child = spawn("node", childArgs, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, RUN_ID: `replay-${run.runId}` },
    shell: false,
  });

  child.on("error", (err) => {
    console.error(`❌ Failed to spawn operator.js: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (code === 0) {
      console.log("\n✅ Replay completed successfully");
      process.exit(0);
    } else if (signal) {
      console.error(`\n❌ Replay killed with signal ${signal}`);
      process.exit(1);
    } else {
      console.error(`\n❌ Replay failed with exit code ${code}`);
      process.exit(code);
    }
  });
}

main().catch((err) => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
