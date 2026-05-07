import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { askDeepSeek, callDeepSeekForContent } from "./deepseek.js";
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
// JOB DEFINITIONS — lightweight, no embedded content
// -----------------------------
const JOBS = {
  "daily-newsletter": `
Generate a plan to:
1. Generate and save today's GCC Morning Brief newsletter to output/latest-newsletter.json
2. Commit and push all changes to GitHub
3. Deliver the newsletter to the Apps Script webhook

TODAY'S DATE: ${CURRENT_DATE}
The newsletter date field MUST be "${CURRENT_DATE}".
Use commit message: "daily newsletter ${CURRENT_DATE}"
`,
  "test-run": `Run a minimal test: generate a short GCC Morning Brief and save it to output/latest-newsletter.json.`,
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
// NEWSLETTER CONTENT GENERATION
// -----------------------------
/**
 * Generate the full newsletter JSON content by calling DeepSeek
 * as a separate content-generation request (not embedded in plan).
 *
 * This keeps the planning payload lightweight and avoids
 * malformed/truncated JSON from massive instruction blocks.
 */
async function generateNewsletterContent() {
  console.log("\n📝 GENERATING NEWSLETTER CONTENT...");

  const prompt = `Generate today's GCC Morning Brief newsletter.

TODAY'S DATE: ${CURRENT_DATE}

OUTPUT FORMAT — Return ONLY valid JSON following this exact schema:
{
  "date": "${CURRENT_DATE}",
  "title": "GCC Morning Brief",
  "sections": [
    {
      "headline": "[Headline 1 — max 15 words]",
      "summary": "[2-3 sentence summary of this section]",
      "insight": "[1-2 sentence key insight or what this means]"
    }
  ]
}

CONTENT REQUIREMENTS:
- Minimum 5 sections, maximum 8 sections
- Each section must have: headline, summary, and insight
- Cover GCC markets, Saudi economy, UAE business, regional fintech, and energy
- Be data-driven: include specific numbers, percentages, and market data
- Tone: authoritative, direct, professional — suitable for GCC executives

EXAMPLE SECTION:
{
  "headline": "Saudi non-oil GDP grows 4.5% in Q1",
  "summary": "Saudi Arabia's non-oil GDP expanded 4.5% year-on-year in Q1 2026, driven by tourism, logistics, and manufacturing as Vision 2030 diversification gains momentum.",
  "insight": "The continued strength in non-oil sectors signals resilience against global oil price volatility and reinforces investor confidence in the Kingdom's economic transformation."
}

Return ONLY valid JSON — no markdown, no code fences, no extra text.`;

  const rawText = await callDeepSeekForContent(prompt, CURRENT_DATE);

  // Extract JSON from response (strip fences, prose, etc.)
  const cleaned = extractJSON(rawText);
  if (!cleaned) {
    throw new Error("Empty response after JSON extraction from content generation");
  }

  const newsletter = JSON.parse(cleaned);

  // Validate required fields
  if (!newsletter.date) newsletter.date = CURRENT_DATE;
  if (!newsletter.title) newsletter.title = "GCC Morning Brief";
  if (!Array.isArray(newsletter.sections) || newsletter.sections.length === 0) {
    throw new Error("Generated newsletter has no sections");
  }

  console.log(`✅ NEWSLETTER GENERATED — ${newsletter.sections.length} sections`);
  return newsletter;
}

/**
 * Extract the first valid JSON object from a response string.
 * Strips:
 *   - markdown code fences (json ... )
 *   - leading prose before the first { or [
 *   - trailing commentary after the last } or ]
 */
function extractJSON(text) {
  if (!text || typeof text !== "string") return "";

  let cleaned = text.trim();

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
  cleaned = cleaned.replace(/\s*```\s*$/i, "");

  // Find the first opening brace or bracket
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  const first =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
        ? firstBrace
        : Math.min(firstBrace, firstBracket);

  if (first === -1) return cleaned;

  // Find the last closing brace or bracket
  const lastBrace = cleaned.lastIndexOf("}");
  const lastBracket = cleaned.lastIndexOf("]");
  const last =
    lastBrace === -1
      ? lastBracket
      : lastBracket === -1
        ? lastBrace
        : Math.max(lastBrace, lastBracket);

  if (last === -1 || last < first) return cleaned;

  return cleaned.slice(first, last + 1);
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
    console.log("⚠ WEBHOOK_SECRET not set — sending without signature verification");
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

  // Mask webhook URL for safe logging
  let maskedUrl = webhookUrl;
  try {
    const parsed = new URL(webhookUrl);
    maskedUrl = `${parsed.protocol}//${parsed.host}/macros/s/***/exec`;
  } catch { /* keep original if parse fails */ }

  console.log(`\n🔗 Pushing newsletter to Apps Script webhook (masked URL)`);
  console.log(`   URL:     ${maskedUrl}`);
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
    `TASK:
${task}`
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
      // ── Handle "generate_newsletter" action ──────────────
      if (step.action === "generate_newsletter") {
        const newsletter = await generateNewsletterContent();

        // Save to output/latest-newsletter.json
        const outputPath = path.resolve(ROOT, "output", "latest-newsletter.json");
        writeFile(outputPath, JSON.stringify(newsletter, null, 2));
        console.log(`✅ [STEP SUCCESS] generate_newsletter — output/latest-newsletter.json`);
        success++;
        continue;
      }

      // ── Handle "git" action ──────────────────────────────
      if (step.action === "git") {
        const commitMsg = step.instruction || "auto-update";
        runGit("git add .");
        runGit(`git commit -m "${commitMsg}"`);
        runGit("git push origin main");
        console.log(`✅ [STEP SUCCESS] git — "${commitMsg}"`);
        success++;
        continue;
      }

      // ── Handle "push" action (Apps Script delivery) ──────
      if (step.action === "push") {
        const payloadPath = step.path || "output/latest-newsletter.json";
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
      console.log(`⚠️ [UNKNOWN STEP] action="${step.action}" — skipping`);
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
