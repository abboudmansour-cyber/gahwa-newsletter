import { askDeepSeek } from "./deepseek.js";
import { runGit } from "./github.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULE_FILE = path.join(__dirname, "schedule.json");

// ── Ensure all git commands execute in the repository root ─────
process.chdir("/Users/AM/Documents/gahwa-newsletter");

// ── CLI flag parsing ────────────────────────────────────────────
const args = process.argv.slice(2);
const task = args.find((a) => !a.startsWith("--")) || "";
const isDryRun = args.includes("--dry-run");
const isSchedule = args.includes("--schedule");

// ── CRITICAL FILE PATTERNS (blocklist for safety) ──────────────
const BLOCKED_PATH_PATTERNS = ["../", "~", "/etc", "/system"];
const CRITICAL_FILES = [
  "package.json",
  ".env",
  ".git/config",
  path.join(__dirname, "schedule.json"),
  path.join(__dirname, "operator.js"),
  path.join(__dirname, "deepseek.js"),
  path.join(__dirname, "github.js"),
];

// ── VALIDATION LAYER ────────────────────────────────────────────

/**
 * Validate a file path against safety rules.
 * Returns { valid: boolean, reason?: string }
 */
function validatePath(filePath) {
  const absPath = path.resolve(filePath);

  // Check for blocked patterns
  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (absPath.includes(pattern)) {
      return {
        valid: false,
        reason: `Path contains blocked pattern "${pattern}"`,
      };
    }
  }

  // Check for critical files
  for (const critical of CRITICAL_FILES) {
    const resolvedCritical = path.resolve(critical);
    if (absPath === resolvedCritical) {
      return {
        valid: false,
        reason: `Blocked: overwriting critical file "${critical}"`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a single step before execution.
 * Returns { valid: boolean, reason?: string }
 */
function validateStep(step) {
  const instruction = step.instruction || "";
  const lines = instruction.split("\n");

  // Extract file path from fs/docs steps
  let targetPath = null;

  if (step.action === "docs" || step.action === "fs") {
    const createLine = lines.find((l) => l.trim().startsWith("CREATE:"));
    const patchLine = lines.find((l) => l.trim().startsWith("PATCH:"));
    const appendLine = lines.find((l) => l.trim().startsWith("APPEND:"));
    const deleteLine = lines.find((l) => l.trim().startsWith("DELETE:"));
    const fileLine = lines.find((l) => l.trim().startsWith("FILE:"));

    targetPath =
      (createLine && createLine.replace("CREATE:", "").trim()) ||
      (patchLine && patchLine.replace("PATCH:", "").trim()) ||
      (appendLine && appendLine.replace("APPEND:", "").trim()) ||
      (deleteLine && deleteLine.replace("DELETE:", "").trim()) ||
      (fileLine && fileLine.replace("FILE:", "").trim());

    // Block DELETE unless explicitly confirmed safe
    if (deleteLine) {
      return {
        valid: false,
        reason: "DELETE actions are blocked by safety policy",
      };
    }
  }

  if (targetPath) {
    return validatePath(targetPath);
  }

  return { valid: true };
}

// ── ACTION EXECUTORS ────────────────────────────────────────────

function runDocs(instruction) {
  const lines = instruction.split("\n");
  const fileLine = lines.find((l) => l.trim().startsWith("FILE:"));
  if (!fileLine) {
    console.warn("  ⚠️  docs step missing FILE: line — skipping");
    return;
  }
  const filePath = fileLine.replace("FILE:", "").trim();
  const contentStart = instruction.indexOf("---");
  const content =
    contentStart !== -1
      ? instruction.slice(contentStart + 3).trim()
      : instruction;

  const absPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
  console.log("[FILE MODIFIED]");
}

function runFs(instruction) {
  const lines = instruction.split("\n");
  const createLine = lines.find((l) => l.trim().startsWith("CREATE:"));
  const patchLine = lines.find((l) => l.trim().startsWith("PATCH:"));
  const deleteLine = lines.find((l) => l.trim().startsWith("DELETE:"));
  const appendLine = lines.find((l) => l.trim().startsWith("APPEND:"));

  let targetPath = null;
  let op = null;

  if (createLine) {
    op = "create";
    targetPath = createLine.replace("CREATE:", "").trim();
  } else if (patchLine) {
    op = "patch";
    targetPath = patchLine.replace("PATCH:", "").trim();
  } else if (appendLine) {
    op = "append";
    targetPath = appendLine.replace("APPEND:", "").trim();
  } else if (deleteLine) {
    op = "delete";
    targetPath = deleteLine.replace("DELETE:", "").trim();
  }

  if (!targetPath) {
    const fileLine = lines.find((l) => l.trim().startsWith("FILE:"));
    if (fileLine) {
      const fp = fileLine.replace("FILE:", "").trim();
      const contentStart = instruction.indexOf("---");
      const content =
        contentStart !== -1
          ? instruction.slice(contentStart + 3).trim()
          : instruction;
      const absPath = path.resolve(fp);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, "utf-8");
      console.log("[FILE MODIFIED]");
      return;
    }
    console.warn(
      "  ⚠️  fs step missing CREATE:/PATCH:/DELETE:/APPEND: or FILE: line — skipping"
    );
    return;
  }

  const absPath = path.resolve(targetPath);
  const contentStart = instruction.indexOf("---");

  switch (op) {
    case "create": {
      const content =
        contentStart !== -1
          ? instruction.slice(contentStart + 3).trim()
          : "";
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, "utf-8");
      console.log("[FILE MODIFIED]");
      break;
    }
    case "patch": {
      if (!fs.existsSync(absPath)) {
        console.warn(`  ⚠️  File not found for PATCH: ${absPath}`);
        return;
      }
      const content =
        contentStart !== -1
          ? instruction.slice(contentStart + 3).trim()
          : "";
      fs.writeFileSync(absPath, content, "utf-8");
      console.log("[FILE MODIFIED]");
      break;
    }
    case "append": {
      const content =
        contentStart !== -1
          ? instruction.slice(contentStart + 3).trim()
          : "";
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.appendFileSync(absPath, "\n" + content, "utf-8");
      console.log("[FILE MODIFIED]");
      break;
    }
    case "delete": {
      // DELETE is blocked by validation — should never reach here
      console.warn(`  ⚠️  DELETE blocked by safety policy: ${absPath}`);
      break;
    }
  }
}

// ── MAIN RUNNER ─────────────────────────────────────────────────

async function run() {
  // ── SCHEDULE MODE: write to schedule.json, do not execute ──
  if (isSchedule) {
    const jobs = [];
    if (fs.existsSync(SCHEDULE_FILE)) {
      try {
        const existing = JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf-8"));
        if (Array.isArray(existing)) jobs.push(...existing);
      } catch {
        // start fresh
      }
    }
    jobs.push({
      task,
      timestamp: new Date().toISOString(),
      status: "pending",
    });
    fs.mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true });
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(jobs, null, 2), "utf-8");
    console.log(`\n📅 [SCHEDULED]`);
    console.log(`  Task:  ${task}`);
    console.log(`  File:  ${SCHEDULE_FILE}`);
    console.log(`  Jobs:  ${jobs.length} total`);
    return;
  }

  console.log("\n" + "=".repeat(60));
  console.log("🚀 TASK:", task);
  if (isDryRun) console.log("[DRY RUN MODE - NO CHANGES MADE]");
  console.log("=".repeat(60));

  // ── 1. Generate plan ──────────────────────────────────────────
  console.log("\n⏳ Generating plan from DeepSeek...");
  const plan = await askDeepSeek(task);
  console.log("\n[PLAN RECEIVED]");
  console.log(`  Goal:    ${plan.goal || "(not set)"}`);
  console.log(`  Steps:   ${plan.steps?.length || 0}`);
  plan.steps?.forEach((s, i) => {
    const instr = (s.instruction || "").slice(0, 80);
    console.log(
      `    ${i + 1}. [${s.action}] ${instr}${(s.instruction || "").length > 80 ? "…" : ""}`
    );
  });
  console.log("─".repeat(60));

  // ── 2. Validate & execute all steps ─────────────────────────
  let blockedCount = 0;
  let successCount = 0;
  let failCount = 0;

  for (const step of plan.steps || []) {
    console.log(`\n▶️  STEP: [${step.action}]`);

    // Safety validation
    const validation = validateStep(step);
    if (!validation.valid) {
      console.error(`  ❌ [STEP FAILED - SAFETY RULE VIOLATION]`);
      console.error(`  Reason: ${validation.reason}`);
      blockedCount++;
      continue; // skip this step but continue pipeline
    }

    const executed = await executeStep(step);
    if (executed === true) {
      successCount++;
      console.log("[STEP SUCCESS]");
    } else if (executed === false) {
      failCount++;
      // error already logged by executeStep
    }
    // executed === null means dry-run or skipped — no count

    // Continue execution — do NOT stop the pipeline
  }

  // ── 3. Summary ────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  if (isDryRun) {
    console.log("[DRY RUN COMPLETE - NO CHANGES MADE]");
  } else {
    console.log("[COMPLETE]");
  }
  console.log(`  ✅ Success:      ${successCount}`);
  console.log(`  ❌ Failed:       ${failCount}`);
  if (blockedCount > 0) {
    console.log(`  ⛔ Blocked:      ${blockedCount} step(s) rejected by safety policy`);
  }
  console.log("=".repeat(60));
}

/**
 * Execute a single validated step.
 *
 * Returns:
 *   true  — step completed successfully
 *   false — step failed (error caught and logged)
 *   null  — step was skipped (dry-run or unknown action)
 */
async function executeStep(step) {
  if (isDryRun) {
    console.log("  ⏭️  (skipped - dry run)");
    return null;
  }

  try {
    switch (step.action) {
      case "git": {
        console.log(`  🔧 git: "${step.instruction}"`);
        runGit(step.instruction);
        console.log("[GIT PUSHED]");
        return true;
      }

      case "docs": {
        console.log(`  📝 Writing file...`);
        runDocs(step.instruction);
        return true;
      }

      case "fs": {
        console.log(`  📂 File system operation...`);
        runFs(step.instruction);
        return true;
      }

      default:
        console.warn(`  ⚠️  Unknown action "${step.action}" — skipping`);
        return null;
    }
  } catch (err) {
    console.error(`  ❌ [STEP FAILED - GIT ERROR]`);
    console.error(`  ${err.message}`);
    return false;
  }
}

run().catch((err) => {
  console.error("\n❌ FATAL:", err.message);
  process.exit(1);
});
