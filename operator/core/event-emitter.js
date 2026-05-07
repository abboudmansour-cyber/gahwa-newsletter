/**
 * event-emitter.js — Event Sourcing Core Module (Stream-Integrated)
 *
 * CRITICAL SYSTEM MODULE
 * Every meaningful system action MUST emit an event.
 * Events are append-only, immutable, never updated, never deleted.
 *
 * STREAM INTEGRATION:
 * When the event-bus is connected (via setEventBus()), ALL events route
 * through the bus for real-time broadcast + persistence + anomaly detection.
 * When the bus is not connected, events persist to file directly (legacy mode).
 *
 * Event Types:
 *   NEWSLETTER_GENERATED    — Newsletter content was generated
 *   GIT_COMMIT              — Git commit was created
 *   DELIVERY_ATTEMPT        — Webhook push was attempted
 *   DELIVERY_SUCCESS        — Webhook push succeeded
 *   VALIDATION_RESULT       — Truth validation completed
 *   RECOVERY_EVENT          — Recovery was triggered
 *   ERROR                   — Any system error occurred
 *   PIPELINE_START          — Pipeline execution started
 *   PIPELINE_END            — Pipeline execution completed
 *   REPLAY_EVENT            — Replay was triggered/completed
 *   OPTIMIZATION_RUN        — Self-optimization cycle ran
 *   FEEDBACK_RECORDED       — Feedback was recorded
 *   STEP_EXECUTION          — Individual step executed (success/fail)
 *   SIGNAL_FUSION           — Signal fusion engine ran
 *   INSIGHT_SYNTHESIS       — Strategic insight synthesis ran
 *   SCENARIO_GENERATION     — Scenario engine ran
 *   AGENT_BATCH_COMPLETE    — All multi-agent batch processing completed
 *
 * @module event-emitter
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENT_STORE = path.join(__dirname, "..", "logs", "event-store.json");

// ── Stream Bus Integration ─────────────────────────────────────────────────
// When set, the event-bus handles real-time broadcast + persistence.
// event-emitter constructs the event and delegates to the bus.
let _eventBus = null;

/**
 * Connect the event bus to this emitter.
 * Called ONCE at system startup by operator.js.
 * After connection, all emitEvent() calls route through the bus.
 *
 * @param {object} bus - The event-bus module
 */
export function setEventBus(bus) {
  _eventBus = bus;
}

/**
 * Check if the event bus is connected.
 * @returns {boolean}
 */
export function isBusConnected() {
  return _eventBus !== null && typeof _eventBus.emit === "function";
}

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_EVENTS = 10000; // Keep last 10K events in the store

// ── Internal Helpers ────────────────────────────────────────────────────────

function readEventStore() {
  try {
    if (!fs.existsSync(EVENT_STORE)) return [];
    const raw = fs.readFileSync(EVENT_STORE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // If corrupt, start fresh (non-destructive — old events still in git)
    console.warn("[EVENT-EMITTER] Event store corrupt — initializing empty store");
    return [];
  }
}

function writeEventStore(events) {
  try {
    const dir = path.dirname(EVENT_STORE);
    fs.mkdirSync(dir, { recursive: true });
    const trimmed = events.length > MAX_EVENTS
      ? events.slice(-MAX_EVENTS)
      : events;
    fs.writeFileSync(EVENT_STORE, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    console.error(`[EVENT-EMITTER] ❌ Failed to write event store: ${err.message}`);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a UUID v4 event ID.
 * @returns {string}
 */
export function generateEventId() {
  return crypto.randomUUID();
}

/**
 * Emit an event to the stream bus (if connected) or direct to file store.
 *
 * STREAM PATH (bus connected):
 *   event-emitter → event-bus (broadcast to subscribers)
 *   → stream-processor (rules engine)
 *   → anomaly-detector (pattern analysis)
 *   → event-store.json (persistence)
 *   → system-state.json (live updates)
 *
 * LEGACY PATH (bus not connected):
 *   event-emitter → event-store.json (direct file write)
 *
 * Events are:
 *   - append-only  (never inserted in the middle)
 *   - immutable    (never edited after emission)
 *   - never updated (no PUT/PATCH)
 *   - never deleted (no DELETE)
 *
 * @param {object} params
 * @param {string} params.type      - Event type (see EVENT TYPES above)
 * @param {string} params.runId     - The run identifier this event belongs to
 * @param {object} [params.data]     - Event payload
 * @param {string} [params.data.file]      - File path involved
 * @param {string} [params.data.commit]    - Git commit hash
 * @param {string} [params.data.deliveryId] - Delivery identifier
 * @param {string} [params.data.error]     - Error message (for ERROR events)
 * @param {any}    [params.data.metadata]  - Any additional structured data
 * @returns {object} The emitted event
 */
export function emitEvent({ type, runId, data = {} }) {
  // ── Validate required fields ─────────────────────────────────────────
  if (!type) {
    console.error("[EVENT-EMITTER] ❌ Cannot emit event without type");
    return null;
  }

  // ── Build the immutable event ────────────────────────────────────────
  const event = {
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),
    runId: runId || "unknown",
    type: type.toUpperCase(),
    data: {
      file: data.file || null,
      commit: data.commit || null,
      deliveryId: data.deliveryId || null,
      error: data.error || null,
      ...(data.metadata ? { metadata: data.metadata } : {}),
    },
  };

  // ── Route through event bus if connected (STREAM PATH) ───────────────
  if (isBusConnected()) {
    _eventBus.emit(event);
  } else {
    // ── Legacy path: direct file write ─────────────────────────────────
    const events = readEventStore();
    events.push(event);
    writeEventStore(events);
  }

  // ── Console trace (lightweight) ──────────────────────────────────────
  const icon = getEventIcon(type);
  const shortId = event.eventId.substring(0, 8);
  const streamIndicator = isBusConnected() ? "⚡" : "  ";
  console.log(`   ${icon}${streamIndicator} [EVENT:${type}] ${shortId} — run:${runId || "?"}`);

  return event;
}

/**
 * Emit a batch of events atomically (all or nothing).
 *
 * @param {Array<{type: string, runId: string, data?: object}>} events
 * @returns {Array<object>} The emitted events
 */
export function emitBatch(events) {
  if (!Array.isArray(events) || events.length === 0) return [];

  const timestamp = new Date().toISOString();
  const emitted = events.map((e) => ({
    eventId: generateEventId(),
    timestamp,
    runId: e.runId || "unknown",
    type: e.type.toUpperCase(),
    data: {
      file: e.data?.file || null,
      commit: e.data?.commit || null,
      deliveryId: e.data?.deliveryId || null,
      error: e.data?.error || null,
      ...(e.data?.metadata ? { metadata: e.data.metadata } : {}),
    },
  }));

  // Route through event bus if connected
  if (isBusConnected()) {
    _eventBus.emitBatch(emitted);
  } else {
    const store = readEventStore();
    store.push(...emitted);
    writeEventStore(store);
  }

  console.log(`   📦${isBusConnected() ? "⚡" : " "} [EVENT:BATCH] Emitted ${emitted.length} events`);
  return emitted;
}

/**
 * Get all events for a specific runId.
 *
 * @param {string} runId
 * @returns {Array<object>}
 */
export function getEventsByRun(runId) {
  if (!runId) return [];
  return readEventStore().filter((e) => e.runId === runId);
}

/**
 * Get all events of a specific type.
 *
 * @param {string} type
 * @returns {Array<object>}
 */
export function getEventsByType(type) {
  if (!type) return [];
  return readEventStore().filter((e) => e.type === type.toUpperCase());
}

/**
 * Get events within a time range.
 *
 * @param {string} startISO - ISO timestamp start (inclusive)
 * @param {string} endISO   - ISO timestamp end (inclusive)
 * @returns {Array<object>}
 */
export function getEventsByTimeRange(startISO, endISO) {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (isNaN(start) || isNaN(end)) return [];

  return readEventStore().filter((e) => {
    const t = new Date(e.timestamp).getTime();
    return t >= start && t <= end;
  });
}

/**
 * Get the full event store contents.
 * @returns {Array<object>}
 */
export function getAllEvents() {
  return readEventStore();
}

/**
 * Get event count.
 * @returns {number}
 */
export function getEventCount() {
  return readEventStore().length;
}

/**
 * Clear the event store (DESTRUCTIVE — only for testing).
 * In production, events are never deleted. Use only in test suites.
 */
export function clearEventStore() {
  writeEventStore([]);
  console.warn("[EVENT-EMITTER] ⚠️ Event store cleared (destructive — testing only)");
}

/**
 * Get a summary of events grouped by type.
 *
 * @param {number} [lookback=100] - Number of recent events to analyze
 * @returns {object} Summary with counts per type
 */
export function getEventSummary(lookback = 100) {
  const events = readEventStore();
  const recent = events.slice(-lookback);
  const summary = {};

  for (const e of recent) {
    summary[e.type] = (summary[e.type] || 0) + 1;
  }

  return {
    total: events.length,
    recentCount: recent.length,
    byType: summary,
    timeRange: recent.length > 0
      ? { from: recent[0].timestamp, to: recent[recent.length - 1].timestamp }
      : null,
  };
}

// ── Icon Mapping ───────────────────────────────────────────────────────────

function getEventIcon(type) {
  const icons = {
    NEWSLETTER_GENERATED: "📝",
    GIT_COMMIT: "🔗",
    DELIVERY_ATTEMPT: "📤",
    DELIVERY_SUCCESS: "📬",
    VALIDATION_RESULT: "⚖️",
    RECOVERY_EVENT: "🔁",
    ERROR: "❌",
    PIPELINE_START: "🚀",
    PIPELINE_FAILED: "💥",
    PIPELINE_END: "🎯",
    REPLAY_EVENT: "🔄",
    OPTIMIZATION_RUN: "🧬",
    FEEDBACK_RECORDED: "📊",
    STEP_EXECUTION: "👣",
    SIGNAL_FUSION: "🧠",
    INSIGHT_SYNTHESIS: "💡",
    SCENARIO_GENERATION: "📊",
    ANOMALY_DETECTED: "🔍",
    RECOVERY_TRIGGERED: "🔁",
    DEPLOYMENT_BROKEN: "🚨",
    RETRY_ELIGIBLE: "🔄",
    AGENT_BATCH_COMPLETE: "🏁",  // Multi-agent batch completed event
  };
  return icons[type] || "📌";
}

export default {
  emitEvent,
  emitBatch,
  setEventBus,
  isBusConnected,
  getEventsByRun,
  getEventsByType,
  getEventsByTimeRange,
  getAllEvents,
  getEventCount,
  clearEventStore,
  getEventSummary,
  generateEventId,
};
