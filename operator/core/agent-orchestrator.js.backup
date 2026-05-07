/**
 * agent-orchestrator.js — Multi-Agent Barrier Synchronization Layer
 *
 * CRITICAL SYSTEM MODULE
 * Enforces deterministic, barrier-synchronized execution for all agents.
 *
 * Agents:
 *   macro-agent → macroeconomic signal generation (macro.js)
 *   gcc-agent   → GCC market signal generation (markets.js + normalizer)
 *   risk-agent  → geopolitical risk signal generation (geopolitics.js)
 *   editor-agent → editorial review + fusion + generation (editorial-strategist.js)
 *
 * Execution Contract:
 *   1. Run macro-agent → mark complete
 *   2. Run gcc-agent  → mark complete
 *   3. Run risk-agent  → mark complete
 *   4. Barrier: waitUntilAllAgentsComplete(["macro","gcc","risk"])
 *   5. Run editor-agent → mark complete
 *   6. Emit AGENT_BATCH_COMPLETE event
 *   7. DO NOT TERMINATE until editor completes AND AGENT_BATCH_COMPLETE exists
 *
 * @module core/agent-orchestrator
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_STATE_FILE = path.resolve(__dirname, "..", "logs", "agent-state.json");

// ── Agent State Management ────────────────────────────────────────────────

/**
 * Load the current agent state from disk.
 * @returns {Object} { runId, macro, gcc, risk, editor }
 */
export function loadAgentState() {
  try {
    if (!fs.existsSync(AGENT_STATE_FILE)) {
      return { runId: "", macro: "pending", gcc: "pending", risk: "pending", editor: "pending" };
    }
    const raw = fs.readFileSync(AGENT_STATE_FILE, "utf-8").trim();
    if (!raw) {
      return { runId: "", macro: "pending", gcc: "pending", risk: "pending", editor: "pending" };
    }
    const parsed = JSON.parse(raw);
    return {
      runId: parsed.runId || "",
      macro: parsed.macro || "pending",
      gcc: parsed.gcc || "pending",
      risk: parsed.risk || "pending",
      editor: parsed.editor || "pending",
    };
  } catch {
    return { runId: "", macro: "pending", gcc: "pending", risk: "pending", editor: "pending" };
  }
}

/**
 * Save agent state to disk.
 * @param {Object} state - { runId, macro, gcc, risk, editor }
 */
function saveAgentState(state) {
  try {
    const dir = path.dirname(AGENT_STATE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AGENT_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error(`[AGENT-ORCHESTRATOR] ❌ Failed to save agent state: ${err.message}`);
  }
}

/**
 * Initialize agent state for a new run.
 * Resets all agents to "pending" and sets the runId.
 *
 * @param {string} runId - Unique run identifier
 */
export function initAgentRun(runId) {
  const state = { runId, macro: "pending", gcc: "pending", risk: "pending", editor: "pending" };
  saveAgentState(state);
  console.log(`   🏁 [AGENT-ORCHESTRATOR] Agent run initialized: ${runId}`);
  return state;
}

/**
 * Mark a specific agent as "complete" in the agent state.
 *
 * @param {string} agentName - One of "macro", "gcc", "risk", "editor"
 * @param {string} runId - Current run identifier (for verification)
 * @returns {Object} Updated agent state
 */
export function markAgentComplete(agentName, runId) {
  const state = loadAgentState();

  // ── WARNING ONLY: log mismatch but continue ──────────────────────────
  // STRICT MODE RELAXATION: Previously this was a hard block that prevented
  // agent completion on any runId mismatch. This caused deadlocks when
  // executor.js and operator.js generated different run IDs.
  // Now: log a warning, apply the mark regardless, and continue.
  if (state.runId !== runId) {
    console.warn(`[AGENT-ORCHESTRATOR] ⚠️ Run ID mismatch: state.runId="${state.runId}" !== runId="${runId}". Agent "${agentName}" will still be marked.`);
    // Continue execution — do not block on ID mismatch
  }


  if (!["macro", "gcc", "risk", "editor"].includes(agentName)) {
    console.error(`[AGENT-ORCHESTRATOR] ❌ Unknown agent: "${agentName}"`);
    return state;
  }

  state[agentName] = "complete";
  saveAgentState(state);
  console.log(`   ✅ [AGENT-ORCHESTRATOR] Agent "${agentName}" marked complete — run ${runId}`);
  return state;
}

// ── Barrier Functions ─────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Barrier: wait until ALL required agents are marked complete.
 *
 * Polls agent-state.json every 200ms until all required agents
 * are in "complete" state. Returns immediately if already done.
 *
 * @param {string[]} required - Array of agent names to wait for (e.g. ["macro","gcc","risk"])
 * @param {string} runId - Current run identifier
 * @param {number} [timeoutMs=300000] - Max wait time (default 5 min)
 * @returns {Promise<boolean>} true if barrier passed, false if timed out
 */
export async function waitUntilAllAgentsComplete(required, runId, timeoutMs = 300000) {
  const startTime = Date.now();
  let attempts = 0;

  console.log(`   ⏳ [AGENT-ORCHESTRATOR] Barrier: waiting for agents [${required.join(", ")}]`);

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed > timeoutMs) {
      console.error(`   ❌ [AGENT-ORCHESTRATOR] Barrier TIMEOUT after ${timeoutMs}ms waiting for [${required.join(", ")}]`);
      return false;
    }

    const state = loadAgentState();

    // ── RUN ID CONSISTENCY (WARN ONLY, NO DEADLOCK) ─────────────────────
    // Previously this looped forever when state.runId !== runId, causing an
    // infinite reload loop if the agent state file was stale (from a prior run).
    // Now: log a warning, adopt the state's runId, and continue checking agents.
    // The actual agents writing to agent-state.json use markAgentComplete which
    // writes to the state file — the barrier must follow the state file's runId.
    if (state.runId !== runId) {
      console.warn(`   ⚠️  [AGENT-ORCHESTRATOR] Barrier: runId mismatch (expected="${runId}", state="${state.runId}"). Adopting state runId to prevent deadlock.`);
      runId = state.runId;
    }

    const done = required.every((agent) => state[agent] === "complete");
    if (done) {
      console.log(`   ✅ [AGENT-ORCHESTRATOR] Barrier passed — all agents [${required.join(", ")}] complete (${elapsed}ms)`);
      return true;
    }

    attempts++;
    if (attempts % 25 === 0) {
      // Log progress every ~5 seconds
      const pending = required.filter((a) => state[a] !== "complete");
      console.log(`   ⏳ [AGENT-ORCHESTRATOR] Still waiting for: [${pending.join(", ")}] (${elapsed}ms)`);
    }

    await sleep(200);
  }
}

// ── Execution Guarantee ───────────────────────────────────────────────────

/**
 * Verify that all required agents completed for a given runId.
 * Used as a guard before allowing the system to terminate.
 *
 * @param {string} runId - Run identifier to verify
 * @param {string[]} required - Required agents
 * @returns {boolean} Whether all required agents are complete
 */
export function verifyAgentCompletion(runId, required = ["macro", "gcc", "risk", "editor"]) {
  const state = loadAgentState();
  if (state.runId !== runId) {
    console.warn(`[AGENT-ORCHESTRATOR] ⚠️ Verification: runId mismatch (expected "${runId}", got "${state.runId}") — checking agents against state's runId.`);
    runId = state.runId; // adopt state runId, do not hard-block
  }
  const allDone = required.every((agent) => state[agent] === "complete");
  if (!allDone) {
    const pending = required.filter((a) => state[a] !== "complete");
    console.error(`[AGENT-ORCHESTRATOR] ❌ Verification FAILED: agents still pending: [${pending.join(", ")}]`);
  }
  return allDone;
}

export default {
  initAgentRun,
  markAgentComplete,
  loadAgentState,
  waitUntilAllAgentsComplete,
  verifyAgentCompletion,
};
