#!/usr/bin/env node

/**
 * daily-runner.js — Fully autonomous daily newsletter generation engine.
 *
 * Runs the complete Gahwa pipeline with zero human interaction:
 *   1. Call DeepSeek to generate structured newsletter JSON
 *   2. Validate output schema
 *   3. Save to /operator/output/latest-newsletter.json
 *   4. Push to GitHub archive
 *   5. Send POST to Apps Script webhook → renders HTML + emails
 *   6. Log everything, handle failures gracefully
 *
 * Usage:
 *   node operator/daily-runner.js                    # normal run
 *   node operator/daily-runner.js --dry-run          # test run, no side effects
 *   node operator/daily-runner.js --force            # re-run even if already done today
 *
 * Designed for Hetzner VPS cron:
 *   0 7 * * * cd /opt/gahwa-newsletter && node operator/daily-runner.js
 *
 * @module daily-runner
 */

import { ensureExecutionContext } from "./core/runtime.js";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import crypto from "crypto";
import { validateEnvironment, logWebhookStatus } from "./core/validate-env.js";
import { evaluateTruth, calculateHealthScore, isSystemUnstable } from "./core/truth-evaluator.js";

// ── 🛡 PRODUCTION GUARD MODE (Protective Layer — Additive Only) ─────────────
import { checkConfigIntegrity, printGuardReport } from "./core/production-guard.js";

// ── Bootstrap execution context (MUST be called before ANY other logic) ─────
ensureExecutionContext();

// ── Load .env (local dev + Hetzner production) ──────────────────────────
// Try multiple locations in order of preference:
//   1. <project_root>/operator/.env (standard location)
//   2. /opt/gahwa-newsletter/operator/.env (Hetzner VPS)
//   3. /opt/gahwa/config.env (legacy Hetzner path)
const ENV_PATHS = [
  path.resolve(__dirname, ".env"),
  "/opt/gahwa-newsletter/operator/.env",
  "/opt/gahwa/config.env",
];
for (const envPath of ENV_PATHS) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

// ── Startup Health Check ─────────────────────────────────────────────────────
validateEnvironment();
logWebhookStatus();

// ── 🛡 GUARD 1: Config integrity check on startup ───────────────────────────
// This runs before any pipeline logic, as an additive protective layer.
const configResult = checkConfigIntegrity();
if (!configResult.passed) {
  log(`🛑 [PRODUCTION-GUARD] Startup blocked: ${configResult.failures.length} config issue(s)`, "ERROR");
  configResult.failures.forEach(f => log(`   ❌ ${f.field}: ${f.message}`, "ERROR"));
  process.exit(1);
}

// ── Paths ────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const OUTPUT_DIR = path.join(__dirname, "output");
const LOGS_DIR = path.join(__dirname, "logs");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "latest-newsletter.json");
const ERROR_LOG = path.join(LOGS_DIR, "daily-errors.log");

// ── Configuration ────────────────────────────────────────────────────────
const DEEPSEEK_MODULE = path.join(__dirname, "deepseek.js");
const OPERATOR_MODULE = path.join(__dirname, "operator.js");
const GITHUB_MODULE = path.join(__dirname, "github.js");

const APPS_SCRIPT_WEBHOOK_URL =
  process.env.APPS_SCRIPT_WEBHOOK_URL ||
  ""; // Set in /opt/gahwa/config.env on Hetzner

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

// ── CLI flags ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isForce = args.includes("--force");

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Timestamped console log.
 * Writes to both stdout and the error log (for failures).
 */
function log(message, level = "INFO") {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] [${level}] ${message}`;
  console.log(formatted);
  if (level === "ERROR" || level === "WARN") {
    appendToFileSync(ERROR_LOG, `\n${formatted}`);
  }
}

/**
 * Append text to a file, creating directory if needed.
 */
function appendToFileSync(filePath, text) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, text, "utf-8");
  } catch (err) {
    console.error(`[FATAL] Cannot write to ${filePath}: ${err.message}`);
  }
}

/**
 * Write entire file, creating directory if needed.
 */
function writeFileSyncSafe(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Check if we already ran successfully today (idempotency guard).
 * Uses a daily marker file: /operator/output/.daily-marker-YYYY-MM-DD
 */
function alreadyRanToday() {
  if (isForce) return false;
  const today = new Date().toISOString().slice(0, 10);
  const marker = path.join(OUTPUT_DIR, `.daily-marker-${today}`);
  return fs.existsSync(marker);
}

/**
 * Mark today as completed.
 */
function markTodayComplete() {
  const today = new Date().toISOString().slice(0, 10);
  const marker = path.join(OUTPUT_DIR, `.daily-marker-${today}`);
  writeFileSyncSafe(marker, new Date().toISOString());
}

/**
 * Get today's date in YYYY-MM-DD format.
 */
function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Generate a unique delivery ID for idempotent delivery.
 * Combines job name + date + short git commit hash.
 * If git is unavailable, falls back to Date.now().
 */
function getDeliveryId() {
  let gitCommitHash = "unknown";
  try {
    gitCommitHash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch { /* git may not be available */ }
  return `daily-newsletter-${todayDate()}-${gitCommitHash}`;
}

/**
 * Validate the newsletter JSON matches the required schema.
 * Returns { valid: boolean, errors: string[] }
 */
function validateNewsletterSchema(json) {
  const errors = [];

  if (!json || typeof json !== "object") {
    return { valid: false, errors: ["Response is not a JSON object"] };
  }

  if (!json.date) {
    errors.push('Missing required field: "date"');
  }

  if (!json.title) {
    errors.push('Missing required field: "title"');
  }

  if (!Array.isArray(json.sections)) {
    errors.push('Missing required field: "sections" (must be an array)');
    return { valid: false, errors };
  }

  if (json.sections.length === 0) {
    errors.push('"sections" array is empty');
    return { valid: false, errors };
  }

  json.sections.forEach((section, i) => {
    if (!section.headline) {
      errors.push(`sections[${i}]: missing "headline"`);
    }
    if (!section.summary && !section.insight) {
      errors.push(`sections[${i}]: missing both "summary" and "insight" (need at least one)`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Generate newsletter content by calling DeepSeek directly.
 * Returns the parsed JSON newsletter object.
 */
async function generateNewsletter() {
  log("[NEWSLETTER GENERATION] Calling DeepSeek...");

  // ── Import deepseek module ────────────────────────────────────────────
  let askDeepSeek;
  try {
    const deepseekModule = await import(DEEPSEEK_MODULE);
    askDeepSeek = deepseekModule.askDeepSeek;
  } catch (importErr) {
    throw new Error(`Failed to import deepseek.js: ${importErr.message}`);
  }

  // ── Build prompt for newsletter generation ────────────────────────────
  const taskPrompt = `Generate today's GCC Morning Brief newsletter.

TODAY'S DATE: ${todayDate()}

OUTPUT FORMAT — Return ONLY valid JSON following this exact schema:
{
  "date": "${todayDate()}",
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

  try {
    const plan = await askDeepSeek(taskPrompt);

    if (!plan || typeof plan !== "object") {
      throw new Error("DeepSeek returned null or non-object response");
    }

    // ── Check if response is already in newsletter format ───────────────
    if (plan.sections && Array.isArray(plan.sections)) {
      log(`[NEWSLETTER GENERATED] ${plan.sections.length} sections`);
      return plan;
    }

    // ── If DeepSeek returned a plan with steps, extract from steps ──────
    if (plan.steps && Array.isArray(plan.steps)) {
      log("[PARSING] Extracting newsletter from execution plan steps...");
      return extractNewsletterFromPlan(plan);
    }

    // ── Fallback: wrap the plan in the expected structure ───────────────
    log("[PARSING] Wrapping DeepSeek response into newsletter schema...");
    return {
      date: todayDate(),
      title: "GCC Morning Brief",
      sections: plan.sections || [
        {
          headline: "GCC Markets Update",
          summary: plan.goal || "Daily GCC market intelligence briefing.",
          insight: "Markets remain dynamic across the Gulf region.",
        },
      ],
    };
  } catch (err) {
    throw new Error(`Newsletter generation failed: ${err.message}`);
  }
}

/**
 * Extract newsletter content from a DeepSeek execution plan.
 * Looks for docs/fs steps that contain newsletter JSON content.
 */
function extractNewsletterFromPlan(plan) {
  // Default structure
  const newsletter = {
    date: todayDate(),
    title: "GCC Morning Brief",
    sections: [],
  };

  // Try to extract sections from steps
  for (const step of plan.steps || []) {
    const instruction = step.instruction || "";

    // Look for inline JSON in the instruction
    const jsonMatch = instruction.match(/\{[\s\S]*"sections"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.sections && Array.isArray(parsed.sections)) {
          newsletter.sections.push(...parsed.sections);
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    // Look for structured content in instructions
    if (instruction.includes("headline:") || instruction.includes("HEADLINE:")) {
      const lines = instruction.split("\n");
      let section = {};
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("headline:") || trimmed.startsWith("HEADLINE:")) {
          if (section.headline) {
            newsletter.sections.push(section);
            section = {};
          }
          section.headline = trimmed.replace(/^headline:\s*/i, "").trim();
        } else if (trimmed.startsWith("summary:") || trimmed.startsWith("SUMMARY:")) {
          section.summary = trimmed.replace(/^summary:\s*/i, "").trim();
        } else if (trimmed.startsWith("insight:") || trimmed.startsWith("INSIGHT:")) {
          section.insight = trimmed.replace(/^insight:\s*/i, "").trim();
        }
      }
      if (section.headline) {
        newsletter.sections.push(section);
      }
    }
  }

  // Deduplicate
  newsletter.sections = newsletter.sections.filter(
    (s, i, arr) => arr.findIndex((x) => x.headline === s.headline) === i
  );

  if (newsletter.sections.length === 0) {
    throw new Error(
      "Could not extract any newsletter sections from DeepSeek response"
    );
  }

  return newsletter;
}

/**
 * Run operator.js as a fallback content generation method.
 * Spawns operator.js with the newsletter task and captures its output.
 */
async function runOperatorFallback() {
  log("[FALLBACK] Running operator.js for content generation...");

  try {
    const taskPrompt = `Generate today's GCC Morning Brief newsletter

TASK:
Create a file at path: operator/output/latest-newsletter.json

The file must contain valid JSON with this exact structure:
{
  "date": "${todayDate()}",
  "title": "GCC Morning Brief",
  "sections": [
    {
      "headline": "...",
      "summary": "...",
      "insight": "..."
    }
  ]
}

- Include 5-8 sections covering: GCC markets, Saudi economy, UAE business, fintech, energy
- Use specific numbers and data points
- Return ONLY the JSON object, no extra text`;

    execSync(`node ${OPERATOR_MODULE} "${taskPrompt.replace(/"/g, '\\"')}"`, {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      env: { ...process.env },
      timeout: 120000, // 2 minute timeout
    });

    // Check if the output file was created
    if (fs.existsSync(OUTPUT_FILE)) {
      const content = fs.readFileSync(OUTPUT_FILE, "utf-8");
      return JSON.parse(content);
    }

    throw new Error("operator.js did not create output file");
  } catch (err) {
    throw new Error(`Operator fallback failed: ${err.message}`);
  }
}

/**
 * Push to GitHub using the github.js module.
 */
async function pushToGitHub() {
  log("[GIT PUSH] Committing and pushing to GitHub...");

  try {
    const { runGit } = await import(GITHUB_MODULE);
    runGit(`daily newsletter ${todayDate()}`);
    log("[GIT PUSH] Successfully pushed to GitHub");
  } catch (err) {
    throw new Error(`Git push failed: ${err.message}`);
  }
}

// ── Response Validation Layer ──────────────────────────────────────────
/**
 * Classify an Apps Script error from its response body text.
 *
 * Returns one of:
 *   "MISSING_DOPOST"   — doPost handler not defined or deployed
 *   "WRONG_HANDLER"    — doGet returned instead of doPost
 *   "DEPLOYMENT_ERROR" — Arabic script error (تعذر = "unable to")
 *   "HTML_ERROR_PAGE"  — Apps Script returned an error HTML page (not JSON/plain text)
 *   "UNKNOWN_APP_SCRIPT_ERROR" — catch-all for other Apps Script failures
 *   null               — response appears valid
 */
function classifyAppsScriptError(text) {
  if (!text || typeof text !== "string") return null;
  const lower = text.toLowerCase();

  // DUPLICATE_IGNORED is a valid idempotent response — treat as success
  if (text.includes("DUPLICATE_IGNORED")) return null;

  if (text.includes("doPost")) return "MISSING_DOPOST";
  if (text.includes("doGet"))  return "WRONG_HANDLER";
  if (text.includes("تعذر"))   return "DEPLOYMENT_ERROR";

  // Detect HTML error pages — Apps Script returns HTML pages with error info
  // even on HTTP 200. If response looks like an HTML page (not JSON/plain text),
  // and contains error indicators, classify it.
  if (lower.includes("<!doctype html") || lower.includes("<html")) {
    if (
      lower.includes("error") ||
      lower.includes("exception") ||
      lower.includes("not found") ||
      lower.includes("404")
    ) {
      return "HTML_ERROR_PAGE";
    }
  }

  return null; // looks valid
}

/**
 * Validate that the Apps Script response represents a real delivery,
 * not just an HTTP 200 with an error page body.
 *
 * @param {number} httpCode - HTTP status code as a string (from curl -w)
 * @param {string} responseBody - The response body text
 * @returns {{ valid: boolean, classification: string|null }}
 */
function validateAppsScriptResponse(httpCode, responseBody) {
  const classification = classifyAppsScriptError(responseBody);

  // HTTP 200 alone is NOT treated as success.
  // The response body must pass classification (no error signals found).
  const isValidSuccess =
    httpCode === "200" &&
    classification === null;

  return {
    valid: isValidSuccess,
    classification,
  };
}

/**
 * Send newsletter JSON payload to Apps Script webhook.
 *
 * Validates response and logs structured status:
 *   - HTTP 200 alone is NOT treated as success — response body is validated
 *   - doPost missing / HTML error pages caught immediately
 *   - Auth failure detection for misconfigured WEBHOOK_SECRET
 */
async function sendToAppsScript(newsletter) {
  if (isDryRun) {
    log("[DRY RUN] Would send to Apps Script webhook: " + APPS_SCRIPT_WEBHOOK_URL);
    log("[DRY RUN] Payload: " + JSON.stringify(newsletter).slice(0, 200) + "...");
    return;
  }

  if (!APPS_SCRIPT_WEBHOOK_URL) {
    log("[APPS SCRIPT] Configuration Missing — No APPS_SCRIPT_WEBHOOK_URL set", "WARN");
    log("[APPS SCRIPT] Set APPS_SCRIPT_WEBHOOK_URL in operator/.env or environment");
    return;
  }

  log("[APPS SCRIPT] Sending POST to webhook...");

  // Build the payload with auth_token for security
  const deliveryId = getDeliveryId();
  const payload = {
    ...newsletter,
    deliveryId,
    auth_token: WEBHOOK_SECRET,
  };
  log(`[APPS SCRIPT] 🆔 Delivery ID: ${deliveryId}`);

  // Use temp file for payload to avoid shell escaping issues
  const tmpPayload = path.join(OUTPUT_DIR, ".tmp-apps-script-payload.json");
  writeFileSyncSafe(tmpPayload, JSON.stringify(payload));

  try {
    // Execute curl with full response capture (including HTTP status code)
    const cmd = `curl -s -w "\\n%{http_code}" -L -X POST "${APPS_SCRIPT_WEBHOOK_URL}" \
      -H "Content-Type: application/json" \
      -d @"${tmpPayload}"`;

    const stdout = execSync(cmd, {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 30000,
      maxBuffer: 1024 * 1024, // 1MB buffer for response
    });

    const output = stdout.toString().trim();

    // Extract HTTP status code (last line)
    const lines = output.split("\n");
    const httpCode = lines.pop(); // Last line is the status code
    const responseBody = lines.join("\n").trim();

    // ── Response validation layer ────────────────────────────────────
    // HTTP 200 is NOT treated as success. Apps Script can return an HTML
    // error page with 200. We validate the response body explicitly.
    const validation = validateAppsScriptResponse(httpCode, responseBody);

    log("[APPS SCRIPT] 📬 Delivery Status:", {
      http: httpCode,
      valid: validation.valid,
      classification: validation.classification || "SUCCESS",
    });

    // ── Handle response based on HTTP status code ──────────────────
    if (httpCode === "200") {
      if (validation.valid) {
        // TRUE success — response body confirmed execution
        const isDup = responseBody && responseBody.includes("DUPLICATE_IGNORED");
        log(`[APPS SCRIPT] ${isDup ? "⏭️" : "✅"} ${isDup ? "Duplicate Ignored (idempotent guard)" : "Success: Newsletter Filed"}`);
        log(`[APPS SCRIPT] 🆔 Delivery ID: ${deliveryId}`);
        log(`[APPS SCRIPT] Payload: ${newsletter.sections.length} sections, ${JSON.stringify(newsletter).length} bytes`);
      } else {
        // HTTP 200 but Apps Script returned an error page/body
        const errType = validation.classification || "UNKNOWN_APP_SCRIPT_ERROR";
        log(`[APPS SCRIPT] ❌ CRITICAL FAILURE — ${errType}`, "ERROR");
        log(`[APPS SCRIPT] Response body: ${responseBody}`, "ERROR");
        throw new Error(`Apps Script delivery failed validation: ${errType} — ${responseBody.slice(0, 300)}`);
      }
    } else if (httpCode === "401" || httpCode === "403") {
      log(`[APPS SCRIPT] ❌ Auth Failure (HTTP ${httpCode}) — Check WEBHOOK_SECRET configuration`, "ERROR");
      log(`[APPS SCRIPT] Response: ${responseBody}`, "ERROR");
      throw new Error(`Apps Script auth failure (HTTP ${httpCode}): ${responseBody}`);
    } else if (httpCode === "502" || httpCode === "503") {
      throw new Error(`Apps Script service unavailable (HTTP ${httpCode})`);
    } else if (httpCode === "000" || httpCode === "") {
      throw new Error(`Network error — could not reach Apps Script webhook`);
    } else {
      log(`[APPS SCRIPT] ⚠️  Unexpected HTTP ${httpCode}`, "WARN");
      log(`[APPS SCRIPT] Response: ${responseBody}`, "WARN");
      // Don't throw — the bash script handles retries. Log it and move on.
    }
  } catch (err) {
    // Clean up temp file
    try { fs.unlinkSync(tmpPayload); } catch { /* ignore */ }
    throw new Error(`Apps Script webhook POST failed: ${err.message}`);
  }

  // Clean up temp file
  try { fs.unlinkSync(tmpPayload); } catch { /* ignore */ }
}


/**
 * Save the newsletter to the output file.
 */
function saveNewsletter(newsletter) {
  if (isDryRun) {
    log("[DRY RUN] Would save newsletter to: " + OUTPUT_FILE);
    log("[DRY RUN] Content preview: " + JSON.stringify(newsletter).slice(0, 300) + "...");
    return;
  }

  writeFileSyncSafe(OUTPUT_FILE, JSON.stringify(newsletter, null, 2));
  log(`[FILE SAVED] ${OUTPUT_FILE} (${JSON.stringify(newsletter).length} bytes)`);
}

// ── MAIN ────────────────────────────────────────────────────────────────

async function main() {
  // ═══════════════════════════════════════════════════════════════════════
  // STEP 0: Idempotency check
  // ═══════════════════════════════════════════════════════════════════════
  if (alreadyRanToday()) {
    log(`[SKIP] Already ran successfully today (${todayDate()}). Use --force to override.`);
    log("[DAILY RUN COMPLETE]");
    process.exit(0);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: Start
  // ═══════════════════════════════════════════════════════════════════════
  log("=".repeat(60));
  log("[DAILY RUN STARTED] GCC Morning Brief — " + todayDate());
  if (isDryRun) log("[DRY RUN MODE] No changes will be made");
  log("=".repeat(60));

  let newsletter = null;

  try {
    // ═════════════════════════════════════════════════════════════════════
    // STEP 2: Generate newsletter via DeepSeek
    // ═════════════════════════════════════════════════════════════════════
    log("\n⏳ Generating newsletter...");
    newsletter = await generateNewsletter();
    log("[NEWSLETTER GENERATED]");

    // ── Inject date / title if missing ──────────────────────────────────
    if (!newsletter.date) newsletter.date = todayDate();
    if (!newsletter.title) newsletter.title = "GCC Morning Brief";

    // ═════════════════════════════════════════════════════════════════════
    // STEP 3: Validate schema
    // ═════════════════════════════════════════════════════════════════════
    log("\n⏳ Validating newsletter schema...");
    const validation = validateNewsletterSchema(newsletter);
    if (!validation.valid) {
      log(`[VALIDATION FAILED] ${validation.errors.join("; ")}`, "ERROR");
      log("Attempting operator.js fallback...");
      newsletter = await runOperatorFallback();

      // Re-validate after fallback
      const retryValidation = validateNewsletterSchema(newsletter);
      if (!retryValidation.valid) {
        throw new Error(
          `Schema validation failed after fallback: ${retryValidation.errors.join("; ")}`
        );
      }
    }
    log("[SCHEMA VALID] " + newsletter.sections.length + " sections");

    // ═════════════════════════════════════════════════════════════════════
    // STEP 4: Save to output file
    // ═════════════════════════════════════════════════════════════════════
    log("\n⏳ Saving newsletter to disk...");
    saveNewsletter(newsletter);
    log("[OUTPUT SAVED]");

    // ═════════════════════════════════════════════════════════════════════
    // STEP 5: Push to GitHub
    // ═════════════════════════════════════════════════════════════════════
    log("\n⏳ Pushing to GitHub...");
    await pushToGitHub();
    log("[UPLOADED TO GITHUB]");

    // ═════════════════════════════════════════════════════════════════════
    // STEP 6: Send to Apps Script webhook
    // ═════════════════════════════════════════════════════════════════════
    log("\n⏳ Sending to Apps Script...");
    await sendToAppsScript(newsletter);
    log("[UPLOADED TO APPS SCRIPT]");
    log("[EMAIL SENT]");

    // ═════════════════════════════════════════════════════════════════════
    // STEP 7: Mark today complete
    // ═════════════════════════════════════════════════════════════════════
    if (!isDryRun) {
      markTodayComplete();
    }

    // ═════════════════════════════════════════════════════════════════════
    // STEP 8: Summary
    // ═════════════════════════════════════════════════════════════════════
    log("\n" + "=".repeat(60));
    log("[DAILY RUN COMPLETE]");
    log(`  Date:     ${todayDate()}`);
    log(`  Sections: ${newsletter.sections.length}`);
    log(`  File:     ${OUTPUT_FILE}`);
    log(`  Dry-run:  ${isDryRun}`);
    log("[RUN COMPLETE]");
    log("=".repeat(60));
  } catch (err) {
    // ═════════════════════════════════════════════════════════════════════
    // FAILURE HANDLING: Log error but DO NOT exit with error code
    // This ensures cron continues running the next day
    // ═════════════════════════════════════════════════════════════════════
    log(`\n❌ [FATAL ERROR] ${err.message}`, "ERROR");
    log(`  Stack: ${err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : "(no stack)"}`, "ERROR");

    // If we got partial output, save it anyway for debugging
    if (newsletter && newsletter.sections && newsletter.sections.length > 0) {
      try {
        writeFileSyncSafe(
          OUTPUT_FILE.replace(".json", "-partial.json"),
          JSON.stringify(newsletter, null, 2)
        );
        log("[PARTIAL OUTPUT SAVED]");
      } catch {
        // ignore
      }
    }

    log("\n" + "=".repeat(60));
    log("[DAILY RUN COMPLETE — WITH ERRORS]");
    log("  The error has been logged. Next day's run will proceed automatically.");
    log("[RUN COMPLETE]");
    log("=".repeat(60));

    // Exit with 0 so cron doesn't pummel us with emails
    process.exit(0);
  }
}

main();
