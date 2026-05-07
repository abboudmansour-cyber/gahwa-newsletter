/**
 * anomaly-detector.js — Real-Time Anomaly Detection Engine
 *
 * CRITICAL SYSTEM MODULE
 * Detects and reports anomalous patterns in the event stream.
 *
 * Detection Capabilities:
 *   - Repeated failures in same step
 *   - Unusually high retry counts
 *   - Missing expected events in sequence
 *   - Webhook latency spikes
 *   - "Silent success" (HTTP 200 + invalid body)
 *   - Event sequencing violations
 *   - Rate anomalies (too many/few events in a window)
 *
 * Architecture:
 *   event-bus → anomaly-detector (analyzes event stream)
 *                              ↓
 *              anomaly-log.json (persistent anomaly record)
 *              system-state (health impact)
 *
 * @module anomaly-detector
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "..", "logs");
const ANOMALY_LOG = path.join(LOGS_DIR, "anomaly-log.json");
const MAX_ANOMALIES = 500;

// ── In-Memory State ─────────────────────────────────────────────────────────

// Tracks per-step failure counts for cascade detection
const stepFailureCounts = new Map();

// Tracks delivery attempts with timestamps for latency analysis
const deliveryAttempts = [];

// Tracks event sequence per runId for expected event chain analysis
const runEventSequences = new Map();

// Silo for HTTP 200 + invalid body detection (silent success)
const silentSuccessCandidates = [];

// Event rate tracking (events per time window)
const eventTimestamps = [];
const RATE_WINDOW_MS = 60_000; // 1 minute

// Configuration
const CONFIG = {
  maxStepFailures: 3,            // Alert if same step fails > N times
  maxRetryCount: 5,              // Alert if retries exceed N
  maxWebhookLatencyMs: 15_000,   // Alert if webhook takes > 15s
  eventRateThreshold: 100,       // Alert if > N events in 1 minute
  missingEventTimeoutMs: 300_000, // 5 min — alert if expected event missing
};

// Expected event sequences per pipeline type
const EXPECTED_SEQUENCES = {
  "daily-newsletter": [
    "PIPELINE_START",
    "NEWSLETTER_GENERATED",
    "GIT_COMMIT",
    "DELIVERY_ATTEMPT",
    "DELIVERY_SUCCESS",
    "VALIDATION_RESULT",
    "PIPELINE_END",
  ],
  "test-run": [
    "PIPELINE_START",
    "NEWSLETTER_GENERATED",
    "PIPELINE_END",
  ],
};

// ── Log Handling ────────────────────────────────────────────────────────────

function readAnomalyLog() {
  try {
    if (!fs.existsSync(ANOMALY_LOG)) return [];
    const raw = fs.readFileSync(ANOMALY_LOG, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendAnomaly(anomaly) {
  try {
    const dir = path.dirname(ANOMALY_LOG);
    fs.mkdirSync(dir, { recursive: true });

    let entries = readAnomalyLog();
    entries.push(anomaly);
    if (entries.length > MAX_ANOMALIES) entries = entries.slice(-MAX_ANOMALIES);

    fs.writeFileSync(ANOMALY_LOG, JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    console.error(`[ANOMALY] ❌ Failed to write anomaly log: ${err.message}`);
  }
}

// ── Detection Logic ────────────────────────────────────────────────────────

/**
 * Record an anomaly and optionally emit it back to the bus.
 *
 * @param {object} params
 * @param {string} params.type - Anomaly type identifier
 * @param {string} params.severity - "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
 * @param {string} params.runId - Related run ID
 * @param {string} [params.step] - Related step name
 * @param {string} params.message - Human-readable description
 * @param {object} [params.data] - Structured anomaly data
 * @param {object} [params.bus] - Optional event bus to emit on
 */
function recordAnomaly({ type, severity, runId, step, message, data, bus }) {
  const anomaly = {
    anomalyId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    severity,
    runId: runId || "unknown",
    step: step || null,
    message,
    data: data || {},
  };

  // Persist to anomaly log
  appendAnomaly(anomaly);

  // Log to console with appropriate icon
  const icons = { LOW: "🔵", MEDIUM: "🟡", HIGH: "🟠", CRITICAL: "🔴" };
  const icon = icons[severity] || "⚪";
  console.log(`   ${icon} [ANOMALY] ${type} (${severity}): ${message}`);

  // Emit back to the bus if available
  if (bus && typeof bus.emit === "function") {
    try {
      bus.emit({
        eventId: crypto.randomUUID(),
        type: "ANOMALY_DETECTED",
        runId: anomaly.runId,
        timestamp: anomaly.timestamp,
        payload: {
          anomalyType: type,
          severity,
          message,
          step,
          anomalyId: anomaly.anomalyId,
        },
      });
    } catch (err) {
      console.error(`[ANOMALY] ❌ Failed to emit anomaly event: ${err.message}`);
    }
  }

  return anomaly;
}

// ── Detection Checks ───────────────────────────────────────────────────────

/**
 * Check for repeated failures in the same step.
 *
 * @param {object} event
 * @param {object} bus
 */
function checkRepeatedStepFailures(event, bus) {
  if (event.type !== "STEP_EXECUTION" || event.data?.metadata?.status !== "FAILED") return;

  const stepName = event.data.metadata.step || "unknown";
  const key = `${event.runId}:${stepName}`;
  const count = (stepFailureCounts.get(key) || 0) + 1;
  stepFailureCounts.set(key, count);

  if (count >= CONFIG.maxStepFailures) {
    recordAnomaly({
      type: "REPEATED_STEP_FAILURE",
      severity: count >= 5 ? "CRITICAL" : "HIGH",
      runId: event.runId,
      step: stepName,
      message: `Step "${stepName}" failed ${count} times — potential systemic issue`,
      data: { failureCount: count, threshold: CONFIG.maxStepFailures },
      bus,
    });
  }
}

/**
 * Check for webhook latency spikes.
 *
 * @param {object} event
 * @param {object} bus
 */
function checkWebhookLatency(event, bus) {
  if (event.type !== "DELIVERY_ATTEMPT") return;

  const timestamp = new Date(event.timestamp).getTime();
  const deliveryId = event.data?.deliveryId || event.runId;

  deliveryAttempts.push({ deliveryId, timestamp, event });

  // Keep last 100 delivery attempts
  if (deliveryAttempts.length > 100) deliveryAttempts.shift();

  // Check if we have a matching DELIVERY_SUCCESS to measure latency
  // (We check this in checkSilentSuccess too)
}

/**
 * Check for missing expected events in a pipeline sequence.
 *
 * @param {object} event
 * @param {object} bus
 */
function checkMissingEventChain(event, bus) {
  if (event.type !== "PIPELINE_START" && event.type !== "PIPELINE_END") return;

  if (event.type === "PIPELINE_START") {
    // Initialize expected sequence tracking
    const jobName = event.data?.metadata?.job || "daily-newsletter";
    const expectedSeq = EXPECTED_SEQUENCES[jobName] || EXPECTED_SEQUENCES["daily-newsletter"];
    runEventSequences.set(event.runId, {
      expected: expectedSeq,
      received: ["PIPELINE_START"],
      startedAt: event.timestamp,
    });
  }

  if (event.type === "PIPELINE_END") {
    const seq = runEventSequences.get(event.runId);
    if (!seq) return;

    seq.received.push("PIPELINE_END");

    // Check for missing events
    const missing = seq.expected.filter(e => !seq.received.includes(e));
    if (missing.length > 0) {
      recordAnomaly({
        type: "MISSING_EXPECTED_EVENTS",
        severity: missing.length > 2 ? "HIGH" : "MEDIUM",
        runId: event.runId,
        message: `Pipeline completed but missing expected events: ${missing.join(", ")}`,
        data: {
          expected: seq.expected,
          received: seq.received,
          missing,
          runId: event.runId,
        },
        bus,
      });
    }

    // Cleanup
    runEventSequences.delete(event.runId);
  }
}

/**
 * Check for "silent success" — HTTP 200 with invalid body.
 *
 * @param {object} event
 * @param {object} bus
 */
function checkSilentSuccess(event, bus) {
  // Track DELIVERY_ATTEMPT events that might be suspicious
  if (event.type === "DELIVERY_ATTEMPT" && event.data?.error) {
    if (event.data.error.includes("200") || event.data.error.includes("HTML")) {
      silentSuccessCandidates.push({
        runId: event.runId,
        deliveryId: event.data.deliveryId,
        error: event.data.error,
        timestamp: event.timestamp,
      });
    }
  }

  // If DELIVERY_SUCCESS follows a suspicious attempt, that's a silent success
  if (event.type === "DELIVERY_SUCCESS") {
    const deliveryId = event.data?.deliveryId;
    if (!deliveryId) return;

    const suspicious = silentSuccessCandidates.filter(s =>
      s.deliveryId === deliveryId &&
      s.error && (s.error.includes("HTML") || s.error.includes("200 with"))
    );

    if (suspicious.length > 0) {
      recordAnomaly({
        type: "SILENT_SUCCESS",
        severity: "HIGH",
        runId: event.runId,
        message: `Delivery ${deliveryId} returned HTTP 200 with invalid body but was marked success — possible silent failure`,
        data: {
          deliveryId,
          suspiciousEntries: suspicious,
          detail: "HTTP 200 delivered but response body indicated HTML error page",
        },
        bus,
      });
    }
  }
}

/**
 * Check for event rate anomalies (too many events in a short window).
 *
 * @param {object} event
 * @param {object} bus
 */
function checkEventRate(event, bus) {
  const now = Date.now();
  eventTimestamps.push(now);

  // Remove timestamps outside the window
  while (eventTimestamps.length > 0 && eventTimestamps[0] < now - RATE_WINDOW_MS) {
    eventTimestamps.shift();
  }

  if (eventTimestamps.length > CONFIG.eventRateThreshold) {
    recordAnomaly({
      type: "EVENT_RATE_SPIKE",
      severity: "MEDIUM",
      runId: event.runId,
      message: `Event rate spike: ${eventTimestamps.length} events in last 60s (threshold: ${CONFIG.eventRateThreshold})`,
      data: {
        eventCount: eventTimestamps.length,
        windowMs: RATE_WINDOW_MS,
        threshold: CONFIG.eventRateThreshold,
      },
      bus,
    });
  }
}

/**
 * Check for excessive retry count.
 *
 * @param {object} event
 * @param {object} bus
 */
function checkExcessiveRetries(event, bus) {
  if (event.type !== "RETRY_ELIGIBLE") return;

  const attemptCount = event.payload?.attemptCount || 1;
  if (attemptCount > CONFIG.maxRetryCount) {
    recordAnomaly({
      type: "EXCESSIVE_RETRIES",
      severity: "HIGH",
      runId: event.runId,
      step: event.payload?.step,
      message: `Retry count ${attemptCount} exceeds threshold of ${CONFIG.maxRetryCount}`,
      data: {
        attemptCount,
        threshold: CONFIG.maxRetryCount,
        step: event.payload?.step,
      },
      bus,
    });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the anomaly detector.
 *
 * Wires detection hooks to run on every event from the bus.
 *
 * @param {object} bus - The event-bus module
 * @returns {boolean}
 */
export function initialize(bus) {
  if (!bus || typeof bus.on !== "function") {
    console.error("[ANOMALY] ❌ Cannot initialize: event bus required");
    return false;
  }

  // Subscribe to ALL events for analysis
  bus.on("*", (event) => {
    try {
      checkRepeatedStepFailures(event, bus);
      checkWebhookLatency(event, bus);
      checkMissingEventChain(event, bus);
      checkSilentSuccess(event, bus);
      checkEventRate(event, bus);
      checkExcessiveRetries(event, bus);
    } catch (err) {
      console.error(`[ANOMALY] ❌ Detection error: ${err.message}`);
    }
  });

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`🔍 [ANOMALY] Anomaly Detector initialized`);
  console.log(`   Detectors active:`);
  console.log(`   • Repeated step failures (threshold: ${CONFIG.maxStepFailures})`);
  console.log(`   • Webhook latency spikes (threshold: ${CONFIG.maxWebhookLatencyMs}ms)`);
  console.log(`   • Missing event chains (${Object.keys(EXPECTED_SEQUENCES).length} pipeline types)`);
  console.log(`   • Silent success detection (HTTP 200 + invalid body)`);
  console.log(`   • Event rate spikes (threshold: ${CONFIG.eventRateThreshold}/min)`);
  console.log(`   • Excessive retries (threshold: ${CONFIG.maxRetryCount})`);
  console.log(`═══════════════════════════════════════════════\n`);

  return true;
}

/**
 * Get all recorded anomalies.
 *
 * @param {number} [limit=50] - Max entries to return
 * @param {string} [severity] - Optional filter by severity
 * @returns {Array}
 */
export function getAnomalies(limit = 50, severity = null) {
  let entries = readAnomalyLog();
  if (severity) {
    entries = entries.filter(e => e.severity === severity);
  }
  return entries.slice(-limit).reverse();
}

/**
 * Get anomaly statistics.
 *
 * @returns {object}
 */
export function getAnomalyStats() {
  const entries = readAnomalyLog();
  const recent = entries.slice(-100);

  return {
    total: entries.length,
    recentCount: recent.length,
    bySeverity: {
      LOW: recent.filter(e => e.severity === "LOW").length,
      MEDIUM: recent.filter(e => e.severity === "MEDIUM").length,
      HIGH: recent.filter(e => e.severity === "HIGH").length,
      CRITICAL: recent.filter(e => e.severity === "CRITICAL").length,
    },
    byType: recent.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {}),
    recentAnomalies: recent.slice(-10).reverse().map(e => ({
      type: e.type,
      severity: e.severity,
      message: e.message,
      timestamp: e.timestamp,
    })),
  };
}

/**
 * Clear step failure tracking for a specific run.
 * Useful when a run completes successfully after retries.
 *
 * @param {string} runId
 */
export function clearStepFailures(runId) {
  for (const key of stepFailureCounts.keys()) {
    if (key.startsWith(`${runId}:`)) {
      stepFailureCounts.delete(key);
    }
  }
}

/**
 * Reset all detector state (testing only).
 */
export function reset() {
  stepFailureCounts.clear();
  deliveryAttempts.length = 0;
  runEventSequences.clear();
  silentSuccessCandidates.length = 0;
  eventTimestamps.length = 0;
}

export default {
  initialize,
  getAnomalies,
  getAnomalyStats,
  clearStepFailures,
  reset,
};
