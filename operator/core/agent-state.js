/**
 * agent-state.js — Re-export of agent-orchestrator for backwards compatibility.
 *
 * All agent state management logic lives in agent-orchestrator.js.
 * This file exists to provide a clean import path for consumers.
 */

export {
  initAgentRun,
  markAgentComplete,
  loadAgentState,
  waitUntilAllAgentsComplete,
  verifyAgentCompletion,
} from "./agent-orchestrator.js";
