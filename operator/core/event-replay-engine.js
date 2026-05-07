/**
 * event-replay-engine.js — Event-Driven Replay Engine (Upgraded)
 *
 * FINAL ARCHITECTURE — Replaces log-based debugging with deterministic
 * event timeline reconstruction.
 *
 * Instead of replaying "steps", this replays the ENTIRE event timeline.
 * Capabilities:
 *   - Reconstruct any run from its events
 *   - Rebuild newsletter state from events
 *   - Re-run only failed event chains
 *   - Simulate system behavior (what-if analysis)
 *   - Root cause analysis from event timeline
 *
 * State = replay(all events in order)
 *
 * @module event-replay-engine
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import {
  emitEvent,
  getAllEvents,
  getEventsByRun,
  getEventsByType,
  getEventSummary,
} from "./event-emitter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OPERATOR_JS = path.join(__dirname, "..", "operator.js");

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000;

// ── Reconstructors ──────────────────────────────────────────────────────────

/**
 * Reconstruct a complete run timeline from events.
 *
 * Returns structured timeline showing exactly what happened, in order:
 *   events → timeline entries with duration and status
 *
 * @param {string} runId - The run ID to reconstruct
 * @returns {object} Reconstructed run with full timeline
 */
export function reconstructRunFromEvents(runId) {
  if (!runId) {
    return { error: "runId is required", runId: null, timeline: [] };
  }

  const events = getEventsByRun(runId);
  if (events.length === 0) {
    return { error: `No events found for run ${runId}`, runId, timeline: [] };
  }

  // Sort by timestamp (safety — should already be in order from append-only store)
  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Build timeline with duration between events
  const timeline = [];
  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];
    const prevEvent = i > 0 ? sorted[i - 1] : null;

    const entry = {
      eventId: event.eventId,
      timestamp: event.timestamp,
      type: event.type,
      data: event.data,
      order: i + 1,
      durationSincePrevious: prevEvent
        ? new Date(event.timestamp).getTime() - new Date(prevEvent.timestamp).getTime()
        : 0,
    };

    timeline.push(entry);
  }

  // Determine run outcome from events
  const pipelineEnd = timeline.find((e) => e.type === "PIPELINE_END");
  const hasError = timeline.some((e) => e.type === "ERROR");
  const deliverySuccess = timeline.some((e) => e.type === "DELIVERY_SUCCESS");
  const deliveryAttempt = timeline.some((e) => e.type === "DELIVERY_ATTEMPT");

  let outcome = "UNKNOWN";
  if (pipelineEnd) {
    outcome = pipelineEnd.data?.metadata?.status || "UNKNOWN";
  } else if (hasError) {
    outcome = "FAILED";
  } else if (deliverySuccess) {
    outcome = "SUCCESS";
  }

  // Collect errors for root cause analysis
  const errors = timeline
    .filter((e) => e.type === "ERROR")
    .map((e) => ({
      at: e.timestamp,
      message: e.data?.error || "Unknown error",
      precedingEvent: timeline[Math.max(0, e.order - 2)]?.type || "start",
    }));

  return {
    runId,
    outcome,
    eventCount: sorted.length,
    timeRange: {
      start: sorted[0].timestamp,
      end: sorted[sorted.length - 1].timestamp,
    },
    timeline,
    errors,
    gapAnalysis: analyzeEventGaps(timeline),
    summary: {
      generatedNewsletter: timeline.some((e) => e.type === "NEWSLETTER_GENERATED"),
      committed: timeline.some((e) => e.type === "GIT_COMMIT"),
      attemptedDelivery: deliveryAttempt,
      delivered: deliverySuccess,
      hadErrors: hasError,
      recovered: timeline.some((e) => e.type === "RECOVERY_EVENT"),
    },
  };
}

/**
 * Rebuild the newsletter state from events for a given run.
 *
 * @param {string} runId
 * @returns {object|null} The newsletter object if found, null otherwise
 */
export function rebuildNewsletterState(runId) {
  const events = getEventsByRun(runId);
  const genEvent = events.find((e) => e.type === "NEWSLETTER_GENERATED");

  if (!genEvent || !genEvent.data?.file) return null;

  // Try to read the file that was generated
  try {
    const filePath = path.resolve(ROOT, genEvent.data.file);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
    // File may not exist (deleted or not committed)
  }

  return null;
}

/**
 * Analyze gaps in the event timeline — missing events indicate skipped steps
 * or silent failures.
 *
 * @param {Array} timeline - Sorted event timeline
 * @returns {Array<object>} Gap analysis results
 */
function analyzeEventGaps(timeline) {
  const gaps = [];

  // Check for expected event sequences
  const types = timeline.map((e) => e.type);

  // Gap 1: Newsletter generated but no git commit
  if (types.includes("NEWSLETTER_GENERATED") && !types.includes("GIT_COMMIT")) {
    gaps.push({
      type: "MISSING_GIT_COMMIT",
      severity: "HIGH",
      description: "Newsletter was generated but never committed to git",
    });
  }

  // Gap 2: Delivery attempted but no success/failure
  const deliveryAttempts = timeline.filter((e) => e.type === "DELIVERY_ATTEMPT");
  if (deliveryAttempts.length > 0) {
    const lastDeliveryAttempt = deliveryAttempts[deliveryAttempts.length - 1];
    const laterEvents = timeline.filter(
      (e) => new Date(e.timestamp).getTime() > new Date(lastDeliveryAttempt.timestamp).getTime()
    );

    const hasDeliveryResult = laterEvents.some(
      (e) => e.type === "DELIVERY_SUCCESS" || (e.type === "ERROR" && e.data?.deliveryId)
    );

    if (!hasDeliveryResult) {
      gaps.push({
        type: "DELIVERY_RESULT_MISSING",
        severity: "HIGH",
        description: "Delivery was attempted but no success/failure event was recorded",
      });
    }
  }

  // Gap 3: Pipeline start but no end
  if (types.includes("PIPELINE_START") && !types.includes("PIPELINE_END")) {
    gaps.push({
      type: "ABRUPT_TERMINATION",
      severity: "CRITICAL",
      description: "Pipeline started but never completed — possible crash or unhandled error",
    });
  }

  // Gap 4: Error event but no recovery
  if (types.includes("ERROR") && !types.includes("RECOVERY_EVENT")) {
    gaps.push({
      type: "UNHANDLED_ERROR",
      severity: "MEDIUM",
      description: "Error occurred but no recovery event was triggered",
    });
  }

  return gaps;
}

// ── Root Cause Analysis ────────────────────────────────────────────────────

/**
 * Perform root cause analysis for a failed run.
 *
 * Traces the event chain backwards to find the first event that caused failure.
 *
 * @param {string} runId
 * @returns {object} Root cause analysis
 */
export function analyzeRootCause(runId) {
  const reconstruction = reconstructRunFromEvents(runId);
  if (reconstruction.error) return reconstruction;

  const { timeline, errors } = reconstruction;

  // Find the first error event
  const firstError = timeline.find((e) => e.type === "ERROR");
  const firstFailure = timeline.find(
    (e) => e.type === "STEP_EXECUTION" && e.data?.metadata?.status === "FAILED"
  );

  // Find the event that PRECEDED the first failure/error
  let triggerEvent = null;
  let triggerIndex = -1;

  if (firstError) {
    triggerIndex = firstError.order - 2; // The event before the error
    if (triggerIndex >= 0 && triggerIndex < timeline.length) {
      triggerEvent = timeline[triggerIndex];
    }
  }

  // Analyze the chain of events leading to failure
  const chain = [];
  const failureIndex = firstFailure
    ? firstFailure.order - 1
    : firstError
      ? firstError.order - 1
      : timeline.length - 1;

  // Walk backwards from failure to find root cause
  for (let i = Math.max(0, failureIndex - 5); i <= failureIndex; i++) {
    chain.push({
      order: timeline[i].order,
      type: timeline[i].type,
      timestamp: timeline[i].timestamp,
      data: timeline[i].data,
    });
  }

  // Determine root cause category
  let rootCauseCategory = "UNKNOWN";
  let rootCauseDescription = "Could not determine root cause";

  const errorMessages = errors.map((e) => e.message.toLowerCase());

  if (errorMessages.some((m) => m.includes("json") || m.includes("parse"))) {
    rootCauseCategory = "JSON_PARSE_ERROR";
    rootCauseDescription = "DeepSeek response parsing failed — malformed JSON";
  } else if (errorMessages.some((m) => m.includes("timeout") || m.includes("timed out"))) {
    rootCauseCategory = "TIMEOUT";
    rootCauseDescription = "Operation timed out (DeepSeek API, git push, or webhook)";
  } else if (errorMessages.some((m) => m.includes("network") || m.includes("fetch"))) {
    rootCauseCategory = "NETWORK_ERROR";
    rootCauseDescription = "Network failure during API call or webhook delivery";
  } else if (errorMessages.some((m) => m.includes("git") || m.includes("push"))) {
    rootCauseCategory = "GIT_FAILURE";
    rootCauseDescription = "Git commit or push failed";
  } else if (errorMessages.some((m) => m.includes("auth") || m.includes("401") || m.includes("403"))) {
    rootCauseCategory = "AUTH_ERROR";
    rootCauseDescription = "Authentication failure (webhook secret mismatch)";
  } else if (
    errorMessages.some(
      (m) => m.includes("apps script") || m.includes("webhook") || m.includes("delivery")
    )
  ) {
    rootCauseCategory = "DELIVERY_FAILURE";
    rootCauseDescription = "Apps Script webhook delivery failed";
  }

  return {
    runId,
    outcome: reconstruction.outcome,
    rootCauseCategory,
    rootCauseDescription,
    firstErrorAt: firstError?.timestamp || null,
    firstErrorMessage: firstError?.data?.error || null,
    triggerEvent,
    eventChain: chain,
    errors,
    gaps: reconstruction.gapAnalysis,
    timeline: reconstruction.timeline,
  };
}

// ── Replay from Events ──────────────────────────────────────────────────────

/**
 * Re-run only the failed event chains for a run.
 *
 * Instead of re-running the entire pipeline, this identifies which events
 * represent failed steps and re-runs only those.
 *
 * @param {string} runId
 * @returns {Promise<{replayed: boolean, step: string|null, error: string|null}>}
 */
export async function replayFailedChain(runId) {
  const analysis = analyzeRootCause(runId);
  if (analysis.error) {
    return { replayed: false, step: null, error: analysis.error };
  }

  // Find failed steps
  const failedSteps = [];
  for (const entry of analysis.timeline) {
    if (
      entry.type === "STEP_EXECUTION" &&
      entry.data?.metadata?.status === "FAILED"
    ) {
      failedSteps.push(entry);
    }
  }

  if (failedSteps.length === 0) {
    return { replayed: false, step: null, error: "No failed steps found to replay" };
  }

  // Emit a replay event
  emitEvent({
    type: "REPLAY_EVENT",
    runId,
    data: {
      metadata: {
        action: "REPLAY_FAILED_CHAIN",
        failedSteps: failedSteps.map((s) => s.type),
        rootCause: analysis.rootCauseCategory,
      },
    },
  });

  // For now, spawn operator.js --replay for the full run
  // In future: fine-grained step-level replay from events
  const { spawn } = await import("child_process");
  const job = analysis.timeline.find(
    (e) => e.data?.metadata?.jobName
  )?.data?.metadata?.jobName || "daily-newsletter";

  return new Promise((resolve) => {
    const child = spawn("node", [OPERATOR_JS, job, "--replay"], {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        // SINGLE IDENTITY: Use runId directly (no Date.now() suffix).
        // Previously appended Date.now() which created an orphan identity
        // that could not be traced back to the original pipeline execution.
        RUN_ID: `event-replay-${runId}`,
        REPLAY_SOURCE: runId,
        REPLAY_MODE: "event-driven",
      },

      shell: false,
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ replayed: false, step: null, error: "Replay timed out" });
    }, DEFAULT_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ replayed: false, step: null, error: err.message });
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({
        replayed: code === 0,
        step: failedSteps[0]?.type || null,
        error: code === 0 ? null : `Replay exited with code ${code}`,
      });
    });
  });
}

// ── System Simulation ──────────────────────────────────────────────────────

/**
 * Simulate system behavior from a set of events.
 *
 * What-if analysis: given a hypothetical event stream, what would the
 * system state look like?
 *
 * @param {Array} events - Array of event objects to simulate
 * @returns {object} Simulated system state
 */
export function simulateSystemBehavior(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return { state: "IDLE", reason: "No events to simulate" };
  }

  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Build simulated state progression
  let newsletterGenerated = false;
  let committed = false;
  let delivered = false;
  let hasError = false;
  let recovered = false;

  for (const event of sorted) {
    switch (event.type) {
      case "NEWSLETTER_GENERATED":
        newsletterGenerated = true;
        break;
      case "GIT_COMMIT":
        committed = true;
        break;
      case "DELIVERY_SUCCESS":
        delivered = true;
        break;
      case "ERROR":
        hasError = true;
        break;
      case "RECOVERY_EVENT":
        recovered = true;
        break;
    }
  }

  // Determine final state
  let state;
  if (newsletterGenerated && committed && delivered && !hasError) {
    state = "COMPLETE_SUCCESS";
  } else if (newsletterGenerated && committed && delivered && hasError && recovered) {
    state = "RECOVERED";
  } else if (newsletterGenerated && !delivered) {
    state = "GENERATED_NOT_DELIVERED";
  } else if (!newsletterGenerated && hasError) {
    state = "FAILED_NO_OUTPUT";
  } else {
    state = "PARTIAL";
  }

  return {
    state,
    metrics: {
      newsletterGenerated,
      committed,
      delivered,
      hasError,
      recovered,
      totalEvents: sorted.length,
      eventTypes: [...new Set(sorted.map((e) => e.type))],
    },
    progression: sorted.map((e) => ({
      at: e.timestamp,
      type: e.type,
      file: e.data?.file || null,
    })),
  };
}

// ── Query Layer ────────────────────────────────────────────────────────────

/**
 * Answer specific questions from the event store.
 *
 * Question types:
 *   - "why was newsletter delayed?"
 *   - "which step caused webhook failure?"
 *   - "how often does DeepSeek JSON fail?"
 *   - "what topics improve GCC score?"
 *
 * @param {string} question - The natural language question
 * @returns {object} Structured answer from event data
 */
export function queryEventStore(question) {
  const allEvents = getAllEvents();
  const summary = getEventSummary(500);

  // Normalize question
  const q = question.toLowerCase();

  // ── Q1: "why was newsletter delayed?" ────────────────────────────────
  if (q.includes("delay") || q.includes("slow") || q.includes("took long")) {
    return analyzeDelays(allEvents);
  }

  // ── Q2: "which step caused webhook failure?" ─────────────────────────
  if (
    q.includes("webhook") ||
    q.includes("delivery") ||
    q.includes("push") ||
    q.includes("apps script")
  ) {
    return analyzeDeliveryFailures(allEvents);
  }

  // ── Q3: "how often does DeepSeek JSON fail?" ─────────────────────────
  if (q.includes("deepseek") || q.includes("json") || q.includes("parse") || q.includes("ai")) {
    return analyzeDeepSeekErrors(allEvents);
  }

  // ── Q4: "what topics improve GCC score?" ────────────────────────────
  if (q.includes("gcc") || q.includes("score") || q.includes("quality") || q.includes("topic")) {
    return analyzeGCCPerformance(allEvents);
  }

  // ── Q5: "what is the system health?" ─────────────────────────────────
  if (q.includes("health") || q.includes("status") || q.includes("overview")) {
    return {
      question,
      answer: "System health overview from event store",
      summary: getEventSummary(500),
      totalEvents: allEvents.length,
    };
  }

  // ── Generic event store query ────────────────────────────────────────
  return {
    question,
    answer: "Query did not match known question patterns. Returning event store summary.",
    totalEvents: allEvents.length,
    eventTypeDistribution: summary.byType,
  };
}

/**
 * Analyze delays from event timestamps.
 */
function analyzeDelays(events) {
  const runs = {};
  for (const e of events) {
    if (!runs[e.runId]) runs[e.runId] = [];
    runs[e.runId].push(e);
  }

  const delayedRuns = [];
  for (const [runId, runEvents] of Object.entries(runs)) {
    const sorted = runEvents.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    if (sorted.length >= 2) {
      const start = new Date(sorted[0].timestamp).getTime();
      const end = new Date(sorted[sorted.length - 1].timestamp).getTime();
      const duration = end - start;
      if (duration > 120_000) {
        // > 2 minutes
        delayedRuns.push({
          runId,
          durationMs: duration,
          duration: `${Math.round(duration / 1000)}s`,
          eventCount: sorted.length,
          firstEvent: sorted[0].type,
          lastEvent: sorted[sorted.length - 1].type,
        });
      }
    }
  }

  return {
    question: "Why was newsletter delayed?",
    answer: delayedRuns.length > 0
      ? `Found ${delayedRuns.length} run(s) exceeding 2 minutes`
      : "No significant delays detected in recent runs",
    delayedRuns: delayedRuns.slice(0, 10),
    analysis: delayedRuns.length > 0
      ? "Check ERROR and DELIVERY_ATTEMPT events in delayed runs for root cause"
      : "System response time is within normal parameters",
  };
}

/**
 * Analyze delivery/webhook failures from events.
 */
function analyzeDeliveryFailures(events) {
  const deliveryAttempts = events.filter((e) => e.type === "DELIVERY_ATTEMPT");
  const deliverySuccesses = events.filter((e) => e.type === "DELIVERY_SUCCESS");
  const deliveryErrors = events.filter(
    (e) => e.type === "ERROR" && e.data?.deliveryId
  );

  const failureRate = deliveryAttempts.length > 0
    ? Math.round(
        ((deliveryAttempts.length - deliverySuccesses.length) / deliveryAttempts.length) * 100
      )
    : 0;

  return {
    question: "Which step caused webhook failure?",
    answer:
      deliveryAttempts.length === 0
        ? "No delivery attempts recorded in event store"
        : failureRate > 0
          ? `${failureRate}% delivery failure rate (${deliveryAttempts.length - deliverySuccesses.length} failed of ${deliveryAttempts.length} attempts)`
          : "All deliveries succeeded",
    metrics: {
      totalAttempts: deliveryAttempts.length,
      successful: deliverySuccesses.length,
      failed: deliveryErrors.length,
      failureRate: `${failureRate}%`,
    },
    failedDeliveries: deliveryErrors.map((e) => ({
      runId: e.runId,
      timestamp: e.timestamp,
      error: e.data?.error,
      deliveryId: e.data?.deliveryId,
    })),
    recommendation:
      failureRate > 20
        ? "HIGH FAILURE RATE: Check APPS_SCRIPT_WEBHOOK_URL, WEBHOOK_SECRET, and Apps Script deployment"
        : failureRate > 0
          ? "LOW FAILURE RATE: Investigate individual failed deliveries in EVENT_STORE"
          : "System healthy",
  };
}

/**
 * Analyze DeepSeek JSON parse errors from events.
 */
function analyzeDeepSeekErrors(events) {
  const errors = events.filter((e) => e.type === "ERROR");
  const jsonErrors = errors.filter(
    (e) =>
      e.data?.error?.toLowerCase().includes("json") ||
      e.data?.error?.toLowerCase().includes("parse") ||
      e.data?.error?.toLowerCase().includes("deepseek")
  );

  return {
    question: "How often does DeepSeek JSON fail?",
    answer:
      jsonErrors.length === 0
        ? "No DeepSeek JSON parse errors detected in event store"
        : `${jsonErrors.length} JSON-related error(s) found`,
    metrics: {
      totalErrors: errors.length,
      jsonErrors: jsonErrors.length,
      jsonErrorRate: errors.length > 0
        ? `${Math.round((jsonErrors.length / errors.length) * 100)}%`
        : "0%",
    },
    jsonErrorDetails: jsonErrors.map((e) => ({
      runId: e.runId,
      timestamp: e.timestamp,
      error: e.data?.error?.substring(0, 200),
    })),
    recommendation:
      jsonErrors.length > 0
        ? "Review DeepSeek response format and improve JSON extraction in operator.js extractJSON()"
        : "No action needed",
  };
}

/**
 * Analyze GCC score performance from events.
 */
function analyzeGCCPerformance(events) {
  const feedbackEvents = events.filter((e) => e.type === "FEEDBACK_RECORDED");
  const latestGccScores = feedbackEvents
    .slice(-10)
    .map((e) => e.data?.metadata?.gccRelevance || null)
    .filter(Boolean);

  const avgGcc = latestGccScores.length > 0
    ? Math.round(
        (latestGccScores.reduce((a, b) => a + b, 0) / latestGccScores.length) * 10
      ) / 10
    : null;

  return {
    question: "What topics improve GCC score?",
    answer: avgGcc !== null
      ? `Average GCC relevance score: ${avgGcc}/10 across last ${latestGccScores.length} runs`
      : "Not enough feedback data to analyze GCC score trends",
    metrics: {
      feedbackEvents: feedbackEvents.length,
      recentGccScores: latestGccScores,
      averageGccScore: avgGcc,
    },
    recommendation:
      avgGcc !== null && avgGcc < 7
        ? "GCC specificity below target. Ensure newsletter includes Saudi, UAE, and Qatar-specific data"
        : "GCC relevance score is acceptable",
  };
}

// ── Standalone CLI ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "reconstruct":
      if (!args[1]) {
        console.error("Usage: node core/event-replay-engine.js reconstruct <runId>");
        process.exit(1);
      }
      const reconstruction = reconstructRunFromEvents(args[1]);
      console.log(JSON.stringify(reconstruction, null, 2));
      break;

    case "root-cause":
      if (!args[1]) {
        console.error("Usage: node core/event-replay-engine.js root-cause <runId>");
        process.exit(1);
      }
      const analysis = analyzeRootCause(args[1]);
      console.log(JSON.stringify(analysis, null, 2));
      break;

    case "query":
      if (!args[1]) {
        console.error("Usage: node core/event-replay-engine.js query \"<question>\"");
        process.exit(1);
      }
      const answer = queryEventStore(args.slice(1).join(" "));
      console.log(JSON.stringify(answer, null, 2));
      break;

    case "summary":
      const summary = getEventSummary(500);
      console.log(JSON.stringify(summary, null, 2));
      break;

    case "simulate":
      if (!args[1]) {
        console.error("Usage: node core/event-replay-engine.js simulate <runId>");
        process.exit(1);
      }
      const events = getEventsByRun(args[1]);
      const simulation = simulateSystemBehavior(events);
      console.log(JSON.stringify(simulation, null, 2));
      break;

    default:
      console.log(`
Event Replay Engine — CLI Usage:

  reconstruct <runId>   — Reconstruct a run from its events
  root-cause <runId>    — Analyze root cause of failure
  query "<question>"    — Answer questions from event store
  summary               — Get event store summary
  simulate <runId>      — Simulate system behavior from events
      `);
  }
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("event-replay-engine.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[EVENT-REPLAY] Fatal: ${err.message}`);
    process.exit(1);
  });
}

export default {
  reconstructRunFromEvents,
  rebuildNewsletterState,
  analyzeRootCause,
  replayFailedChain,
  simulateSystemBehavior,
  queryEventStore,
};
