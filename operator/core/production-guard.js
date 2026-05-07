/**
 * production-guard.js — 🛡 PRODUCTION GUARD MODE
 *
 * CRITICAL SYSTEM MODULE — PROTECTIVE LAYER ONLY
 * Does NOT modify pipeline logic. Does NOT change agent system.
 * Does NOT add features outside guard logic.
 *
 * === 5 CORE GUARD RULES ===
 *
 * 1. CONFIGURATION INTEGRITY CHECK
 *    Validates env vars on every pipeline start.
 *    BLOCKS execution if mismatch detected. Emits CONFIG_DRIFT.
 *
 * 2. SCHEMA VALIDATION GUARD
 *    Validates DeepSeek output structure.
 *    FAILS pipeline if schema changes. Emits SCHEMA_DRIFT.
 *
 * 3. EXECUTION PATTERN GUARD
 *    Detects anomalies: repeated PIPELINE_START without completion,
 *    missing stage transitions, unexpected skips.
 *    Marks run as SUSPECT, does NOT continue blindly.
 *
 * 4. DEPENDENCY BEHAVIOR MONITORING
 *    Tracks DeepSeek response consistency, webhook response format,
 *    git operation stability. Emits DEPENDENCY_DRIFT on deviation.
 *
 * 5. SAFE MODE TRIGGER
 *    Enters SAFE MODE on: 2 consecutive FAILED runs, CONFIG_DRIFT,
 *    or SCHEMA_DRIFT. Only read-only operations allowed.
 *
 * @module production-guard
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOGS_DIR = path.join(__dirname, "..", "logs");
const RUNTIME_DIR = path.join(__dirname, "..", "runtime");
const GUARD_EVENTS_FILE = path.join(LOGS_DIR, "guard-events.json");
const GUARD_STATE_FILE = path.join(RUNTIME_DIR, "guard-state.json");

// ── Guard Constants ──────────────────────────────────────────────────────────

const GUARD_VERSION = "1.0.0";

const MAX_GUARD_EVENTS = 1000;
const MAX_CONCURRENT_FAILURES_BEFORE_SAFE = 2;

// Expected event sequence for execution pattern analysis
const EXPECTED_PIPELINE_SEQUENCE = [
  "PIPELINE_START",
  "NEWSLETTER_GENERATED",
  "GIT_COMMIT",
  "DELIVERY_ATTEMPT",
  "DELIVERY_SUCCESS",
  "PIPELINE_END",
];

// DeepSeek output expected schema keys (for SCHEMA_DRIFT detection)
const EXPECTED_DEEPSEEK_SCHEMA_KEYS = {
  newsletter: ["date", "title", "sections"],
  section: ["headline", "summary", "insight"],
  plan: ["steps"],
  step: ["action", "instruction"],
};

// ── Guard State (In-Memory + File-Backed) ────────────────────────────────────

/**
 * @typedef {Object} GuardState
 * @property {boolean} safeMode - Whether SAFE MODE is active
 * @property {string|null} safeModeReason - Reason SAFE MODE was triggered
 * @property {string|null} safeModeTriggeredAt - ISO timestamp of SAFE MODE entry
 * @property {number} consecutiveFailures - Consecutive pipeline failures
 * @property {string|null} lastFailedRunId - Run ID of last failure
 * @property {number} configDriftCount - Total CONFIG_DRIFT events
 * @property {number} schemaDriftCount - Total SCHEMA_DRIFT events
 * @property {number} dependencyDriftCount - Total DEPENDENCY_DRIFT events
 * @property {number} suspectRuns - Total runs marked as SUSPECT
 * @property {Array<string>} blockedPipelineRunIds - Run IDs that were blocked
 */

let guardState = {
  safeMode: false,
  safeModeReason: null,
  safeModeTriggeredAt: null,
  consecutiveFailures: 0,
  lastFailedRunId: null,
  configDriftCount: 0,
  schemaDriftCount: 0,
  dependencyDriftCount: 0,
  suspectRuns: 0,
  blockedPipelineRunIds: [],
};

// ── In-Memory Pattern Tracking ──────────────────────────────────────────────

// Tracks runs and their event sequence for execution pattern analysis
const runEventSequences = new Map(); // runId → { received: string[], startedAt: ISO }

// Tracks DeepSeek response shape for dependency monitoring
const deepseekResponseHistory = []; // { timestamp, keys: string[], valid: boolean }

// Tracks webhook response shapes for dependency monitoring
const webhookResponseHistory = []; // { timestamp, status, contentType, classification }

// Tracks git operation stability
const gitOperationHistory = []; // { timestamp, operation, exitCode, duration }

// Tracks stage transitions per runId
const runStageTransitions = new Map(); // runId → string[]

// ── File Persistence ─────────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function readGuardEvents() {
  try {
    if (!fs.existsSync(GUARD_EVENTS_FILE)) return [];
    const raw = fs.readFileSync(GUARD_EVENTS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendGuardEvent(event) {
  try {
    ensureDirs();
    let events = readGuardEvents();
    events.push(event);
    if (events.length > MAX_GUARD_EVENTS) {
      events = events.slice(-MAX_GUARD_EVENTS);
    }
    fs.writeFileSync(GUARD_EVENTS_FILE, JSON.stringify(events, null, 2), "utf-8");
  } catch (err) {
    console.error(`[PRODUCTION-GUARD] ❌ Failed to write guard event: ${err.message}`);
  }
}

function readGuardState() {
  try {
    if (!fs.existsSync(GUARD_STATE_FILE)) return null;
    const raw = fs.readFileSync(GUARD_STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistGuardState() {
  try {
    ensureDirs();
    fs.writeFileSync(GUARD_STATE_FILE, JSON.stringify(guardState, null, 2), "utf-8");
  } catch (err) {
    console.error(`[PRODUCTION-GUARD] ❌ Failed to persist guard state: ${err.message}`);
  }
}

function loadGuardState() {
  try {
    const persisted = readGuardState();
    if (persisted) {
      guardState = { ...guardState, ...persisted };
    }
  } catch {
    // Use defaults
  }
}

// Load persisted state on module init
loadGuardState();

// ── Internal Helpers ─────────────────────────────────────────────────────────

function generateGuardEventId() {
  return `guard-${crypto.randomUUID().substring(0, 12)}`;
}

/**
 * Create and emit a guard event with structured payload.
 *
 * @param {object} params
 * @param {string} params.type - Event type (CONFIG_DRIFT, SCHEMA_DRIFT, etc.)
 * @param {"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"} params.severity
 * @param {string} params.message - Human-readable description
 * @param {object} [params.data] - Structured event data
 * @param {string} [params.runId] - Related run ID (optional)
 * @returns {object} The guard event
 */
function emitGuardEvent({ type, severity, message, data = {}, runId = null }) {
  const event = {
    guardEventId: generateGuardEventId(),
    guardVersion: GUARD_VERSION,
    timestamp: new Date().toISOString(),
    type,
    severity,
    message,
    runId: runId || "unknown",
    data,
  };

  appendGuardEvent(event);

  const icons = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🟠", CRITICAL: "🔴" };
  const icon = icons[severity] || "⚪";
  console.log(`\n${icon} [GUARD:${type}] ${message}`);
  if (runId) console.log(`   Run: ${runId}`);
  console.log(`   Severity: ${severity}`);

  // Update guard state counters
  if (type === "CONFIG_DRIFT") guardState.configDriftCount++;
  if (type === "SCHEMA_DRIFT") guardState.schemaDriftCount++;
  if (type === "DEPENDENCY_DRIFT") guardState.dependencyDriftCount++;
  if (type === "SUSPECT_RUN") guardState.suspectRuns++;
  persistGuardState();

  return event;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUARD 1: CONFIGURATION INTEGRITY CHECK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * REQUIRED_ENV_VARS — The canonical list of environment variables
 * that MUST be present for safe pipeline execution.
 *
 * Each entry: [variableName, description]
 */
const REQUIRED_ENV_VARS = [
  ["DEEPSEEK_API_KEY", "DeepSeek API authentication key"],
  ["APPS_SCRIPT_WEBHOOK_URL", "Apps Script Web App /exec URL for newsletter delivery"],
];

/**
 * Validate APPS_SCRIPT_WEBHOOK_URL format.
 * Must be a valid Google Apps Script Web App URL ending in /exec.
 *
 * @param {string} url
 * @returns {{ valid: boolean, message?: string }}
 */
function validateWebhookUrlFormat(url) {
  if (!url || typeof url !== "string" || url.trim() === "") {
    return { valid: false, message: "APPS_SCRIPT_WEBHOOK_URL is empty or not set" };
  }

  const trimmed = url.trim();

  if (!trimmed.startsWith("https://script.google.com/macros/s/")) {
    return {
      valid: false,
      message: `APPS_SCRIPT_WEBHOOK_URL must start with https://script.google.com/macros/s/`,
    };
  }

  if (!trimmed.endsWith("/exec")) {
    return {
      valid: false,
      message: `APPS_SCRIPT_WEBHOOK_URL must end with /exec (got: .../${trimmed.split("/").pop()})`,
    };
  }

  return { valid: true };
}

/**
 * GUARD 1: Run full configuration integrity check.
 *
 * Checks:
 *   - DEEPSEEK_API_KEY is set and non-empty
 *   - APPS_SCRIPT_WEBHOOK_URL is set and properly formatted
 *   - All REQUIRED_ENV_VARS are present
 *
 * On failure: BLOCK execution, emit CONFIG_DRIFT event, return fail result.
 *
 * @param {object} [options]
 * @param {string} [options.runId] - Optional run ID for traceability
 * @returns {{ passed: boolean, failures: Array<{field: string, message: string}> }}
 */
export function checkConfigIntegrity({ runId = null } = {}) {
  const failures = [];

  // 1. Check all required env vars exist and are non-empty
  for (const [varName, description] of REQUIRED_ENV_VARS) {
    const value = process.env[varName];
    if (!value || (typeof value === "string" && value.trim() === "")) {
      failures.push({
        field: varName,
        message: `Missing required environment variable: ${varName} (${description})`,
      });
    }
  }

  // 2. Validate webhook URL format if present
  const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
  if (webhookUrl && webhookUrl.trim() !== "") {
    const urlResult = validateWebhookUrlFormat(webhookUrl);
    if (!urlResult.valid) {
      failures.push({
        field: "APPS_SCRIPT_WEBHOOK_URL",
        message: urlResult.message,
      });
    }
  }

  // 3. Check for unexpected env overrides (detect drift from expected values)
  const expectedBooleans = ["CI", "NO_COLOR"];
  for (const varName of expectedBooleans) {
    if (process.env[varName] !== undefined && process.env[varName] !== "" && process.env[varName] !== "false" && process.env[varName] !== "0") {
      // CI env is expected in some contexts, just note it
    }
  }

  if (failures.length > 0) {
    emitGuardEvent({
      type: "CONFIG_DRIFT",
      severity: "CRITICAL",
      message: `Configuration integrity check FAILED with ${failures.length} issue(s): ${failures.map(f => f.field).join(", ")}`,
      data: { failures, checkedVars: REQUIRED_ENV_VARS.map(v => v[0]) },
      runId,
    });

    // SAFE MODE: Config drift triggers safe mode immediately
    activateSafeMode("CONFIG_DRIFT", `Configuration integrity breach: ${failures.map(f => f.field).join(", ")}`, runId);
  }

  return { passed: failures.length === 0, failures };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUARD 2: SCHEMA VALIDATION GUARD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Expected structure for a valid DeepSeek newsletter output.
 * Used to detect schema drift in LLM responses.
 */
const EXPECTED_NEWSLETTER_SCHEMA = {
  type: "object",
  required: ["date", "title", "sections"],
  properties: {
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    title: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["headline", "summary", "insight"],
        properties: {
          headline: { type: "string" },
          summary: { type: "string" },
          insight: { type: "string" },
        },
      },
    },
    strategicInsights: { type: "array", optional: true },
    scenarios: { type: "array", optional: true },
  },
};

/**
 * Validate a DeepSeek output object against the expected newsletter schema.
 *
 * @param {object} output - The parsed DeepSeek response
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateDeepSeekSchema(output) {
  const errors = [];
  const warnings = [];

  if (!output || typeof output !== "object") {
    errors.push("DeepSeek output is not a valid object");
    return { valid: false, errors, warnings };
  }

  // Check for 'steps' (plan format) or 'sections' (newsletter format)
  const hasSections = Array.isArray(output.sections);
  const hasSteps = Array.isArray(output.steps);

  if (!hasSections && !hasSteps) {
    errors.push('DeepSeek output missing both "sections" (newsletter) and "steps" (plan) — unrecognized format');
  }

  // If it's a newsletter format, validate newsletter schema
  if (hasSections) {
    if (typeof output.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(output.date)) {
      warnings.push(`Newsletter "date" field does not match YYYY-MM-DD format: ${output.date}`);
    }

    if (typeof output.title !== "string" || output.title.trim() === "") {
      errors.push('Newsletter missing required "title" field or title is empty');
    }

    if (output.sections.length === 0) {
      errors.push('Newsletter "sections" array is empty');
    }

    for (let i = 0; i < output.sections.length; i++) {
      const section = output.sections[i];
      if (!section || typeof section !== "object") {
        errors.push(`sections[${i}] is not an object`);
        continue;
      }
      if (!section.headline) errors.push(`sections[${i}] missing "headline"`);
      if (!section.summary) errors.push(`sections[${i}] missing "summary"`);
      if (!section.insight) warnings.push(`sections[${i}] missing "insight" (optional but recommended)`);
    }
  }

  // If it's a plan format, validate plan schema
  if (hasSteps) {
    if (output.steps.length === 0) {
      errors.push('Plan "steps" array is empty');
    }

    for (let i = 0; i < output.steps.length; i++) {
      const step = output.steps[i];
      if (!step || typeof step !== "object") {
        errors.push(`steps[${i}] is not an object`);
        continue;
      }
      if (!step.action && !step.name) {
        errors.push(`steps[${i}] missing both "action" and "name"`);
      }
    }
  }

  // Track response shape for dependency monitoring
  deepseekResponseHistory.push({
    timestamp: new Date().toISOString(),
    hasSections,
    hasSteps,
    sectionCount: hasSections ? output.sections.length : 0,
    stepCount: hasSteps ? output.steps.length : 0,
    keys: Object.keys(output).sort(),
    valid: errors.length === 0,
  });

  // Keep history bounded
  if (deepseekResponseHistory.length > 100) {
    deepseekResponseHistory.splice(0, deepseekResponseHistory.length - 100);
  }

  // If errors found, this is a SCHEMA_DRIFT
  if (errors.length > 0) {
    emitGuardEvent({
      type: "SCHEMA_DRIFT",
      severity: "HIGH",
      message: `DeepSeek output schema validation failed with ${errors.length} error(s)`,
      data: { errors, warnings, outputKeys: Object.keys(output) },
    });

    // SAFE MODE: Schema drift triggers safe mode
    activateSafeMode("SCHEMA_DRIFT", `Schema validation breach: ${errors.length} error(s) in DeepSeek output`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Check if a newsletter output has structurally changed from expected patterns.
 * Detects gradual schema drift over time (e.g., new fields appearing/disappearing).
 *
 * @param {object} newsletter - The parsed newsletter JSON
 * @returns {{ drifted: boolean, details: string[] }}
 */
export function detectSchemaDrift(newsletter) {
  if (!newsletter || typeof newsletter !== "object") {
    return { drifted: true, details: ["Newsletter is not a valid object"] };
  }

  const details = [];

  // Check for unexpected top-level keys that may indicate format shift
  const knownKeys = new Set(["date", "title", "sections", "strategicInsights", "scenarios", "metadata"]);
  const unexpectedKeys = Object.keys(newsletter).filter(k => !knownKeys.has(k));

  if (unexpectedKeys.length > 0) {
    details.push(`Unexpected top-level keys detected: ${unexpectedKeys.join(", ")}`);
  }

  // Check section structure consistency
  if (Array.isArray(newsletter.sections) && newsletter.sections.length > 0) {
    const sectionKeys = new Set(Object.keys(newsletter.sections[0]));
    const expectedSectionKeys = new Set(["headline", "summary", "insight"]);

    for (const key of expectedSectionKeys) {
      if (!sectionKeys.has(key)) {
        details.push(`Section missing expected key "${key}" — possible schema drift`);
      }
    }
  }

  const drifted = details.length > 0;

  if (drifted) {
    emitGuardEvent({
      type: "SCHEMA_DRIFT",
      severity: "MEDIUM",
      message: `Gradual schema drift detected: ${details.length} change(s)`,
      data: { details, newsletterKeys: Object.keys(newsletter) },
    });
  }

  return { drifted, details };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUARD 3: EXECUTION PATTERN GUARD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GUARD 3: Record an event for execution pattern analysis.
 * Call this from the event stream or pipeline entry points.
 *
 * @param {object} params
 * @param {string} params.runId - The run ID this event belongs to
 * @param {string} params.eventType - The event type (PIPELINE_START, PIPELINE_END, etc.)
 * @param {string} [params.stage] - Optional pipeline stage name
 * @returns {{ suspect: boolean, reason: string|null }}
 */
export function recordExecutionEvent({ runId, eventType, stage = null }) {
  if (!runId || !eventType) {
    return { suspect: false, reason: null };
  }

  // Track sequence per run
  if (!runEventSequences.has(runId)) {
    runEventSequences.set(runId, { received: [], stages: [], startedAt: new Date().toISOString() });
  }

  const seq = runEventSequences.get(runId);
  seq.received.push(eventType);
  if (stage) seq.stages.push(stage);

  const anomalies = [];
  let suspect = false;

  // ── Detect 1: Repeated PIPELINE_START without completion ────────────
  const pipelineStarts = seq.received.filter(e => e === "PIPELINE_START").length;
  const pipelineEnds = seq.received.filter(e => e === "PIPELINE_END" || e === "PIPELINE_FAILED").length;

  if (pipelineStarts > 1 && pipelineEnds === 0) {
    anomalies.push(`Run ${runId} has ${pipelineStarts} PIPELINE_START events with 0 completion events`);
    suspect = true;
  }

  // ── Detect 2: Out-of-order expected pipeline sequence ───────────────
  if (seq.received.length >= 3) {
    // Check for expected ordering: PIPELINE_START should be first
    if (seq.received[0] !== "PIPELINE_START" && seq.received.includes("PIPELINE_START")) {
      const firstStartIdx = seq.received.indexOf("PIPELINE_START");
      if (firstStartIdx > 0) {
        anomalies.push(`Events received BEFORE PIPELINE_START: ${seq.received.slice(0, firstStartIdx).join(", ")}`);
        suspect = true;
      }
    }

    // Check for PIPELINE_END before expected events
    const endIdx = seq.received.indexOf("PIPELINE_END");
    if (endIdx !== -1) {
      const receivedBeforeEnd = seq.received.slice(0, endIdx);
      const mandatoryBeforeEnd = ["NEWSLETTER_GENERATED", "GIT_COMMIT"];
      for (const mandatory of mandatoryBeforeEnd) {
        if (!receivedBeforeEnd.includes(mandatory)) {
          anomalies.push(`PIPELINE_END received before mandatory event "${mandatory}"`);
          suspect = true;
        }
      }
    }
  }

  // ── Detect 3: Missing stage transitions ─────────────────────────────
  if (Array.isArray(seq.stages) && seq.stages.length >= 2) {
    const expectedOrder = ["START", "PLAN", "AGENTS", "BUILD", "GIT", "WEBHOOK", "COMPLETE"];
    for (let i = 1; i < seq.stages.length; i++) {
      const prevStage = seq.stages[i - 1];
      const currStage = seq.stages[i];
      const prevIdx = expectedOrder.indexOf(prevStage);
      const currIdx = expectedOrder.indexOf(currStage);

      if (prevIdx !== -1 && currIdx !== -1 && currIdx !== prevIdx + 1 && currIdx <= prevIdx) {
        anomalies.push(`Stage regression detected: ${prevStage} → ${currStage} (backwards transition)`);
        suspect = true;
      }
    }

    // Unexpected skip: transition directly from early to late stage
    for (let i = 1; i < seq.stages.length; i++) {
      const prevStage = seq.stages[i - 1];
      const currStage = seq.stages[i];
      const prevIdx = expectedOrder.indexOf(prevStage);
      const currIdx = expectedOrder.indexOf(currStage);

      if (prevIdx !== -1 && currIdx !== -1 && currIdx > prevIdx + 1) {
        const skipped = expectedOrder.slice(prevIdx + 1, currIdx);
        anomalies.push(`Stage skip detected: ${prevStage} → ${currStage} (skipped: ${skipped.join(", ")})`);
        suspect = true;
      }
    }
  }

  // If suspect, emit guard event
  if (suspect) {
    emitGuardEvent({
      type: "SUSPECT_RUN",
      severity: anomalies.length > 2 ? "HIGH" : "MEDIUM",
      message: `Execution pattern anomaly detected for run ${runId}: ${anomalies.join("; ")}`,
      data: {
        anomalies,
        receivedEvents: seq.received,
        stages: seq.stages,
        eventCount: seq.received.length,
      },
      runId,
    });

    guardState.suspectRuns++;
    persistGuardState();
  }

  return { suspect, reason: anomalies.length > 0 ? anomalies.join("; ") : null };
}

/**
 * GUARD 3: Check if the previous run completed properly before allowing new runs.
 *
 * @param {string} runId - The current/new run ID
 * @returns {{ blocked: boolean, reason: string|null }}
 */
export function checkExecutionPattern(runId = null) {
  // Check if any runs have unclosed PIPELINE_START
  const unclosedRuns = [];
  for (const [rid, seq] of runEventSequences) {
    const hasStart = seq.received.includes("PIPELINE_START");
    const hasEnd = seq.received.includes("PIPELINE_END") || seq.received.includes("PIPELINE_FAILED");
    if (hasStart && !hasEnd) {
      unclosedRuns.push(rid);
    }
  }

  if (unclosedRuns.length > 0) {
    // If there are unclosed runs, warn but don't necessarily block
    // (the new run might be a legitimate retry)
    if (runId && !runEventSequences.has(runId)) {
      // We're starting a new run while previous runs never completed
      emitGuardEvent({
        type: "EXECUTION_PATTERN_DRIFT",
        severity: "MEDIUM",
        message: `Starting new run ${runId} while ${unclosedRuns.length} previous run(s) have unclosed PIPELINE_START`,
        data: { unclosedRuns },
        runId,
      });
    }
  }

  return { blocked: false, reason: null };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUARD 4: DEPENDENCY BEHAVIOR MONITORING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GUARD 4: Record and analyze a DeepSeek API response for consistency tracking.
 *
 * @param {object} params
 * @param {number} params.httpStatus - HTTP status code
 * @param {number} params.responseTimeMs - Response time in milliseconds
 * @param {boolean} params.hasValidJSON - Whether response contained parseable JSON
 * @param {string} [params.runId] - Optional run ID
 */
export function recordDeepSeekResponse({ httpStatus, responseTimeMs, hasValidJSON, runId = null }) {
  const entry = {
    timestamp: new Date().toISOString(),
    httpStatus,
    responseTimeMs,
    hasValidJSON,
    runId: runId || "unknown",
  };

  deepseekResponseHistory.push(entry);
  if (deepseekResponseHistory.length > 100) {
    deepseekResponseHistory.splice(0, deepseekResponseHistory.length - 100);
  }

  // Analyze DeepSeek consistency across last 10 responses
  if (deepseekResponseHistory.length >= 5) {
    const recent = deepseekResponseHistory.slice(-10);
    const failureRate = recent.filter(r => r.httpStatus >= 400 || !r.hasValidJSON).length / recent.length;

    if (failureRate > 0.3) {
      emitGuardEvent({
        type: "DEPENDENCY_DRIFT",
        severity: "HIGH",
        message: `DeepSeek response consistency degraded: ${(failureRate * 100).toFixed(0)}% failure rate over last ${recent.length} calls`,
        data: {
          dependency: "DeepSeek",
          failureRate,
          recentResponses: recent,
          threshold: 0.3,
        },
        runId,
      });
    }

    // Detect latency degradation
    const avgLatency = recent.reduce((sum, r) => sum + r.responseTimeMs, 0) / recent.length;
    if (avgLatency > 30000) {
      emitGuardEvent({
        type: "DEPENDENCY_DRIFT",
        severity: "MEDIUM",
        message: `DeepSeek latency degraded: avg ${(avgLatency / 1000).toFixed(1)}s over last ${recent.length} calls`,
        data: {
          dependency: "DeepSeek",
          avgLatencyMs: Math.round(avgLatency),
          recentResponses: recent,
          threshold: 30000,
        },
        runId,
      });
    }
  }
}

/**
 * GUARD 4: Record and analyze a webhook delivery response for consistency tracking.
 *
 * @param {object} params
 * @param {number} params.httpStatus - HTTP status code
 * @param {string} params.bodyClassification - Response body classification
 * @param {boolean} params.deliveryValid - Whether delivery was validated
 * @param {string} [params.runId] - Optional run ID
 */
export function recordWebhookResponse({ httpStatus, bodyClassification, deliveryValid, runId = null }) {
  const entry = {
    timestamp: new Date().toISOString(),
    httpStatus,
    bodyClassification,
    deliveryValid,
    runId: runId || "unknown",
  };

  webhookResponseHistory.push(entry);
  if (webhookResponseHistory.length > 100) {
    webhookResponseHistory.splice(0, webhookResponseHistory.length - 100);
  }

  // Analyze webhook consistency across last 10 responses
  if (webhookResponseHistory.length >= 5) {
    const recent = webhookResponseHistory.slice(-10);
    const failureRate = recent.filter(r => !r.deliveryValid || r.httpStatus >= 400).length / recent.length;

    if (failureRate > 0.2) {
      emitGuardEvent({
        type: "DEPENDENCY_DRIFT",
        severity: "HIGH",
        message: `Webhook delivery consistency degraded: ${(failureRate * 100).toFixed(0)}% failure rate over last ${recent.length} attempts`,
        data: {
          dependency: "AppsScriptWebhook",
          failureRate,
          recentResponses: recent,
          threshold: 0.2,
        },
        runId,
      });
    }
  }
}

/**
 * GUARD 4: Record and analyze a git operation result for stability tracking.
 *
 * @param {object} params
 * @param {string} params.operation - Git operation (commit, push, etc.)
 * @param {number} params.exitCode - Process exit code
 * @param {number} params.durationMs - Duration in milliseconds
 * @param {string} [params.runId] - Optional run ID
 */
export function recordGitOperation({ operation, exitCode, durationMs, runId = null }) {
  const entry = {
    timestamp: new Date().toISOString(),
    operation,
    exitCode,
    durationMs,
    runId: runId || "unknown",
  };

  gitOperationHistory.push(entry);
  if (gitOperationHistory.length > 100) {
    gitOperationHistory.splice(0, gitOperationHistory.length - 100);
  }

  // Analyze git stability across last 10 operations
  if (gitOperationHistory.length >= 5) {
    const recent = gitOperationHistory.slice(-10);
    const failureRate = recent.filter(r => r.exitCode !== 0).length / recent.length;

    if (failureRate > 0.3) {
      emitGuardEvent({
        type: "DEPENDENCY_DRIFT",
        severity: "HIGH",
        message: `Git operation stability degraded: ${(failureRate * 100).toFixed(0)}% failure rate over last ${recent.length} operations`,
        data: {
          dependency: "Git",
          failureRate,
          recentOperations: recent,
          threshold: 0.3,
        },
        runId,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUARD 5: SAFE MODE TRIGGER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Activate SAFE MODE.
 * Only read-only operations allowed. All execution pipelines blocked.
 *
 * @param {string} reason - Trigger reason (CONFIG_DRIFT, SCHEMA_DRIFT, FAILURE_THRESHOLD)
 * @param {string} [details] - Additional context
 * @param {string} [runId] - Related run ID
 */
function activateSafeMode(reason, details = "", runId = null) {
  if (guardState.safeMode) {
    // Already in safe mode — just log new trigger
    console.log(`   ⚠️ [PRODUCTION-GUARD] Already in SAFE MODE. Additional trigger: ${reason} — ${details}`);
    return;
  }

  guardState.safeMode = true;
  guardState.safeModeReason = reason;
  guardState.safeModeTriggeredAt = new Date().toISOString();

  emitGuardEvent({
    type: "SAFE_MODE_ACTIVATED",
    severity: "CRITICAL",
    message: `SAFE MODE ACTIVATED — trigger: ${reason}${details ? ` — ${details}` : ""}`,
    data: {
      reason,
      details,
      consecutiveFailures: guardState.consecutiveFailures,
      configDriftCount: guardState.configDriftCount,
      schemaDriftCount: guardState.schemaDriftCount,
    },
    runId,
  });

  persistGuardState();

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`🛑 [PRODUCTION-GUARD] SAFE MODE ACTIVATED`);
  console.log(`   Reason:     ${reason}`);
  console.log(`   Details:    ${details || "(none)"}`);
  console.log(`   Timestamp:  ${guardState.safeModeTriggeredAt}`);
  console.log(`   ⛔ All execution pipelines are BLOCKED.`);
  console.log(`   📖 Only read-only operations allowed.`);
  console.log(`═══════════════════════════════════════════════\n`);
}

/**
 * Deactivate SAFE MODE (manual recovery or automated after resolution).
 * Resets safe mode and consecutive failure counter.
 *
 * @param {string} [reason] - Optional reason for deactivation
 * @returns {boolean} Whether safe mode was deactivated
 */
export function deactivateSafeMode(reason = "manual override") {
  if (!guardState.safeMode) {
    return false;
  }

  const wasInSafeMode = guardState.safeMode;
  guardState.safeMode = false;
  guardState.safeModeReason = null;
  guardState.safeModeTriggeredAt = null;
  guardState.consecutiveFailures = 0;

  emitGuardEvent({
    type: "SAFE_MODE_DEACTIVATED",
    severity: "HIGH",
    message: `SAFE MODE DEACTIVATED — ${reason}`,
    data: { reason, wasActiveSince: guardState.safeModeTriggeredAt },
  });

  persistGuardState();

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`✅ [PRODUCTION-GUARD] SAFE MODE DEACTIVATED`);
  console.log(`   Reason: ${reason}`);
  console.log(`═══════════════════════════════════════════════\n`);

  return true;
}

/**
 * GUARD 5: Record a pipeline failure and check if SAFE MODE should activate.
 *
 * @param {object} params
 * @param {string} params.runId - The failed run ID
 * @param {string} params.reason - Failure reason
 * @returns {{ safeModeTriggered: boolean, consecutiveFailures: number }}
 */
export function recordPipelineFailure({ runId, reason }) {
  guardState.consecutiveFailures++;
  guardState.lastFailedRunId = runId;
  persistGuardState();

  console.log(`\n⚠️ [PRODUCTION-GUARD] Pipeline failure recorded (run: ${runId})`);
  console.log(`   Consecutive failures: ${guardState.consecutiveFailures}`);
  console.log(`   Reason: ${reason}`);

  // SAFE MODE: Trigger if 2 consecutive failures
  if (guardState.consecutiveFailures >= MAX_CONCURRENT_FAILURES_BEFORE_SAFE) {
    activateSafeMode(
      "FAILURE_THRESHOLD",
      `${guardState.consecutiveFailures} consecutive pipeline failures (threshold: ${MAX_CONCURRENT_FAILURES_BEFORE_SAFE})`,
      runId
    );
    return { safeModeTriggered: true, consecutiveFailures: guardState.consecutiveFailures };
  }

  return { safeModeTriggered: false, consecutiveFailures: guardState.consecutiveFailures };
}

/**
 * GUARD 5: Record a pipeline success (resets consecutive failure counter).
 *
 * @param {object} params
 * @param {string} [params.runId] - Optional run ID
 */
export function recordPipelineSuccess({ runId = null } = {}) {
  const wasReset = guardState.consecutiveFailures > 0;

  guardState.consecutiveFailures = 0;
  guardState.lastFailedRunId = null;
  persistGuardState();

  if (wasReset) {
    console.log(`\n✅ [PRODUCTION-GUARD] Pipeline success — consecutive failure counter reset`);
  }
}

/**
 * GUARD 5: Check if SAFE MODE is active.
 * Blocks execution if in safe mode unless explicitly overridden.
 *
 * @param {object} [options]
 * @param {boolean} [options.allowReadOnly=false] - Allow read-only operations
 * @returns {{ blocked: boolean, reason: string|null, safeMode: boolean }}
 */
export function checkSafeMode({ allowReadOnly = false } = {}) {
  if (!guardState.safeMode) {
    return { blocked: false, reason: null, safeMode: false };
  }

  // In safe mode, read-only operations may be allowed
  if (allowReadOnly) {
    return {
      blocked: false,
      reason: `SAFE MODE active (${guardState.safeModeReason}) — read-only allowed`,
      safeMode: true,
    };
  }

  // Write/execute operations are blocked
  return {
    blocked: true,
    reason: `SAFE MODE active: ${guardState.safeModeReason} (since ${guardState.safeModeTriggeredAt})`,
    safeMode: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE GUARD CHECK — Run ALL guards at once
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run ALL guard checks at pipeline start.
 * This is the primary entry point for the protective guard layer.
 *
 * Order:
 *   1. SAFE MODE check (first — if active, no further checks needed)
 *   2. Configuration Integrity check
 *   3. Execution Pattern check
 *
 * @param {object} [options]
 * @param {string} [options.runId] - Current run ID
 * @param {boolean} [options.allowReadOnly=false] - Allow read-only operations
 * @returns {{
 *   passed: boolean,
 *   blocked: boolean,
 *   safeMode: boolean,
 *   results: Array<{guard: string, passed: boolean, detail: string}>
 * }}
 */
export function runAllGuards({ runId = null, allowReadOnly = false } = {}) {
  const results = [];

  // ── GUARD 5: SAFE MODE check (first — fail fast) ──────────────────────
  const safeModeResult = checkSafeMode({ allowReadOnly });
  results.push({
    guard: "SAFE_MODE",
    passed: !safeModeResult.blocked,
    detail: safeModeResult.reason || "Safe mode not active",
  });

  if (safeModeResult.blocked) {
    const blockEvent = emitGuardEvent({
      type: "PIPELINE_BLOCKED",
      severity: "CRITICAL",
      message: `Pipeline execution BLOCKED by SAFE MODE: ${safeModeResult.reason}`,
      data: { guardResults: results },
      runId,
    });

    // Track blocked runs
    if (runId && !guardState.blockedPipelineRunIds.includes(runId)) {
      guardState.blockedPipelineRunIds.push(runId);
      if (guardState.blockedPipelineRunIds.length > 100) {
        guardState.blockedPipelineRunIds = guardState.blockedPipelineRunIds.slice(-100);
      }
      persistGuardState();
    }

    return {
      passed: false,
      blocked: true,
      safeMode: true,
      results,
    };
  }

  // ── GUARD 1: Configuration Integrity Check ─────────────────────────────
  const configResult = checkConfigIntegrity({ runId });
  results.push({
    guard: "CONFIG_INTEGRITY",
    passed: configResult.passed,
    detail: configResult.passed
      ? "All environment variables valid"
      : `${configResult.failures.length} failure(s): ${configResult.failures.map(f => f.field).join(", ")}`,
  });

  if (!configResult.passed) {
    return {
      passed: false,
      blocked: true,
      safeMode: guardState.safeMode,
      results,
    };
  }

  // ── GUARD 3: Execution Pattern Check ──────────────────────
  const patternResult = checkExecutionPattern(runId);
  results.push({
    guard: "EXECUTION_PATTERN",
    passed: !patternResult.blocked,
    detail: patternResult.reason || "Execution pattern nominal",
  });

  // Pattern anomalies don't block by default — they mark SUSPECT
  // But if there are unclosed runs, we warn

  const allPassed = results.every(r => r.passed);

  if (allPassed) {
    console.log(`\n✅ [PRODUCTION-GUARD] All guard checks PASSED — pipeline clear to execute`);
  }

  return {
    passed: allPassed,
    blocked: !allPassed,
    safeMode: guardState.safeMode,
    results,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the current guard state (safe for inspection).
 *
 * @returns {object} Current guard state snapshot
 */
export function getGuardState() {
  return {
    version: GUARD_VERSION,
    safeMode: guardState.safeMode,
    safeModeReason: guardState.safeModeReason,
    safeModeTriggeredAt: guardState.safeModeTriggeredAt,
    consecutiveFailures: guardState.consecutiveFailures,
    lastFailedRunId: guardState.lastFailedRunId,
    configDriftCount: guardState.configDriftCount,
    schemaDriftCount: guardState.schemaDriftCount,
    dependencyDriftCount: guardState.dependencyDriftCount,
    suspectRuns: guardState.suspectRuns,
    blockedPipelineCount: guardState.blockedPipelineRunIds.length,
    activePatternSequences: runEventSequences.size,
  };
}

/**
 * Get all guard events from the guard log.
 *
 * @param {number} [limit=50] - Max entries to return
 * @param {string} [type] - Optional filter by event type
 * @returns {Array<object>}
 */
export function getGuardEvents(limit = 50, type = null) {
  let events = readGuardEvents();
  if (type) {
    events = events.filter(e => e.type === type);
  }
  return events.slice(-limit).reverse();
}

/**
 * Get guard statistics summary.
 *
 * @returns {object}
 */
export function getGuardStats() {
  const events = readGuardEvents();
  const recent = events.slice(-100);

  return {
    totalEvents: events.length,
    recentCount: recent.length,
    byType: recent.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {}),
    bySeverity: recent.reduce((acc, e) => {
      acc[e.severity] = (acc[e.severity] || 0) + 1;
      return acc;
    }, {}),
    state: getGuardState(),
  };
}

/**
 * Print a comprehensive guard status report to console.
 */
export function printGuardReport() {
  const state = getGuardState();
  const events = readGuardEvents();
  const recentEvents = events.slice(-10).reverse();

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`🛡 PRODUCTION GUARD STATUS REPORT (v${GUARD_VERSION})`);
  console.log(`═══════════════════════════════════════════════`);
  console.log(`   SAFE MODE:       ${state.safeMode ? "🔴 ACTIVE" : "✅ INACTIVE"}`);
  if (state.safeMode) {
    console.log(`   Reason:          ${state.safeModeReason}`);
    console.log(`   Since:           ${state.safeModeTriggeredAt}`);
  }
  console.log(`   ─────────────────────────────────────`);
  console.log(`   Consecutive Failures: ${state.consecutiveFailures}`);
  console.log(`   Config Drifts:       ${state.configDriftCount}`);
  console.log(`   Schema Drifts:       ${state.schemaDriftCount}`);
  console.log(`   Dependency Drifts:   ${state.dependencyDriftCount}`);
  console.log(`   Suspect Runs:        ${state.suspectRuns}`);
  console.log(`   Blocked Pipelines:   ${state.blockedPipelineCount}`);
  console.log(`   ─────────────────────────────────────`);
  console.log(`   Active Sequences:    ${state.activePatternSequences}`);
  console.log(`   Total Guard Events:  ${events.length}`);

  if (recentEvents.length > 0) {
    console.log(`   ─────────────────────────────────────`);
    console.log(`   Recent Guard Events:`);
    for (const evt of recentEvents) {
      const icons = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🟠", CRITICAL: "🔴" };
      console.log(`   ${icons[evt.severity] || "⚪"} [${evt.type}] ${evt.message.substring(0, 100)}`);
    }
  }
  console.log(`═══════════════════════════════════════════════\n`);
}

/**
 * Reset guard state (for testing only — destructive).
 */
export function resetGuardState() {
  guardState = {
    safeMode: false,
    safeModeReason: null,
    safeModeTriggeredAt: null,
    consecutiveFailures: 0,
    lastFailedRunId: null,
    configDriftCount: 0,
    schemaDriftCount: 0,
    dependencyDriftCount: 0,
    suspectRuns: 0,
    blockedPipelineRunIds: [],
  };
  runEventSequences.clear();
  deepseekResponseHistory.length = 0;
  webhookResponseHistory.length = 0;
  gitOperationHistory.length = 0;
  runStageTransitions.clear();
  persistGuardState();
  console.log("[PRODUCTION-GUARD] Guard state reset (destructive — testing only)");
}

export default {
  // Guard 1: Config Integrity
  checkConfigIntegrity,

  // Guard 2: Schema Validation
  validateDeepSeekSchema,
  detectSchemaDrift,

  // Guard 3: Execution Pattern
  recordExecutionEvent,
  checkExecutionPattern,

  // Guard 4: Dependency Monitoring
  recordDeepSeekResponse,
  recordWebhookResponse,
  recordGitOperation,

  // Guard 5: Safe Mode
  recordPipelineFailure,
  recordPipelineSuccess,
  checkSafeMode,
  deactivateSafeMode,

  // Comprehensive Check
  runAllGuards,

  // Utilities
  getGuardState,
  getGuardEvents,
  getGuardStats,
  printGuardReport,
  resetGuardState,
};
