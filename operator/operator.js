import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";
import fetch from "node-fetch";
import crypto from "crypto";
import { askDeepSeek, callDeepSeekForContent } from "./deepseek.js";
import { evaluateNewsletter } from "./evaluator.js";
import { saveRun } from "./memory.js";
import { validateEnvironment, logWebhookStatus } from "./core/validate-env.js";
import {
  printModeBanner,
  MODES,
  isBlocked,
  getState,
  setState,
} from "./core/state.js";
import { evaluateTruth, calculateHealthScore, isSystemUnstable } from "./core/truth-evaluator.js";
import { runOptimization } from "./core/optimizer.js";
import { processFeedback } from "./core/feedback.js";
import { initAgentRun } from "./core/agent-orchestrator.js";
import { fuseSignals, formatSignalContext } from "./core/fusion-engine.js";
import { synthesizeInsights, formatInsightsForNewsletter } from "./core/insight-synthesizer.js";
import { generateScenarios, formatScenariosForNewsletter } from "./core/scenario-engine.js";
import { createExecutionContext } from "./core/context.js";

import { buildEditorialFrame, formatEditorialFrame } from "./core/editor.js";

// ── Dynamic path resolution (works on any server: local, Hetzner, etc.) ─────
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.resolve(__dirname, ".env") });
process.chdir(ROOT);

// ── CURRENT DATE (from system clock — never hardcoded) ──────────────────────
const CURRENT_DATE = new Date().toISOString().slice(0, 10); // "2026-05-07"

// ── RUN ID GENERATION — single source for ExecutionContext ─────────────────
// Use RUN_ID from executor.js if available, otherwise generate one deterministically.
// This is the ONLY place a runId is created in the operator pipeline.
const RUN_ID = process.env.RUN_ID ||
  `${process.argv[2] || "daily-newsletter"}-${CURRENT_DATE}`;

// ── JOB NAME — set once at startup, accessible globally ───────────────────
let JOB_NAME = process.argv[2] || "daily-newsletter";

// ── REPLAY MODE FLAG — safe mode for the replay engine ─────────────────
// When --replay is present, operator.js runs in reduced mode:
//   - Skips newsletter regeneration if existing output exists
//   - Re-uses stored JSON if available
//   - Only re-triggers push step + validation
//   - Does NOT trigger recovery hooks
const isReplay = process.argv.includes("--replay");

// ── IDEMPOTENT DELIVERY ID — unique per (job, date, git commit) ──────────
function getDeliveryId(job) {
  let gitCommitHash = "unknown";
  try {
    gitCommitHash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch { /* git may not be available */ }
  return `${job}-${CURRENT_DATE}-${gitCommitHash}`;
}

// ── Startup Health Check ─────────────────────────────────────────────────────
validateEnvironment();
console.log("📡 Apps Script Webhook:", process.env.APPS_SCRIPT_WEBHOOK_URL);
logWebhookStatus();


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
 * Uses ctx.runId for all agent barrier tracking,
 * signal fusion, insight synthesis, and scenario generation.
 *
 * @param {object} ctx - ExecutionContext (ONLY source of identity)
 */
async function generateNewsletterContent(ctx) {
  console.log("\n📝 GENERATING NEWSLETTER CONTENT...");

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: Build editorial frame (deterministic topic priority + narrative order)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n   📋 Building editorial frame...");
  const editorialFrame = buildEditorialFrame(CURRENT_DATE);
  const editorialBlock = formatEditorialFrame(editorialFrame);

  console.log("\n   🧠 Running signal fusion engine (with editorial gatekeeping)...");
  // ── Pass ctx to fuseSignals for agent barrier tracking ──
  const fusedSignals = await fuseSignals(CURRENT_DATE, editorialFrame, ctx);
  const signalContext = formatSignalContext(fusedSignals);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2b: Run strategic insight synthesis (hypothesis generation)
  //          Generates 2-4 structured, signal-grounded hypotheses
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n   🧠 Running strategic insight synthesis...");
  const insightResult = await synthesizeInsights(fusedSignals, ctx);
  const insightNewsletterSection = formatInsightsForNewsletter(insightResult.insights);
  console.log(`   ✅ Insights generated: ${insightResult.insights.length} passed validation gate`);
  if (insightResult.discarded.length > 0) {
    console.log(`   ⏭️  Insights discarded: ${insightResult.discarded.length} (below confidence/signal threshold)`);
  }


  // Build editorial decision summary for the prompt
  const editorialSummary = fusedSignals.editorialSummary || null;
  const editorialBrief = editorialSummary
    ? `
APPROVED EDITORIAL BRIEF (Editorial Decision Summary):
• Total signals evaluated: ${editorialSummary.totalInput}
• Stories APPROVED for publication: ${editorialSummary.included}
• Stories EXCLUDED (dropped): ${editorialSummary.excluded}
• Stories DEFERRED (future consideration): ${editorialSummary.deferred}
• Category balance enforced: max 2 per category — ${JSON.stringify(editorialSummary.categoryBalance)}
• Editorial rationale: ${editorialSummary.rationale}

This brief contains ONLY pre-filtered, editorially curated stories.
All signals below have passed the editorial gate:
  - GCC relevance >= 7/10
  - Signal strength >= 6/10
  - Noise level <= 4/10
  - Balanced across categories (macro, markets, geopolitics, AI/tech)

No raw or unfiltered data is included. Generate from the curated content only.`
    : "";

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3: Inject APPROVED EDITORIAL BRIEF + signal context into DeepSeek
  // ═══════════════════════════════════════════════════════════════════════
  // CRITICAL CHANGE: DeepSeek no longer receives raw signals.
  // It receives ONLY:
  //   1. Editorial frame (narrative ordering)
  //   2. Approved editorial brief (editorial rationale)
  //   3. Curated signal context (pre-filtered stories only)
  //
  // No raw noise is passed anymore. This is the critical distinction
  // between a pipeline and an editorial desk.

  const prompt = `${editorialBlock}

${signalContext}

${editorialBrief}

${
  insightNewsletterSection
    ? `${insightNewsletterSection}

`
    : ""
}GENERATE NEWSLETTER

Generate today's GCC Morning Brief newsletter grounded in the signals above.

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

CONTENT REQUIREMENTS (CRITICAL — MUST FOLLOW):
1. The FIRST section MUST be "🔎 GCC Intelligence Signals" — the foundation layer.
   - Include the top macro driver, top market movement, top geopolitical shift, top AI/tech catalyst.
   - Use the exact data from the GCC Intelligence Brief above.
2. Remaining 5-8 sections must be derived from the SIGNAL CONTEXT above.
   - Each section MUST be traceable to at least one specific signal.
   - Cover GCC markets, Saudi economy, UAE business, regional fintech, and energy.
3. Be data-driven: include specific numbers, percentages, and market data FROM THE SIGNALS.
4. Tone: authoritative, direct, professional — suitable for GCC executives.
5. Follow the editorial NARRATIVE ORDER shown above.
6. Do NOT fabricate data — use ONLY what is provided in the signal context.
7. You are working with curated, editorially-approved content only — all signals below have passed the editorial gate. No raw noise is present.

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

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2c: Run scenario engine (decision simulation layer)
  //          Generates 1-3 structured, signal-grounded scenarios
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n   📊 Running scenario engine...");
  const scenarioResult = await generateScenarios(fusedSignals, insightResult.insights, ctx);
  const scenarioNewsletterSection = formatScenariosForNewsletter(scenarioResult.scenarios);
  console.log(`   ✅ Scenarios generated: ${scenarioResult.scenarios.length} passed validation gates`);
  if (scenarioResult.scenarios.length > 0) {
    console.log(`   Scenario types: ${scenarioResult.scenarios.map(s => s.type).join(", ")}`);
  }

  // Attach strategic insight data to newsletter output
  newsletter.strategicInsights = insightResult.insights.map((i) => ({
    hypothesis: i.hypothesis,
    confidence: i.confidence,
    type: i.type,
    status: i.status,
    supportingSignals: i.supportingSignals,
  }));

  // Attach scenario data to newsletter output
  newsletter.scenarios = scenarioResult.scenarios.map((s) => ({
    scenario: s.scenario,
    type: s.type,
    drivers: s.drivers,
    potentialImpacts: s.potentialImpacts,
    probabilityBand: s.probabilityBand,
    confidence: s.confidence,
    status: s.status,
  }));

  console.log(`✅ NEWSLETTER GENERATED — ${newsletter.sections.length} sections, ${newsletter.strategicInsights.length} strategic hypotheses, ${newsletter.scenarios.length} scenarios`);
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
 * Returns { valid: boolean, classification: string|null, text: string }
 */
function validateAppsScriptResponse(res, bodyText) {
  const classification = classifyAppsScriptError(bodyText);

  // If it's an HTML error page or classified failure, reject even on HTTP 200
  const isValidSuccess =
    res.ok &&
    classification === null;

  return {
    valid: isValidSuccess,
    classification,
    text: bodyText,
  };
}

// -----------------------------
// PUSH TO APPS SCRIPT (Delivery Bridge)
// -----------------------------
/**
 * POST the latest newsletter JSON to the Apps Script webhook.
 * Reads APPS_SCRIPT_WEBHOOK_URL and WEBHOOK_SECRET from .env.
 * Replicates the logic from scripts/send_to_apps_script.sh natively in JS.
 */
async function pushToAppsScript(ctx, filePath = "output/latest-newsletter.json") {
  const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!webhookUrl) {
    console.log("❌ [PUSH FAILED] APPS_SCRIPT_WEBHOOK_URL is not set in .env");
    return false;
  }

  // Strict validation: must be a Web App /exec URL — reject library URLs
  if (!webhookUrl.includes("/macros/s/")) {
    throw new Error("Invalid Apps Script webhook: must use Web App /exec URL only");
  }


  if (!webhookSecret) {
    console.log("⚠ WEBHOOK_SECRET not set — sending without signature verification");
  }

  const absolutePath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(absolutePath)) {
    console.log(`❌ [PUSH FAILED] Payload file not found: ${absolutePath}`);
    return false;
  }

  let payload;

  try {
    payload = JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
  } catch (err) {
    console.log(`❌ [PUSH FAILED] Invalid JSON in payload: ${err.message}`);
    return false;
  }

  // ── IDEMPOTENCY: inject deliveryId — unique per (job, date, git commit) ──
  payload.deliveryId = getDeliveryId(JOB_NAME);
  console.log(`   🆔 Delivery ID: ${payload.deliveryId}`);

  // ── EXECUTION CONTEXT: tie Apps Script delivery back to ctx.runId ──
  payload._ctx = {
    runId: ctx.runId,
    gitCommit: ctx.metadata.gitCommit,
    startedAt: ctx.startedAt,
  };

  // ── AUTH: Header-based ONLY (no body payload auth) ──────────────
  // Send secret in HTTP Authorization header.
  // Apps Script extracts from e.headers.Authorization.
  const authHeaders = {};
  if (webhookSecret) {
    authHeaders["Authorization"] = `Bearer ${webhookSecret}`;
  }

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


      // ── APPS SCRIPT POST HANDLING ─────────────────────────────────────
      // Apps Script Web Apps redirect POST → GET via 302 to /usercallback.
      // Using redirect: "manual" to capture the redirect URL,
      // then manually GET the callback URL which processes the POST payload.
      // This preserves the Authorization header across the redirect chain.
      const postRes = await fetch(webhookUrl, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });

      let res = postRes;

      // If we got a 302 redirect (standard Apps Script behavior),
      // follow it with a GET to the callback URL
      if (postRes.status >= 300 && postRes.status < 400) {
        const redirectUrl = postRes.headers.get("location");
        if (redirectUrl) {
          console.log(`   ↪️ Following redirect to callback URL...`);
          res = await fetch(redirectUrl, {
            method: "GET",
            headers: { ...authHeaders },
          });
        }
      }

      const body = await res.text();

      // ── Response validation layer ────────────────────────────────────
      // HTTP 200 is NOT treated as success. Apps Script can return an HTML
      // error page with 200. We validate the response body explicitly.
      const validation = validateAppsScriptResponse(res, body);

      console.log("📬 Delivery Status:", {
        http: res.status,
        valid: validation.valid,
        classification: validation.classification || "SUCCESS",
      });

      if (res.status === 200 && validation.valid) {
        const isDup = body && body.includes("DUPLICATE_IGNORED");
        console.log(`   ${isDup ? "⏭️" : "✅"} [${isDup ? "DUPLICATE_IGNORED" : "SUCCESS"}] Newsletter delivered to Apps Script.`);
        console.log(`   Response: ${body || "(empty)"}`);

        // Append delivery log
        const logPath = path.join(ROOT, "output", "delivery_log.txt");
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, `\n--- Delivery Report: ${new Date().toISOString()} ---\nHTTP 200 — ${isDup ? "DUPLICATE_IGNORED (idempotent)" : "VALIDATED SUCCESS"}\nDelivery ID: ${payload.deliveryId || "N/A"}\n`, "utf-8");

        return true;
      }

      // ── HTTP 200 but invalid response body (the critical gap) ────────
      if (res.status === 200 && !validation.valid) {
        const errMsg = `Apps Script delivery failed validation: ${validation.classification} — ${body.slice(0, 200)}`;
        console.log(`   ❌ ${errMsg}`);
        // Do NOT retry — the webhook URL is valid, deployment is broken.
        // Retrying will just get the same broken response.
        console.log(`   ⛔ Not retrying — deployment issue, not network issue.`);
        return false;
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
        console.log(`   Fix: WEBHOOK_SECRET in .env must match the hardcoded secret in scripts/Code.gs`);
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
  const plan = await askDeepSeek(
    CURRENT_DATE,
    `TASK:
${task}`
  );

  // Schema validation: response must be valid JSON object with steps array
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) {
    throw new Error('PLAN_SCHEMA_INVALID');
  }

  return plan;
}

// -----------------------------
// EXECUTE PLAN
// -----------------------------
async function executePlan(plan, ctx) {
  let success = 0;
  let failed = 0;

  for (const step of plan.steps) {
    try {
      // ── Handle "generate_newsletter" action ──────────────
      if (step.action === "generate_newsletter") {
        // ── REPLAY MODE: skip if output already exists ────────
        const outputPath = path.resolve(ROOT, "output", "latest-newsletter.json");
        if (isReplay && fs.existsSync(outputPath)) {
          console.log(`⏭️ [REPLAY MODE] Skipping newsletter generation — reusing existing output`);
          success++;
          continue;
        }

        const newsletter = await generateNewsletterContent(ctx);

        // Save to output/latest-newsletter.json
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
        runGit("git push origin HEAD:main");
        console.log(`✅ [STEP SUCCESS] git — "${commitMsg}"`);
        success++;
        continue;
      }

      // ── Handle "push" action (Apps Script delivery) ──────
      if (step.action === "push") {
        const payloadPath = step.path || "output/latest-newsletter.json";
        const pushed = await pushToAppsScript(ctx, payloadPath);
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
// STATUS DISPLAY — system health snapshot
// -----------------------------
/**
 * printStatus — Print a lightweight system health snapshot.
 *
 * Uses existing functions imported from state.js and truth-evaluator.js:
 *   - getState()     — current execution state (mode, lock, flags)
 *   - calculateHealthScore() — truth accuracy, mismatch rate, recovery dependency
 *   - isSystemUnstable()     — stability check
 *
 * Exits cleanly without executing any pipeline logic.
 */
function printStatus() {
  const state = getState();
  const health = calculateHealthScore();
  const stability = isSystemUnstable();

  const line = "═".repeat(50);
  console.log(`\n${line}`);
  console.log("📊 SYSTEM STATUS");
  console.log(line);

  // ── Execution state ─────────────────────────────────────────
  console.log(`\n🔒 EXECUTION STATE`);
  console.log(`   Mode:              ${state.mode || "NORMAL"}`);
  console.log(`   Active Run ID:     ${state.activeRunId || "(none)"}`);
  console.log(`   Safe Mode:         ${state.flags?.safeMode ? "⚠️ ACTIVE" : "✅ Off"}`);
  console.log(`   Consecutive Failures: ${state.flags?.consecutiveFailures ?? 0}`);

  // ── Health score ────────────────────────────────────────────
  console.log(`\n📊 HEALTH SCORE`);
  console.log(`   Truth Accuracy:    ${health.truthAccuracy}/100`);
  console.log(`   Mismatch Rate:     ${health.mismatchRate}%`);
  console.log(`   Recovery Dep:      ${health.recoveryDependency}`);

  // ── Stability check ─────────────────────────────────────────
  if (stability.unstable) {
    console.log(`\n⚠️  SYSTEM STABILITY WARNING`);
    console.log(`   Reason: ${stability.reason}`);
  } else {
    console.log(`\n✅ System stable`);
  }

  console.log(`\n${line}`);
  console.log(`📅 ${CURRENT_DATE}`);
  console.log(`${line}\n`);
}

// -----------------------------
// MAIN ROUTER
// -----------------------------
async function run() {
  // ── INTERCEPT STATUS COMMAND ──────────────────────────────────
  // "status" is a special command, not a job name.
  // Must be intercepted before normal job parsing to avoid
  // falling through to the JOBS lookup → "Unknown job" error.
  if (process.argv[2] === "status") {
    return printStatus();
  }

  const jobName = process.argv[2] || "daily-newsletter";
  const task = JOBS[jobName];

  if (!task) {
    console.log(`❌ Unknown job: ${jobName}`);
    return;
  }

  // ── STARTUP SANITIZATION: Clear stale agent state ─────────────
  // Resets any leftover test-run-* / invalid runIds / orphaned completed states.
  // This prevents stale state contamination (e.g., "test-run-123")
  // from producing "Agent Run ID: undefined" or runId mismatch warnings.
  console.log("\n🧹 [STARTUP] Sanitizing agent state...");
  try {
    const agentStatePath = path.resolve(__dirname, "core", "..", "logs", "agent-state.json");
    const currentAgentState = JSON.parse(fs.readFileSync(agentStatePath, "utf-8"));
    const currentRunId = currentAgentState.runId || "";
    if (currentRunId.startsWith("test-run-") || currentRunId === "" || currentRunId.includes("undefined")) {
      fs.writeFileSync(agentStatePath, JSON.stringify({
        runId: "",
        macro: "pending",
        gcc: "pending",
        risk: "pending",
        editor: "pending"
      }, null, 2), "utf-8");
      console.log("   ✅ Cleared stale agent state: " + (currentRunId || "(empty)"));
    }
  } catch {
    // agent-state.json may not exist yet — that's fine
    console.log("   ℹ️  No existing agent state to sanitize");
  }

  // ── STARTUP SANITIZATION: Clear stale runtime state ──────────────
  // Also sanitize runtime/state.json to remove stale activeRunId,
  // stale consecutiveFailures, and any orphaned state from prior runs.
  // This prevents runId mismatch warnings caused by stale state.json.
  try {
    const runtimeStatePath = path.resolve(__dirname, "runtime", "state.json");
    if (fs.existsSync(runtimeStatePath)) {
      const currentRuntimeState = JSON.parse(fs.readFileSync(runtimeStatePath, "utf-8"));
      const staleRunId = currentRuntimeState.activeRunId || "";
      if (staleRunId !== "" && (staleRunId.startsWith("test-run-") || staleRunId.includes("undefined"))) {
        fs.writeFileSync(runtimeStatePath, JSON.stringify({
          mode: "NORMAL",
          activeRunId: "",
          flags: {
            recoveryRunning: false,
            replayRunning: false,
            lastFailureTimestamp: null,
            safeMode: false,
            consecutiveFailures: 0
          }
        }, null, 2), "utf-8");
        console.log("   ✅ Cleared stale runtime state: " + staleRunId);
      }
    }
  } catch {
    console.log("   ℹ️  No existing runtime state to sanitize");
  }

  // ── CREATE SINGLE ExecutionContext (ONLY source of identity) ──
  // This ctx propagates through EVERY downstream module.
  // No component may generate a secondary runId.
  const ctx = createExecutionContext({
    runId: RUN_ID,
    job: jobName,
  });

  // ── INITIALIZE AGENT STATE with ctx.runId ─────────────────────
  // This must happen BEFORE fuseSignals() calls markAgentComplete(),
  // otherwise the agent state file will contain stale runIds and
  // trigger "Run ID mismatch" warnings.
  initAgentRun(ctx.runId);

  // ── LOOP ISOLATION: Print mode banner ──────────────────────────────
  const determinedMode = isReplay ? MODES.REPLAY : MODES.NORMAL;
  printModeBanner(determinedMode, `${jobName} — ${CURRENT_DATE}`);

  // ── REPLAY MODE GUARD: Do not trigger recovery hooks ──────────────
  console.log("\n==================================================");
  console.log("🚀 OPERATOR STARTED");
  console.log("JOB:", jobName);
  console.log("MODE:", determinedMode);
  console.log("DATE:", CURRENT_DATE);
  console.log("RUN ID:", ctx.runId);
  if (isReplay) {
    console.log("🔄 REPLAY MODE ACTIVE — skipping regeneration if output exists");
    console.log("   ⛔ Recovery hooks disabled — replay will not trigger recovery");
  }
  console.log("==================================================");

  console.log("\n⏳ Generating plan from DeepSeek...");

  const plan = await generatePlan(task);

  if (!plan || !plan.steps) {
    console.log("❌ PLAN GENERATION FAILED");
    return;
  }

  console.log("\n[PLAN RECEIVED]");
  console.log(JSON.stringify(plan, null, 2));

  // ── SAFE MODE CHECK + AUTO-RECOVERY ─────────────────────────────
  const currentState = getState();
  if (currentState.flags && currentState.flags.safeMode) {
    const lastFailure = currentState.flags.lastFailureTimestamp;
    if (lastFailure && Date.now() - lastFailure > 60 * 60 * 1000) {
      setState({
        flags: {
          safeMode: false,
          consecutiveFailures: 0,
        },
      });
      console.log("🟢 SAFE MODE AUTO-RECOVERED");
    } else {
      console.log("🛑 SAFE MODE ACTIVE — blocking executePlan() due to 2 consecutive pipeline failures");
      return;
    }
  }

  const result = await executePlan(plan, ctx);

  // ── CONSECUTIVE FAILURE TRACKING ─────────────────────────────────
  // Track pipeline failures. If 2 consecutive runs have failures,
  // set SAFE_MODE = true to block future executions.
  const state = getState();
  let consecutiveFailures = (state.flags && state.flags.consecutiveFailures) || 0;

  if (result.failed > 0) {
    consecutiveFailures++;
  } else {
    consecutiveFailures = 0;
  }

  if (consecutiveFailures >= 2) {
    setState({
      flags: {
        safeMode: true,
        consecutiveFailures: consecutiveFailures,
      },
    });
    console.log("🛑 SAFE MODE ACTIVATED — 2 consecutive pipeline failures detected");
  } else {
    setState({
      flags: {
        safeMode: false,
        consecutiveFailures: consecutiveFailures,
      },
    });
  }

  console.log("\n==================================================");
  console.log("📊 EXECUTION SUMMARY");
  console.log("SUCCESS:", result.success);
  console.log("FAILED:", result.failed);
  console.log("==================================================");

  // ── v3 Feedback Loop (legacy, kept for memory/newsletter-history.json) ──
  try {
    const newsletterPath = path.join(ROOT, "output", "latest-newsletter.json");
    if (fs.existsSync(newsletterPath)) {
      const rawNewsletter = fs.readFileSync(newsletterPath, "utf-8");
      const newsletterJson = JSON.parse(rawNewsletter);

      let latestGitCommit = "unknown";
      try {
        latestGitCommit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
      } catch { /* git may not be available */ }

      // Reuse the evaluation from processFeedback if available, otherwise evaluate now
      const scores = evaluateNewsletter(newsletterJson);

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

  // ═══════════════════════════════════════════════════════════════════════
  // TRUTH VERIFICATION LAYER — verify success against external sources
  // ═══════════════════════════════════════════════════════════════════════
  const declaredState = result.failed === 0 ? "SUCCESS" : result.success > 0 ? "PARTIAL" : "FAILED";
  const deliveryId = getDeliveryId(jobName);

  console.log("\n⚖️ [TRUTH VERIFICATION] Evaluating pipeline results...");
  const truthResult = evaluateTruth({
    runId: ctx.runId,
    declaredState,
    job: jobName,
    deliveryId,
  });

  // ⚠️ Mismatch: system says SUCCESS but reality didn't confirm
  if (truthResult.mismatch) {
    console.log(`\n🛑 [TRUTH] MISMATCH: System declared ${declaredState} but verified as ${truthResult.verifiedState}`);
  }

  // 📊 Health score summary
  const health = calculateHealthScore();
  console.log(`\n📊 SYSTEM HEALTH REPORT`);
  console.log(`   Truth Accuracy:  ${health.truthAccuracy}/100`);
  console.log(`   Mismatch Rate:   ${health.mismatchRate}%`);
  console.log(`   Recovery Dep:    ${health.recoveryDependency}`);
  console.log(`   🎯 SYSTEM TRUTH SCORE: ${health.truthAccuracy}/100`);

  const stability = isSystemUnstable();
  if (stability.unstable) {
    console.log(`\n⚠️ SYSTEM STABILITY WARNING: ${stability.reason}`);
    console.log(`   Consider reviewing recent mismatches in operator/logs/truth-log.json`);
  }

  if (result.failed === 0) {
    console.log("\n🎉 PIPELINE COMPLETE");
  } else {
    console.log("\n⚠️ PIPELINE COMPLETED WITH ERRORS");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONTROLLED SELF-OPTIMIZATION LOOP — bounded prompt evolution
  // ═══════════════════════════════════════════════════════════════════════
  // After EVERY run:
  //   1. Process feedback through evaluator → feedback.json
  //   2. Run optimizer quality trend analysis + evidence check
  //   3. Optionally apply / revert prompt changes
  //   4. Log decision to optimization-log.json
  // ═══════════════════════════════════════════════════════════════════════
  try {
    const newsletterPath = path.join(ROOT, "output", "latest-newsletter.json");
    if (fs.existsSync(newsletterPath)) {
      const rawNewsletter = fs.readFileSync(newsletterPath, "utf-8");
      const newsletterJson = JSON.parse(rawNewsletter);

      // Use ctx.runId — the ONLY source of identity
      console.log("\n🧬 [OPTIMIZER] Running controlled self-optimization cycle...");

      // ── Step 1: Process structured feedback (evaluator → feedback.json) ──
      // The processFeedback function handles evaluation, saves to feedback.json,
      // and checks for prompt evolution triggers.
      const feedbackResult = await processFeedback(ctx.runId, newsletterJson, jobName);

      console.log(`   Quality score: ${feedbackResult.evaluation.overall}/10`);
      console.log(`   Weaknesses: ${feedbackResult.evaluation.weaknessTags.join("; ")}`);

      // ── Step 2: Run optimization engine ──────────────────────────────────
      // The optimizer reads feedback.json + truth-log.json to:
      //   - Calculate quality trend direction
      //   - Identify recurring weaknesses across last N runs
      //   - Make evidence-based decision (IMPROVE | NO_CHANGE | REVERT)
      //   - Apply bounded prompt directives (never architecture changes)
      // IMPORTANT: Only run in NORMAL mode, skip in REPLAY mode
      if (!isReplay) {
        const optResult = await runOptimization({ lookback: 7 });

        console.log(`   Optimization decision: ${optResult.decision}`);
        console.log(`   Reason: ${optResult.reason}`);
        console.log(`   Prompt version: ${optResult.promptVersion}`);
      } else {
        console.log(`   ⏭️ [REPLAY MODE] Skipping optimization — only runs in NORMAL mode`);
      }

      console.log("🧬 [OPTIMIZER] Self-optimization cycle complete");
    } else {
      console.log("\n🧬 [OPTIMIZER] No newsletter output found — skipping optimization cycle");
    }
  } catch (err) {
    // Optimization errors are never fatal to pipeline execution
    console.log(`\n🧬 [OPTIMIZER] Self-optimization error (non-fatal): ${err.message}`);
  }
  // ── End Self-Optimization Loop ──────────────────────────────────────────
}

run();

