import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";
import { askDeepSeek } from "./deepseek.js";
import { evaluateNewsletter } from "./evaluator.js";
import { saveRun } from "./memory.js";

dotenv.config({ path: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".env") });

const ROOT = "/Users/AM/Documents/gahwa-newsletter";
process.chdir(ROOT);

// -----------------------------
// JOB DEFINITIONS
// -----------------------------
const JOBS = {
  "daily-newsletter": "Generate today's GCC Morning Brief newsletter in structured JSON format and publish it.",
  "test-run": "Run a minimal test newsletter pipeline.",
};

// -----------------------------
// UTIL: LOGGING
// -----------------------------
function log(msg) {
  console.log(`\n${msg}`);
}

// -----------------------------
// EXECUTE GIT SAFE
// -----------------------------
function runGit(command) {
  try {
    execSync(command, { stdio: "inherit" });
    return true;
  } catch (err) {
    console.log(`❌ [GIT ERROR] ${err.message}`);
    return false;
  }
}

// -----------------------------
// SAFE PATH CHECK
// -----------------------------
function isPathSafe(targetPath) {
  const resolved = path.resolve(ROOT, targetPath);

  // Block any path traversal attempts
  if (targetPath.includes("..")) {
    console.log(`❌ [BLOCKED PATH] Path traversal detected: ${targetPath}`);
    return false;
  }

  // Ensure path is inside project directory
  if (!resolved.startsWith(ROOT)) {
    console.log(`❌ [BLOCKED PATH] Path outside project root: ${targetPath}`);
    return false;
  }

  return true;
}

// -----------------------------
// PARSE DOCS INSTRUCTION
// -----------------------------
// Expected format:
//   FILE: <relative-path>
//   ---
//   <file-content>
// Returns { path: string, content: string } or null on failure.
function parseDocsInstruction(instruction) {
  if (!instruction || typeof instruction !== "string") {
    console.log("❌ [PARSE ERROR] Instruction is missing or not a string");
    return null;
  }

  const lines = instruction.split("\n");
  const fileLine = lines.find((line) => line.startsWith("FILE:"));

  if (!fileLine) {
    console.log(`❌ [PARSE ERROR] No "FILE:" line found in instruction`);
    console.log(`  Raw instruction (first 200 chars): ${instruction.slice(0, 200)}`);
    return null;
  }

  const filePath = fileLine.replace(/^FILE:\s*/, "").trim();
  if (!filePath) {
    console.log(`❌ [PARSE ERROR] Empty file path after "FILE:"`);
    return null;
  }

  // Find where content starts (after "---" separator following FILE: line)
  const fileLineIndex = lines.indexOf(fileLine);
  const separatorIndex = lines.findIndex((line, i) => i > fileLineIndex && line.trim() === "---");
  if (separatorIndex === -1) {
    console.log(`❌ [PARSE ERROR] No "---" separator found after FILE: line`);
    return null;
  }

  const contentLines = lines.slice(separatorIndex + 1);
  const content = contentLines.join("\n");

  if (!content.trim()) {
    console.log(`⚠️ [PARSE WARNING] Empty content for file: ${filePath}`);
  }

  return { path: filePath, content };
}

// -----------------------------
// EXECUTE FILE OPS
// -----------------------------
function writeFile(filePath, content) {
  try {
    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`[FILE CREATED] ${filePath}`);
    return true;
  } catch (err) {
    console.log(`❌ [FILE ERROR] ${err.message}`);
    return false;
  }
}

// -----------------------------
// DEEPSEEK PLAN GENERATION
// -----------------------------
async function generatePlan(task) {
  return await askDeepSeek(`
You are an execution planner for an AI newsletter system.

Return ONLY JSON:
{
  "steps": [
    { "type": "fs", "action": "write", "path": "", "content": "" },
    { "type": "git", "action": "commit", "message": "" }
  ]
}

TASK:
${task}
`);
}

// -----------------------------
// EXECUTE PLAN
// -----------------------------
async function executePlan(plan) {
  let success = 0;
  let failed = 0;

  for (const step of plan.steps) {
    try {
      // ── Handle "docs" action ──────────────────────────────
      // DeepSeek system prompt outputs: { action: "docs", instruction: "FILE: path\n---\ncontent" }
      if (step.action === "docs" || step.action === "fs") {
        const parsed = parseDocsInstruction(step.instruction);

        if (!parsed) {
          console.log(`❌ [STEP FAILED] Failed to parse instruction for ${step.action} step`);
          failed++;
          continue;
        }

        if (!isPathSafe(parsed.path)) {
          failed++;
          continue;
        }

        // Resolve relative path against ROOT
        const absolutePath = path.resolve(ROOT, parsed.path);
        writeFile(absolutePath, parsed.content);
        console.log(`✅ [STEP SUCCESS] ${step.action} — ${parsed.path}`);
        success++;
        continue;
      }

      // ── Handle legacy "fs" type (type-based format) ───────
      if (step.type === "fs") {
        if (step.path) {
          if (!isPathSafe(step.path)) {
            failed++;
            continue;
          }
          const absolutePath = path.resolve(ROOT, step.path);
          writeFile(absolutePath, step.content);
          console.log(`✅ [STEP SUCCESS] fs — ${step.path}`);
          success++;
        } else if (step.instruction) {
          // Some fs steps may use instruction format like: CREATE: path\n---\ncontent
          const parsed = parseDocsInstruction(step.instruction);
          if (!parsed) {
            console.log(`❌ [STEP FAILED] Failed to parse instruction for fs step`);
            failed++;
            continue;
          }
          if (!isPathSafe(parsed.path)) {
            failed++;
            continue;
          }
          const absolutePath = path.resolve(ROOT, parsed.path);
          writeFile(absolutePath, parsed.content);
          console.log(`✅ [STEP SUCCESS] fs — ${parsed.path}`);
          success++;
        } else {
          console.log(`❌ [STEP FAILED] fs step missing both 'path' and 'instruction'`);
          failed++;
        }
        continue;
      }

      // ── Handle "git" action or type ──────────────────────
      if (step.type === "git" || step.action === "git") {
        const commitMsg = step.message || step.instruction || "auto-update";
        runGit("git add .");
        runGit(`git commit -m "${commitMsg}"`);
        runGit("git push origin main");
        console.log(`✅ [STEP SUCCESS] git — "${commitMsg}"`);
        success++;
        continue;
      }

      // ── Unknown step type ─────────────────────────────────
      console.log(`⚠️ [UNKNOWN STEP] type="${step.type}" action="${step.action}" — skipping`);
      failed++;

    } catch (err) {
      console.log(`❌ [STEP FAILED] ${err.message}`);
      failed++;
    }
  }

  return { success, failed };
}

// -----------------------------
// MAIN ROUTER
// -----------------------------
async function run() {
  const jobName = process.argv[2] || "daily-newsletter";

  const task = JOBS[jobName];

  if (!task) {
    console.log(`❌ Unknown job: ${jobName}`);
    return;
  }

  console.log("\n==================================================");
  console.log("🚀 OPERATOR STARTED");
  console.log("JOB:", jobName);
  console.log("==================================================");

  console.log("\n⏳ Generating plan from DeepSeek...");

  const plan = await generatePlan(task);

  if (!plan || !plan.steps) {
    console.log("❌ PLAN GENERATION FAILED");
    return;
  }

  console.log("\n[PLAN RECEIVED]");
  console.log(JSON.stringify(plan, null, 2));

  const result = await executePlan(plan);

  console.log("\n==================================================");
  console.log("📊 EXECUTION SUMMARY");
  console.log("SUCCESS:", result.success);
  console.log("FAILED:", result.failed);
  console.log("==================================================");

  // ── v3 Self-Improving Feedback Loop ─────────────────────────
  try {
    const newsletterPath = path.join(ROOT, "output", "latest-newsletter.json");
    if (fs.existsSync(newsletterPath)) {
      const rawNewsletter = fs.readFileSync(newsletterPath, "utf-8");
      const newsletterJson = JSON.parse(rawNewsletter);

      console.log("\n📊 EVALUATING NEWSLETTER QUALITY...");
      const scores = await evaluateNewsletter(newsletterJson);

      let latestGitCommit = "unknown";
      try {
        latestGitCommit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
      } catch { /* git may not be available */ }

      saveRun({
        date: new Date().toISOString(),
        job: jobName,
        scores,
        issues: scores.issues || [],
        commit: latestGitCommit,
      });

      console.log("📊 FEEDBACK LOOP COMPLETE");
    } else {
      console.log("\n📊 No newsletter output file found — skipping evaluation");
    }
  } catch (err) {
    console.log(`📊 Feedback loop error (non-fatal): ${err.message}`);
  }
  // ── End v3 Feedback Loop ────────────────────────────────────

  if (result.failed === 0) {
    console.log("🎉 PIPELINE COMPLETE");
  } else {
    console.log("⚠️ PIPELINE COMPLETED WITH ERRORS");
  }
}

run();
