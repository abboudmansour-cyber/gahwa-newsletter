import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { askDeepSeek } from "./deepseek.js";
import { evaluateNewsletter } from "./evaluator.js";
import { saveRun } from "./memory.js";

// ── Dynamic path resolution (works on any server: local, Hetzner, etc.) ─────
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.resolve(__dirname, ".env") });
process.chdir(ROOT);

// ── CURRENT DATE (from system clock — never hardcoded) ──────────────────────
const CURRENT_DATE = new Date().toISOString().slice(0, 10); // "2026-05-07"

// ── Startup Health Check ─────────────────────────────────────────────────────
function validateEnvironment() {
  const required = [
    "DEEPSEEK_API_KEY",
    "APPS_SCRIPT_WEBHOOK_URL",
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error("═══════════════════════════════════════════════════════");
    console.error("❌  ENVIRONMENT VALIDATION FAILED");
    console.error(`   Missing variables: ${missing.join(", ")}`);
    console.error("");
    console.error("   To fix, ensure these are set in operator/.env or");
    console.error("   passed as environment variables (e.g., via GitHub Secrets).");
    console.error("═══════════════════════════════════════════════════════");
    process.exit(1);
  }

  console.log(`✅ Environment validated — all required variables present`);
}

// Run health check immediately at module load
validateEnvironment();

// -----------------------------
// JOB DEFINITIONS
// -----------------------------
const JOBS = {
  "daily-newsletter": `Execute a COMPLETE autonomous pipeline:
TODAY'S DATE: ${CURRENT_DATE}
Your newsletter MUST use this date exactly.

Step 1 — docs: Generate today's GCC Morning Brief newsletter in structured JSON format.
  → Write to FILE: newsletters/gcc-brief-${CURRENT_DATE}.json
  → The "date" field in the JSON MUST be "${CURRENT_DATE}".
Step 2 — git: Commit and push all changes to GitHub with a descriptive message.
Step 3 — push: Trigger the Apps Script delivery webhook to email the newsletter.
A "complete run" MUST include ALL THREE steps (docs, git, push) in the JSON plan. Do not omit any step.`,
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
// PUSH TO APPS SCRIPT (Delivery Bridge)
// -----------------------------
/**
 * POST the latest newsletter JSON to the Apps Script webhook.
 * Reads APPS_SCRIPT_WEBHOOK_URL and WEBHOOK_SECRET from .env.
 * Replicates the logic from scripts/send_to_apps_script.sh natively in JS.
 */
async function pushToAppsScript(filePath = "output/latest-newsletter.json") {
  const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!webhookUrl) {
    console.log("❌ [PUSH FAILED] APPS_SCRIPT_WEBHOOK_URL is not set in .env");
    return false;
  }

  if (!webhookSecret) {
    console.log("❌ [PUSH FAILED] WEBHOOK_SECRET is not set in .env");
    return false;
  }

  const absolutePath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(absolutePath)) {
    console.log(`❌ [PUSH FAILED] Payload file not found: ${absolutePath}`);
    return false;
  }

  // Read and inject auth_token into payload
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
  } catch (err) {
    console.log(`❌ [PUSH FAILED] Invalid JSON in payload: ${err.message}`);
    return false;
  }

  payload.auth_token = webhookSecret;

  console.log(`\n🚀 Pushing newsletter to Apps Script webhook...`);
  console.log(`   Payload: ${absolutePath}`);

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`   ─── Attempt ${attempt} of ${MAX_ATTEMPTS} ───`);

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.text();

      if (res.status === 200) {
        console.log(`   ✅ [SUCCESS] Newsletter delivered to Apps Script.`);
        console.log(`   Response: ${body || "(empty)"}`);

        // Append delivery log
        const logPath = path.join(ROOT, "output", "delivery_log.txt");
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, `\n--- Delivery Report: ${new Date().toISOString()} ---\nHTTP 200 — SUCCESS\n`, "utf-8");

        return true;
      }

      if (res.status === 429) {
        const wait = attempt * 5;
        console.log(`   ⏳ Rate limited. Waiting ${wait}s before retry...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }

      if (res.status === 502 || res.status === 503) {
        const wait = 2 ** attempt * 3;
        console.log(`   ⏳ Service unavailable (${res.status}). Waiting ${wait}s...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        console.log(`   ❌ [AUTH ERROR] Apps Script rejected the request (HTTP ${res.status})`);
        console.log(`   Response: ${body}`);
        console.log(`   Fix: WEBHOOK_SECRET must match in both .env and Apps Script PropertiesService.`);
        break;
      }

      // Other non-200 status
      console.log(`   ⚠️ HTTP ${res.status} — not 200 OK. Response: ${body || "(empty)"}`);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`   ⏳ Waiting 30s before retry...`);
        await new Promise((r) => setTimeout(r, 30_000));
      }
    } catch (err) {
      console.log(`   ⚠️ Network error: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const wait = 2 ** attempt * 2;
        console.log(`   ⏳ Waiting ${wait}s before retry...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
  }

  console.log(`   ❌ [PUSH FAILED] All ${MAX_ATTEMPTS} attempts exhausted.`);
  return false;
}

// -----------------------------
// DEEPSEEK PLAN GENERATION
// -----------------------------
async function generatePlan(task) {
  // Inject CURRENT_DATE as a REQUIRED constant so DeepSeek never hallucinates dates
  return await askDeepSeek(
    CURRENT_DATE,
    `
You are an execution planner for an AI newsletter system.

TODAY'S DATE IS ${CURRENT_DATE}. You MUST use this date for all content.
The "date" field in any newsletter JSON MUST be "${CURRENT_DATE}".

Return ONLY JSON:
{
  "steps": [
    { "type": "fs", "action": "write", "path": "", "content": "" },
    { "type": "git", "action": "commit", "message": "" }
  ]
}

TASK:
${task}
`
  );
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

      // ── Handle "push" action (Apps Script delivery) ──────
      if (step.action === "push") {
        const payloadPath = step.path || step.file || "output/latest-newsletter.json";
        const pushed = await pushToAppsScript(payloadPath);
        if (pushed) {
          console.log(`✅ [STEP SUCCESS] push — ${payloadPath}`);
          success++;
        } else {
          console.log(`❌ [STEP FAILED] push — ${payloadPath}`);
          failed++;
        }
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
  console.log("DATE:", CURRENT_DATE);
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
