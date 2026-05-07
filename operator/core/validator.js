/**
 * validator.js — Prompt Execution Validator Layer (Index) v2.0
 *
 * Unified entry point for ALL validator components:
 *   1. prompt-format-enforcer.js       — Validate prompt structure BEFORE (10 sections)
 *   2. prompt-spec-mapper.js           — Parse prompts → expected artifacts
 *   3. prompt-completeness-checker.js  — Verify artifacts exist AFTER (with brokenHooks)
 *   4. prompt-auditor.js               — Orchestrate, block, retry, persist
 *   5. diff-guard.js                   — Git-based diff tracking
 *   6. prompt-generator.js             — Generate atomic-format prompts (10 sections)
 *   7. traceability-matcher.js         — Feature→File→Function→Executor mapping (NEW v2.0)
 *
 * Usage:
 *   import { enforcePromptFormat, validateExecution, buildTraceabilityMap, ... } from "./core/validator.js";
 *
 * @module validator
 */

// ── Atomic Protocol: Format Enforcer v2.0 ─────────────────────────────────────
export {
  enforcePromptFormat,
  enforceOrThrow,
  getEnforcerVersion,
} from "./prompt-format-enforcer.js";

// ── Atomic Protocol: Spec Mapper ──────────────────────────────────────────────
export {
  mapPromptSpec,
  mapMultiPromptSpec,
  mapPromptFromFile,
  createManualSpec,
} from "./prompt-spec-mapper.js";

// ── Atomic Protocol: Completeness Checker v2.0 (with brokenHooks) ─────────────
export {
  checkCompleteness,
  checkManualCompleteness,
  parseAndCheck,
  wasRunComplete,
  FAILURE_CLASSIFICATIONS,
} from "./prompt-completeness-checker.js";

// ── Atomic Protocol: Auditor ──────────────────────────────────────────────────
export {
  startRun,
  completeRun,
  runAudited,
  getAuditLog,
  getLastRun,
  getRecentRuns,
  isLastRunComplete,
  clearAuditLog,
  generateRetryPrompt,
} from "./prompt-auditor.js";

// ── Atomic Protocol: Diff Guard ───────────────────────────────────────────────
export {
  createSnapshot,
  compareSnapshots,
  guardExecution,
} from "./diff-guard.js";

// ── Atomic Protocol: Prompt Generator v2.0 (10 sections) ──────────────────────
export {
  generateAtomicPrompt,
  generateRetryAtomicPrompt,
  fromManualSpec,
  validateGeneratorConfig,
  getGeneratorVersion,
} from "./prompt-generator.js";

// ── Atomic Protocol: Traceability Matcher (NEW v2.0) ──────────────────────────
export {
  buildTraceabilityMap,
  mapFeatureToFile,
  verifyExecutorReachability,
  getTraceabilityMap,
  getKnownFeatures,
} from "./traceability-matcher.js";

// ── One-Shot Validator ────────────────────────────────────────────────────────

/**
 * Validate a Cline prompt execution in a single call.
 * This is the primary entry point for the CLINE WORKFLOW:
 *
 *   AFTER every Cline prompt run:
 *     1. Call validateExecution with expected deliverables
 *     2. System scans filesystem
 *     3. If incomplete → generates retry prompt
 *     4. Blocks next prompt until complete
 *
 * @param {object} config
 * @param {string} config.promptName - Name for this prompt run
 * @param {string[]} [config.expectedFiles] - Files that should exist
 * @param {string[]} [config.expectedFunctions] - Functions that should be defined
 * @param {string[]} [config.expectedLogs] - Log entries that should exist
 * @param {string[]} [config.expectedBrokenHooks] - Hook integrity checks
 * @param {boolean} [config.force] - Skip previous-run completeness check
 * @returns {Promise<object>} Full validation result
 */
export async function validateExecution(config = {}) {
  const {
    promptName = "cline-execution",
    expectedFiles = [],
    expectedFunctions = [],
    expectedLogs = [],
    expectedBrokenHooks = [],
    force = false,
  } = config;

  // ── Step 1: Create manual spec from expected deliverables ──────────────
  const spec = createManualSpec(promptName, {
    expectedFiles,
    expectedFunctions,
    expectedLogs,
  });
  spec.expectedBrokenHooks = expectedBrokenHooks;

  // ── Step 2: Start run (checks previous completeness) ──────────────────
  const startResult = startRun({
    promptName,
    expected: { files: expectedFiles, functions: expectedFunctions, logs: expectedLogs, brokenHooks: expectedBrokenHooks },
    force,
  });

  if (!startResult.permitted) {
    return {
      validated: false,
      blocked: true,
      startResult,
      completionResult: null,
      isComplete: false,
      retryPrompt: startResult.retryPrompt,
    };
  }

  // ── Step 3: Complete run (run audit, persist, decide) ────────────────
  const completionResult = completeRun(startResult.runId, { spec });

  return {
    validated: true,
    blocked: false,
    startResult,
    completionResult,
    isComplete: completionResult.isComplete,
    shouldBlockNext: completionResult.shouldBlockNext,
    retryPrompt: completionResult.retryPrompt,
    score: completionResult.executionScore,
    classification: completionResult.failureClassification,
    missingItems: completionResult.missingItems,
  };
}

/**
 * Convenience wrapper for the CLI integration pattern:
 *
 *   AFTER Cline prompt → node -e "import('./core/validator.js').then(m => m.cliValidate({...}))"
 *
 * @param {object} config
 * @returns {Promise<object>}
 */
export async function cliValidate(config = {}) {
  return validateExecution(config);
}

/**
 * Full pipeline: enforce → execute → audit → traceability.
 * Runs all atomic execution standard layers in sequence.
 *
 * @param {object} config
 * @returns {Promise<object>}
 */
export async function fullPipeline(config = {}) {
  const {
    promptName = "full-pipeline",
    promptText = "",
    expectedFiles = [],
    expectedFunctions = [],
    expectedLogs = [],
    expectedBrokenHooks = [],
    force = false,
    enforceLevel = "NORMAL",
    buildTraceability = true,
  } = config;

  console.log(`\n🏗️  [VALIDATOR] Full pipeline for "${promptName}"`);

  // Layer 1: Format enforcer (BEFORE)
  if (promptText) {
    const { enforcePromptFormat } = await import("./prompt-format-enforcer.js");
    const enforceResult = enforcePromptFormat(promptText, { level: enforceLevel });
    if (!enforceResult.valid) {
      return { pipelineComplete: false, failedAt: "enforcer", enforceResult };
    }
  }

  // Layer 2: Validate execution
  const validationResult = await validateExecution({
    promptName,
    expectedFiles,
    expectedFunctions,
    expectedLogs,
    expectedBrokenHooks,
    force,
  });

  if (!validationResult.validated) {
    return { pipelineComplete: false, failedAt: "execution", validationResult };
  }

  // Layer 3: Traceability (AFTER)
  if (buildTraceability) {
    const { buildTraceabilityMap } = await import("./traceability-matcher.js");
    buildTraceabilityMap({ persist: true });
  }

  return {
    pipelineComplete: validationResult.isComplete,
    failedAt: validationResult.isComplete ? null : "completeness",
    validationResult,
  };
}
