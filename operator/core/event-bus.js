/**
 * event-bus.js — Real-Time Stream Bus (Event-Driven Core)
 *
 * CRITICAL SYSTEM MODULE
 * This is the central nervous system of the reactive infrastructure.
 * Every event passes through this bus for immediate broadcast + persistence.
 *
 * Architecture:
 *   event-emitter → event-bus (STREAM CORE) → subscribers (realtime)
 *                                         → event-store.json (persistence)
 *                                         → anomaly-detector (analysis)
 *                                         → system-state (live updates)
 *
 * The event-bus is the SINGLE entry point for all event processing.
 * Nothing listens to event-emitter directly anymore.
 *
 * @module event-bus
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENT_STORE = path.join(__dirname, "..", "logs", "event-store.json");
const SYSTEM_STATE_FILE = path.join(__dirname, "..", "logs", "system-state.json");

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_EVENTS = 10000;

// ── In-Memory State ─────────────────────────────────────────────────────────
// This is the LIVE in-memory event buffer for zero-latency access.
// File persistence is async and happens in parallel.
const subscribers = new Map();     // id → { pattern, callback }
let subscriberCounter = 0;
const eventQueue = [];             // In-memory event ring buffer
const MAX_QUEUE = 5000;            // Keep last 5K events in memory

// ── Live System State (in-memory + file-backed) ─────────────────────────────

let systemState = {
  activeRuns: 0,
  lastEvent: null,
  lastEventType: null,
  lastEventTimestamp: null,
  systemHealth: "GREEN",           // GREEN | YELLOW | RED
  failureRate: 0,
  recoveryActive: false,
  totalEventsProcessed: 0,
  consecutiveFailures: 0,
  currentRunIds: [],
  anomalyCount: 0,
  uptimeSince: new Date().toISOString(),
};

// ── File Persistence ────────────────────────────────────────────────────────

function readEventStore() {
  try {
    if (!fs.existsSync(EVENT_STORE)) return [];
    const raw = fs.readFileSync(EVENT_STORE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
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
    console.error(`[EVENT-BUS] ❌ Failed to write event store: ${err.message}`);
  }
}

function persistSystemState() {
  try {
    const dir = path.dirname(SYSTEM_STATE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SYSTEM_STATE_FILE, JSON.stringify(systemState, null, 2), "utf-8");
  } catch (err) {
    console.error(`[EVENT-BUS] ❌ Failed to persist system state: ${err.message}`);
  }
}

function loadSystemState() {
  try {
    if (fs.existsSync(SYSTEM_STATE_FILE)) {
      const raw = fs.readFileSync(SYSTEM_STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      systemState = { ...systemState, ...parsed };
    }
  } catch {
    // Start fresh
  }
}

// Load persisted state on module init
loadSystemState();

// ── Core Event Processing ──────────────────────────────────────────────────

/**
 * Process a single event through the entire pipeline:
 *   1. Persist to event store (append-only)
 *   2. Update live system state
 *   3. Add to in-memory ring buffer
 *   4. Broadcast to all matching subscribers
 *
 * @param {object} event - The event to process (must have eventId, type, runId, timestamp)
 * @param {boolean} [skipPersistence=false] - Skip file persistence (for high-frequency events)
 * @returns {object} The processed event
 */
function processEvent(event, skipPersistence = false) {
  if (!event || !event.eventId || !event.type) {
    console.error("[EVENT-BUS] ❌ Invalid event — missing eventId or type");
    return null;
  }

  // ── 1. Persist to event store ────────────────────────────────────
  if (!skipPersistence) {
    const events = readEventStore();
    events.push(event);
    writeEventStore(events);
  }

  // ── 2. Add to in-memory ring buffer ─────────────────────────────
  eventQueue.push(event);
  if (eventQueue.length > MAX_QUEUE) {
    eventQueue.shift();
  }

  // ── 3. Update live system state ─────────────────────────────────
  systemState.lastEvent = event;
  systemState.lastEventType = event.type;
  systemState.lastEventTimestamp = event.timestamp;
  systemState.totalEventsProcessed++;

  // Update active runs tracking
  if (event.type === "PIPELINE_START") {
    systemState.activeRuns++;
    if (event.runId && !systemState.currentRunIds.includes(event.runId)) {
      systemState.currentRunIds.push(event.runId);
    }
  }
  if (event.type === "PIPELINE_END") {
    systemState.activeRuns = Math.max(0, systemState.activeRuns - 1);
    if (event.runId) {
      systemState.currentRunIds = systemState.currentRunIds.filter(id => id !== event.runId);
    }
  }

  // Update failure rate
  if (event.type === "ERROR" || (event.data && event.data.error)) {
    systemState.consecutiveFailures++;
  } else if (
    event.type === "DELIVERY_SUCCESS" ||
    event.type === "PIPELINE_END"
  ) {
    systemState.consecutiveFailures = Math.max(0, systemState.consecutiveFailures - 1);
  }

  // Update health
  systemState.failureRate = calculateFailureRate();
  systemState.systemHealth = calculateHealth();
  persistSystemState();

  // ── 4. Broadcast to subscribers ─────────────────────────────────
  const results = [];
  for (const [id, sub] of subscribers) {
    try {
      if (matchesPattern(event, sub.pattern)) {
        const result = sub.callback(event);
        results.push({ id, result });
      }
    } catch (err) {
      console.error(`[EVENT-BUS] ❌ Subscriber ${id} error: ${err.message}`);
    }
  }

  return event;
}

/**
 * Check if an event matches a subscription pattern.
 *
 * Patterns can be:
 *   - "*"           → matches ALL events
 *   - "ERROR"       → exact type match
 *   - "DELIVERY_*"  → prefix wildcard
 *   - function      → custom predicate (event) => boolean
 *
 * @param {object} event
 * @param {string|Function} pattern
 * @returns {boolean}
 */
function matchesPattern(event, pattern) {
  if (pattern === "*") return true;
  if (typeof pattern === "function") return pattern(event);
  if (typeof pattern !== "string") return false;

  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return event.type.startsWith(prefix);
  }
  return event.type === pattern;
}

/**
 * Calculate the current failure rate based on recent events.
 * Looks at the last 100 events for failure ratio.
 *
 * @returns {number} 0.0 to 1.0
 */
function calculateFailureRate() {
  const recent = eventQueue.slice(-100);
  if (recent.length === 0) return 0;

  const failures = recent.filter(e =>
    e.type === "ERROR" ||
    e.type === "STEP_EXECUTION" && e.data?.metadata?.status === "FAILED"
  ).length;

  return Math.round((failures / recent.length) * 100) / 100;
}

/**
 * Calculate the current system health based on failure rate and state.
 *
 * @returns {"GREEN"|"YELLOW"|"RED"}
 */
function calculateHealth() {
  if (systemState.failureRate > 0.3 || systemState.consecutiveFailures > 5) {
    return "RED";
  }
  if (systemState.failureRate > 0.1 || systemState.consecutiveFailures > 2) {
    return "YELLOW";
  }
  return "GREEN";
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Emit an event through the stream bus.
 *
 * The event is:
 *   - broadcast to all matching subscribers immediately
 *   - persisted to event-store.json (append-only)
 *   - analyzed for system state updates
 *
 * @param {object} event - Must have eventId, type, runId, timestamp
 * @param {object} [options]
 * @param {boolean} [options.skipPersistence=false] - Skip file write (for high-frequency)
 * @returns {object|null} The processed event, or null if invalid
 */
export function emit(event, options = {}) {
  return processEvent(event, options.skipPersistence || false);
}

/**
 * Emit a batch of events through the stream bus.
 * Each event is processed individually (subscribers called per-event).
 * File persistence is batched (single write).
 *
 * @param {Array<object>} events
 * @returns {Array<object|null>}
 */
export function emitBatch(events) {
  if (!Array.isArray(events) || events.length === 0) return [];

  const results = [];
  for (const event of events) {
    results.push(processEvent(event, true)); // skip persistence per-event
  }

  // Write all events in one batch
  if (results.some(r => r !== null)) {
    const store = readEventStore();
    const validEvents = results.filter(r => r !== null);
    store.push(...validEvents);
    writeEventStore(store);
  }

  return results;
}

/**
 * Subscribe to events matching a pattern.
 *
 * @param {string|Function} pattern - Event type pattern or predicate function
 *   Examples: "*", "ERROR", "DELIVERY_*", (e) => e.type === "ERROR"
 * @param {Function} callback - (event) => void. Called immediately when event matches.
 * @returns {string} Subscription ID (use to unsubscribe)
 */
export function subscribe(pattern, callback) {
  if (typeof callback !== "function") {
    console.error("[EVENT-BUS] ❌ subscribe requires a function callback");
    return null;
  }

  const id = `sub_${++subscriberCounter}`;
  subscribers.set(id, { pattern, callback });
  return id;
}

/**
 * Subscribe to EXACTLY one event type (convenience wrapper).
 *
 * @param {string} eventType - Exact event type string
 * @param {Function} callback - (event) => void
 * @returns {string} Subscription ID
 */
export function on(eventType, callback) {
  return subscribe(eventType, callback);
}

/**
 * Subscribe only ONCE — automatically unsubscribes after first match.
 *
 * @param {string|Function} pattern
 * @param {Function} callback - (event) => void
 * @returns {string} Subscription ID
 */
export function once(pattern, callback) {
  const id = `sub_once_${++subscriberCounter}`;
  const wrapper = (event) => {
    try {
      callback(event);
    } finally {
      subscribers.delete(id);
    }
  };
  subscribers.set(id, { pattern, callback: wrapper });
  return id;
}

/**
 * Unsubscribe a subscription by ID.
 *
 * @param {string} id - Subscription ID returned by subscribe()
 * @returns {boolean} Whether a subscription was removed
 */
export function unsubscribe(id) {
  return subscribers.delete(id);
}

/**
 * Get the current number of active subscribers.
 * @returns {number}
 */
export function subscriberCount() {
  return subscribers.size;
}

/**
 * Get the current live system state.
 * @returns {object}
 */
export function getSystemState() {
  return { ...systemState };
}

/**
 * Get recent events from the in-memory ring buffer.
 *
 * @param {number} [count=50] - Number of recent events to return
 * @param {string} [type] - Optional event type filter
 * @returns {Array<object>}
 */
export function getRecentEvents(count = 50, type = null) {
  const recent = eventQueue.slice(-count);
  if (type) {
    return recent.filter(e => e.type === type);
  }
  return recent;
}

/**
 * Get the full event store contents.
 * @returns {Array<object>}
 */
export function getAllEvents() {
  return readEventStore();
}

/**
 * Get event store statistics.
 * @returns {object}
 */
export function getStats() {
  return {
    totalPersisted: readEventStore().length,
    inMemoryBuffer: eventQueue.length,
    activeSubscribers: subscribers.size,
    systemState: { ...systemState },
  };
}

/**
 * Reset the bus state (testing only).
 * Clears subscribers, in-memory buffer, and system state.
 * Does NOT clear the persisted event store.
 */
export function reset() {
  subscribers.clear();
  eventQueue.length = 0;
  systemState = {
    activeRuns: 0,
    lastEvent: null,
    lastEventType: null,
    lastEventTimestamp: null,
    systemHealth: "GREEN",
    failureRate: 0,
    recoveryActive: false,
    totalEventsProcessed: 0,
    consecutiveFailures: 0,
    currentRunIds: [],
    anomalyCount: 0,
    uptimeSince: new Date().toISOString(),
  };
  persistSystemState();
}

// ── Bootstrap: Wire system state recovery on module load ──────────────────

// If event queue is empty on load (fresh process), recover from file
if (eventQueue.length === 0) {
  const storedEvents = readEventStore();
  const recentEvents = storedEvents.slice(-Math.min(100, storedEvents.length));
  for (const evt of recentEvents) {
    eventQueue.push(evt);
  }
  // Recalculate state from last 100 events
  if (recentEvents.length > 0) {
    systemState.lastEvent = recentEvents[recentEvents.length - 1];
    systemState.lastEventType = systemState.lastEvent?.type || null;
    systemState.lastEventTimestamp = systemState.lastEvent?.timestamp || null;

    // Count active runs from recent events
    const starts = recentEvents.filter(e => e.type === "PIPELINE_START").length;
    const ends = recentEvents.filter(e => e.type === "PIPELINE_END").length;
    systemState.activeRuns = Math.max(0, starts - ends);

    systemState.failureRate = calculateFailureRate();
    systemState.systemHealth = calculateHealth();
  }
}

export default {
  emit,
  emitBatch,
  subscribe,
  on,
  once,
  unsubscribe,
  subscriberCount,
  getSystemState,
  getRecentEvents,
  getAllEvents,
  getStats,
  reset,
};
