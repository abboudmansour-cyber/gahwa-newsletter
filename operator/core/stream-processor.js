/**
 * stream-processor.js — Real-Time Stream Processor Engine
 *
 * CRITICAL SYSTEM MODULE
 * This is the "real-time brain" that subscribes to the event bus
 * and runs instant rules, triggers recovery, detects anomalies,
 * and updates system state live.
 *
 * Architecture:
 *   event-bus (broadcast) → stream-processor (rules engine)
 *                              ↓
 *   ├── logger           (log events)
 *   ├── evaluator        (evaluate pipeline)
 *   ├── recovery         (trigger auto-recovery)
 *   ├── anomaly-detector (analyze patterns)
 *   ├── delivery-val     (validate delivery results)
 *   └── metrics-updater  (update system state)
 *
 * @module stream-processor
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "..", "logs");
const TRUTH_LOG = path.join(LOGS_DIR, "truth-log.json");

// ── Module-level state ─────────────────────────────────────────────────────
// Store event-bus reference so we can emit events from within rules
let eventBus = null;

// ── Rule Registry ──────────────────────────────────────────────────────────
// All rules are registered here. Rules run in order of registration.
const rules = [];

// ── Subscriber IDs (for cleanup) ───────────────────────────────────────────
let busSubscriptions = [];

// ── Rule Engine ─────────────────────────────────────────────────────────────

/**
 * Register a stream processing rule.
 *
 * A rule is an object with:
 *   - name:        Human-readable rule name (for logging)
 *   - predicate:   Function (event) => boolean — whether the rule should fire
 *   - handler:     Async function (event, bus) => void — the rule action
 *   - priority:    Optional number (higher = runs first, default 0)
 *
 * @param {object} ruleDef
 * @param {string} ruleDef.name
 * @param {Function} ruleDef.predicate - (event) => boolean
 * @param {Function} ruleDef.handler - async (event, bus) => void
 * @param {number} [ruleDef.priority=0]
 */
export function registerRule({ name, predicate, handler, priority = 0 }) {
  if (!name || typeof predicate !== "function" || typeof handler !== "function") {
    console.error(`[STREAM-PROC] ❌ Invalid rule definition for "${name}"`);
    return;
  }

  rules.push({ name, predicate, handler, priority });
  // Sort by priority descending
  rules.sort((a, b) => b.priority - a.priority);

  console.log(`   📋 [STREAM-PROC] Rule registered: "${name}" (priority ${priority})`);
}

/**
 * Remove a registered rule by name.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function unregisterRule(name) {
  const idx = rules.findIndex(r => r.name === name);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  console.log(`   🗑️ [STREAM-PROC] Rule unregistered: "${name}"`);
  return true;
}

// ── Event Handlers ──────────────────────────────────────────────────────────

/**
 * Core event handler — runs when ANY event is emitted on the bus.
 * Evaluates all rules and fires matching ones.
 *
 * @param {object} event
 */
async function onAnyEvent(event) {
  if (!event || !event.type) return;

  const matchingRules = rules.filter(r => r.predicate(event));

  for (const rule of matchingRules) {
    try {
      console.log(`   ⚡ [STREAM-PROC] Rule "${rule.name}" fired for ${event.type}`);
      await rule.handler(event, eventBus);
    } catch (err) {
      console.error(`   ❌ [STREAM-PROC] Rule "${rule.name}" error: ${err.message}`);
    }
  }
}

// ── Built-in Rules ─────────────────────────────────────────────────────────

function registerBuiltinRules() {
  // ═══════════════════════════════════════════════════════════════════════
  // RULE 1: Webhook failure detection
  // ═══════════════════════════════════════════════════════════════════════
  registerRule({
    name: "webhook-failure-detection",
    priority: 100,
    predicate: (event) =>
      event.type === "DELIVERY_ATTEMPT" &&
      event.data &&
      event.data.error &&
      !event.data.error.includes("200"),
    handler: async (event, bus) => {
      console.log(`   🔁 [STREAM-PROC] Webhook failure detected for run ${event.runId}`);

      // Emit a recovery-triggering event
      if (bus) {
        bus.emit({
          eventId: crypto.randomUUID(),
          type: "RECOVERY_TRIGGERED",
          runId: event.runId,
          timestamp: new Date().toISOString(),
          payload: {
            reason: "WEBHOOK_FAILURE",
            error: event.data.error,
            deliveryId: event.data.deliveryId,
          },
        });
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RULE 2: LLM error detection (DeepSeek failures)
  // ═══════════════════════════════════════════════════════════════════════
  registerRule({
    name: "llm-error-retry",
    priority: 90,
    predicate: (event) =>
      event.type === "ERROR" &&
      event.data &&
      event.data.error &&
      (event.data.error.includes("DeepSeek") ||
       event.data.error.includes("LLM") ||
       event.data.error.includes("deepseek")),
    handler: async (event, bus) => {
      console.log(`   🔁 [STREAM-PROC] LLM error detected — triggering strict schema retry for ${event.runId}`);

      // Log to truth-log for audit
      appendToTruthLog({
        type: "LLM_ERROR",
        runId: event.runId,
        error: event.data.error,
        action: "RETRY_WITH_STRICT_SCHEMA",
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RULE 3: Missing doPost detection
  // ═══════════════════════════════════════════════════════════════════════
  registerRule({
    name: "missing-dopost-detection",
    priority: 95,
    predicate: (event) => {
      if (event.type !== "ERROR" && event.type !== "DELIVERY_ATTEMPT") return false;
      const errorMsg = event.data?.error || event.data?.metadata?.error || "";
      return (
        errorMsg.includes("doPost missing") ||
        errorMsg.includes("MISSING_DOPOST") ||
        errorMsg.includes("doPost") ||
        (event.data?.metadata?.classification === "MISSING_DOPOST")
      );
    },
    handler: async (event, bus) => {
      console.log(`   🚨 [STREAM-PROC] CRITICAL: doPost missing detected for delivery ${event.data?.deliveryId || "unknown"}`);
      console.log(`   🚨 [STREAM-PROC] Marking deployment as BROKEN — doPost handler not deployed`);

      // Mark system health as degraded
      if (bus) {
        bus.emit({
          eventId: crypto.randomUUID(),
          type: "DEPLOYMENT_BROKEN",
          runId: event.runId,
          timestamp: new Date().toISOString(),
          payload: {
            reason: "DOPOST_MISSING",
            deliveryId: event.data?.deliveryId,
            error: event.data?.error,
          },
        });
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RULE 4: System health degradation
  // ═══════════════════════════════════════════════════════════════════════
  registerRule({
    name: "system-health-monitor",
    priority: 50,
    predicate: (event) =>
      event.type === "ERROR" || event.type === "RECOVERY_EVENT",
    handler: async (event, bus) => {
      // Get the current system state from the bus
      if (!bus || typeof bus.getSystemState !== "function") return;

      const state = bus.getSystemState();
      if (state.systemHealth === "RED") {
        console.log(`   🛑 [STREAM-PROC] System health RED — ${state.consecutiveFailures} consecutive failures, ${(state.failureRate * 100).toFixed(0)}% failure rate`);
      } else if (state.systemHealth === "YELLOW") {
        console.log(`   ⚠️ [STREAM-PROC] System health YELLOW — elevated failure rate`);
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RULE 5: Step failure cascade detection
  // ═══════════════════════════════════════════════════════════════════════
  registerRule({
    name: "step-failure-cascade",
    priority: 80,
    predicate: (event) =>
      event.type === "STEP_EXECUTION" &&
      event.data?.metadata?.status === "FAILED",
    handler: async (event, bus) => {
      console.log(`   ⚡ [STREAM-PROC] Step "${event.data?.metadata?.step}" failed for run ${event.runId}`);

      // Check if this is a retry-eligible failure
      const errorMsg = event.data?.metadata?.error || "";
      const isTransient = /timeout|network|econnrefused|rate limit|502|503|429/i.test(errorMsg);

      if (isTransient && bus) {
        console.log(`   ⚡ [STREAM-PROC] Transient failure — eligible for retry`);
        bus.emit({
          eventId: crypto.randomUUID(),
          type: "RETRY_ELIGIBLE",
          runId: event.runId,
          timestamp: new Date().toISOString(),
          payload: {
            step: event.data?.metadata?.step,
            error: errorMsg,
            attemptCount: event.data?.metadata?.attemptCount || 1,
          },
        });
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RULE 6: Delivery success monitoring
  // ═══════════════════════════════════════════════════════════════════════
  registerRule({
    name: "delivery-success-monitor",
    priority: 60,
    predicate: (event) =>
      event.type === "DELIVERY_SUCCESS" || event.type === "DELIVERY_DUPLICATE",
    handler: async (event, bus) => {
      console.log(`   ✅ [STREAM-PROC] Delivery ${event.type === "DELIVERY_SUCCESS" ? "successful" : "duplicate (idempotent)"} for ${event.data?.deliveryId || event.runId}`);
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RULE 7: Pipeline lifecycle logging
  // ═══════════════════════════════════════════════════════════════════════
  registerRule({
    name: "pipeline-lifecycle",
    priority: 30,
    predicate: (event) =>
      event.type === "PIPELINE_START" || event.type === "PIPELINE_END",
    handler: async (event, bus) => {
      const isStart = event.type === "PIPELINE_START";
      console.log(`   ${isStart ? "🚀" : "🎯"} [STREAM-PROC] Pipeline ${isStart ? "START" : "END"} — run ${event.runId}`);
    },
  });
}

// ── Truth Log Helper ────────────────────────────────────────────────────────

function appendToTruthLog(entry) {
  try {
    const dir = path.dirname(TRUTH_LOG);
    fs.mkdirSync(dir, { recursive: true });

    let entries = [];
    if (fs.existsSync(TRUTH_LOG)) {
      try {
        entries = JSON.parse(fs.readFileSync(TRUTH_LOG, "utf-8"));
        if (!Array.isArray(entries)) entries = [];
      } catch {
        entries = [];
      }
    }

    entries.push({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
      source: "stream-processor",
    });

    // Keep last 500 entries
    if (entries.length > 500) entries = entries.slice(-500);

    fs.writeFileSync(TRUTH_LOG, JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    console.error(`[STREAM-PROC] ❌ Failed to write truth log: ${err.message}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the stream processor.
 *
 * Wires:
 *   - All built-in rules
 *   - Subscription to the event bus for ALL events
 *   - Recovery state persistence
 *
 * @param {object} bus - The event-bus module (must have .on(), .emit(), getSystemState())
 * @returns {boolean} Whether initialization was successful
 */
export function initialize(bus) {
  if (!bus || typeof bus.on !== "function") {
    console.error("[STREAM-PROC] ❌ Cannot initialize: event bus required with .on() method");
    return false;
  }

  eventBus = bus;

  // Register built-in rules
  registerBuiltinRules();

  // Subscribe to ALL events on the bus
  const subId = bus.on("*", onAnyEvent);
  busSubscriptions.push(subId);

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`⚡ [STREAM-PROC] Stream Processor initialized`);
  console.log(`   Rules registered: ${rules.length}`);
  console.log(`   Bus subscribers:  ${busSubscriptions.length}`);
  console.log(`═══════════════════════════════════════════════\n`);

  return true;
}

/**
 * Shut down the stream processor cleanly.
 * Unsubscribes from the event bus and clears rules.
 */
export function shutdown() {
  // Unsubscribe from bus
  if (eventBus && typeof eventBus.unsubscribe === "function") {
    for (const id of busSubscriptions) {
      eventBus.unsubscribe(id);
    }
  }
  busSubscriptions = [];

  // Clear rules
  rules.length = 0;
  eventBus = null;

  console.log("[STREAM-PROC] Stream Processor shut down");
}

/**
 * Get all registered rules (for inspection/debugging).
 *
 * @returns {Array<{name: string, priority: number}>}
 */
export function getRegisteredRules() {
  return rules.map(r => ({
    name: r.name,
    priority: r.priority,
  }));
}

// Need crypto for event ID generation in handlers
import crypto from "crypto";

export default {
  initialize,
  shutdown,
  registerRule,
  unregisterRule,
  getRegisteredRules,
};
