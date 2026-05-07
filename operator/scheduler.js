#!/usr/bin/env node

/**
 * scheduler.js — Scheduled job runner for the autonomous execution engine.
 *
 * Reads pending jobs from schedule.json, executes them via operator.js,
 * and marks them as completed. Prevents duplicate runs by locking
 * completed/failed statuses.
 *
 * Usage:
 *   node scheduler.js
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULE_FILE = path.join(__dirname, "schedule.json");
const LOCK_FILE = path.join(__dirname, ".scheduler.lock");

async function run() {
  console.log("=".repeat(60));
  console.log("📅 SCHEDULER RUNNER");
  console.log(new Date().toISOString());
  console.log("=".repeat(60));

  // ── Check lock file to prevent concurrent runs ──────────────
  if (fs.existsSync(LOCK_FILE)) {
    const lockAge = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (lockAge < 300_000) {
      // 5 minute cooldown
      const remaining = Math.round((300_000 - lockAge) / 1000);
      console.log(`  ⏳ Scheduler already ran recently (${remaining}s cooldown remaining). Exiting.`);
      return;
    } else {
      console.log("  ⚠️  Stale lock file found — removing.");
      fs.unlinkSync(LOCK_FILE);
    }
  }

  // ── Read schedule ───────────────────────────────────────────
  if (!fs.existsSync(SCHEDULE_FILE)) {
    console.log("  ℹ️  No schedule.json found. Nothing to do.");
    return;
  }

  let jobs;
  try {
    jobs = JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf-8"));
  } catch (err) {
    console.error(`  ❌ Failed to parse schedule.json: ${err.message}`);
    return;
  }

  if (!Array.isArray(jobs)) {
    console.error("  ❌ schedule.json is not an array.");
    return;
  }

  const pending = jobs.filter((j) => j.status === "pending");
  if (pending.length === 0) {
    console.log("  ℹ️  No pending jobs found.");
    return;
  }

  // ── Create lock ─────────────────────────────────────────────
  fs.writeFileSync(LOCK_FILE, new Date().toISOString(), "utf-8");

  // ── Execute pending jobs ────────────────────────────────────
  console.log(`\n  Found ${pending.length} pending job(s). Executing...\n`);

  for (const job of pending) {
    console.log(`▶️  Job: "${job.task}" (queued: ${job.timestamp})`);

    try {
      // Execute operator.js with the job's task
      const result = execSync(
        `node ${path.join(__dirname, "operator.js")} "${job.task}"`,
        {
          cwd: __dirname,
          stdio: "inherit",
          env: { ...process.env },
        }
      );

      job.status = "completed";
      job.executedAt = new Date().toISOString();
      console.log(`  ✅ [JOB COMPLETED]`);
    } catch (err) {
      job.status = "failed";
      job.executedAt = new Date().toISOString();
      job.error = err.message;
      console.error(`  ❌ [JOB FAILED] ${err.message}`);
      // Continue with remaining jobs
    }

    // Write updated schedule back after each job
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(jobs, null, 2), "utf-8");
  }

  // ── Cleanup lock ────────────────────────────────────────────
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }

  // ── Summary ─────────────────────────────────────────────────
  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  console.log("\n" + "=".repeat(60));
  console.log("[SCHEDULER COMPLETE]");
  console.log(`  Completed: ${completed}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Pending:   ${jobs.filter((j) => j.status === "pending").length}`);
  console.log("=".repeat(60));
}

run().catch((err) => {
  console.error("\n❌ SCHEDULER FATAL:", err.message);
  process.exit(1);
});
