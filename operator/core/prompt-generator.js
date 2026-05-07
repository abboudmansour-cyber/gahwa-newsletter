/**
 * prompt-generator.js — Gahwa Atomic Execution Standard Prompt Generator v2.0
 *
 * Generates fully-formed 10-section atomic-format prompts from structured
 * configuration. Produces prompts that pass the prompt-format-enforcer v2.0
 * and produce verifiable completions through the prompt-completeness-checker.
 *
 * Use this instead of hand-writing prompts to guarantee:
 *   - All 10 atomic sections are present (0-9)
 *   - Artifact lists are machine-parseable
 *   - Validation and failure handling are built in
 *   - Diff guarantee and traceability contract are included
 *   - The resulting prompt is Cline-safe + non-skippable
 *
 * @module prompt-generator
 */

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate a complete Gahwa Atomic Execution Standard prompt from structured parameters.
 *
 * @param {object} config - Prompt configuration
 * @param {string} config.objective - Concrete objective (one sentence)
 * @param {string[]} [config.files] - Required file paths to create
 * @param {string[]} [config.functions] - Required function/module names
 * @param {string[]} [config.logs] - Required log file paths
 * @param {string[]} [config.behaviors] - Required behavioral outcomes
 * @param {string[]} [config.directories] - Required directories
 * @param {string[]} [config.brokenHooks] - Hook integrity checks (exports/imports that must exist)
 * @param {string[]} [config.rules] - Implementation rules (defaults provided)
 * @param {string[]} [config.protectedFiles] - Files that must NOT be modified
 * @param {string[]} [config.tasks] - Deterministic step list
 * @param {string[]} [config.checks] - Validation CHECK items
 * @param {boolean} [config.includeDiffGuard=true] - Include diff guarantee section
 * @param {boolean} [config.includeBehaviorContract=true] - Include behavior contract section
 * @param {string} [config.notes] - Additional context for the prompt
 * @returns {string} The complete atomic-format prompt
 */
export function generateAtomicPrompt(config = {}) {
  const {
    objective = "",
    files = [],
    functions = [],
    logs = [],
    behaviors = [],
    directories = [],
    brokenHooks = [],
    rules = [],
    protectedFiles = [],
    tasks = [],
    checks = [],
    includeDiffGuard = true,
    includeBehaviorContract = true,
    notes = "",
  } = config;

  // ── Build sections ────────────────────────────────────────────────────

  // 0. HEADER (MANDATORY)
  const header = `SYSTEM: Gahwa Operator
MODE: Atomic Execution
STRICT MODE: ON
NO PARTIAL IMPLEMENTATION: TRUE`;

  // 1. OBJECTIVE (NO AMBIGUITY)
  const objectiveSection = formatObjective(objective);

  // 2. REQUIRED ARTIFACTS (THE CONTRACT)
  const artifactsSection = formatArtifacts(files, functions, logs, behaviors, directories, brokenHooks);

  // 3. IMPLEMENTATION BOUNDARIES
  const boundariesSection = formatRules(rules, protectedFiles);

  // 4. IMPLEMENTATION TASKS (STEP LIST)
  const tasksSection = formatTasks(tasks);

  // 5. VALIDATION LAYER (NON-NEGOTIABLE)
  const validationSection = formatValidation(files, functions, logs, directories, behaviors, brokenHooks, checks);

  // 6. COMPLETENESS REPORT (FORCED OUTPUT)
  const completenessSection = formatCompleteness();

  // 7. AUTO-RECOVERY RULE
  const recoverySection = AUTO_RECOVERY_TEMPLATE;

  // 8. DIFF GUARANTEE
  const diffSection = includeDiffGuard ? DIFF_GUARANTEE_TEMPLATE : "";

  // 9. FINAL SYSTEM BEHAVIOR CONTRACT
  const contractSection = includeBehaviorContract ? BEHAVIOR_CONTRACT_TEMPLATE : "";

  // ── Assemble ──────────────────────────────────────────────────────────
  let prompt = `SYSTEM: Gahwa Operator
MODE: Atomic Execution
STRICT MODE: ON
NO PARTIAL IMPLEMENTATION: TRUE

# 🎯 1. OBJECTIVE (NO AMBIGUITY)
${objectiveSection}

# 📦 2. REQUIRED ARTIFACTS (THE CONTRACT)
${artifactsSection}
# 🧠 3. IMPLEMENTATION BOUNDARIES
${boundariesSection}
# 🔧 4. IMPLEMENTATION TASKS (STEP LIST)
${tasksSection}
# 🧪 5. VALIDATION LAYER (NON-NEGOTIABLE)
${validationSection}
# 📊 6. COMPLETENESS REPORT (FORCED OUTPUT)
${completenessSection}
# 🔁 7. AUTO-RECOVERY RULE
${recoverySection}`;

  if (includeDiffGuard) {
    prompt += `\n# 🧾 8. DIFF GUARANTEE\n${diffSection}`;
  }

  if (includeBehaviorContract) {
    prompt += `\n# 🧠 9. FINAL SYSTEM BEHAVIOR CONTRACT\n${contractSection}`;
  }

  // Optional: Notes
  if (notes) {
    prompt += `\n---\n### Additional Context\n${notes}\n`;
  }

  return prompt.trim();
}

/**
 * Generate a focused retry prompt (only missing items) for v2.0 standard.
 *
 * @param {object} missingItems - Items from a completeness report
 * @param {object} [options]
 * @param {string} options.promptName - Original prompt name
 * @param {string[]} options.foundFiles - Already existing files (do not touch)
 * @param {string[]} options.foundFunctions - Already existing functions (do not touch)
 * @returns {string} Focused retry prompt
 */
export function generateRetryAtomicPrompt(missingItems = {}, options = {}) {
  const {
    promptName = "retry-prompt",
    foundFiles = [],
    foundFunctions = [],
  } = options;

  const {
    files = [],
    functions = [],
    logs = [],
    behaviors = [],
    brokenHooks = [],
  } = missingItems;

  if (files.length === 0 && functions.length === 0 && logs.length === 0 && behaviors.length === 0 && brokenHooks.length === 0) {
    return `SYSTEM: Gahwa Operator
MODE: Atomic Execution
STRICT MODE: ON
NO PARTIAL IMPLEMENTATION: TRUE

# 🎯 1. OBJECTIVE (NO AMBIGUITY)
Complete the remaining items from "${promptName}" — no specific gaps identified.

# 🔁 7. AUTO-RECOVERY RULE
RETRY MODE:
  - Review the prior execution output for errors or truncation
  - Run the full prompt again with focus on completion
  - Verify all artifacts exist after execution`;
  }

  let prompt = `SYSTEM: Gahwa Operator
MODE: Atomic Execution
STRICT MODE: ON
NO PARTIAL IMPLEMENTATION: TRUE

# 🎯 1. OBJECTIVE (NO AMBIGUITY)
Complete the remaining items from "${promptName}"

# 📦 2. REQUIRED ARTIFACTS (THE CONTRACT)

## DO NOT RE-IMPLEMENT EXISTING PARTS
`;

  if (foundFiles.length > 0) {
    prompt += `\nAlready existing files (DO NOT TOUCH):\n`;
    foundFiles.forEach((f) => { prompt += `- ${f}\n`; });
  }

  if (foundFunctions.length > 0) {
    prompt += `\nAlready existing functions (DO NOT RE-DEFINE):\n`;
    foundFunctions.forEach((f) => { prompt += `- ${f}()\n`; });
  }

  prompt += `\n## IMPLEMENT ONLY THE FOLLOWING MISSING ITEMS\n`;

  if (files.length > 0) {
    prompt += `\nFILES REQUIRED:\n`;
    files.forEach((f) => { prompt += `- CREATE "${f}"\n`; });
  }

  if (functions.length > 0) {
    prompt += `\nFUNCTIONS REQUIRED:\n`;
    functions.forEach((f) => { prompt += `- EXPORT function "${f}()"\n`; });
  }

  if (logs.length > 0) {
    prompt += `\nLOGS REQUIRED:\n`;
    logs.forEach((l) => { prompt += `- WRITE to "${l}"\n`; });
  }

  if (behaviors.length > 0) {
    prompt += `\nBEHAVIOR:\n`;
    behaviors.forEach((b) => { prompt += `- ${b}\n`; });
  }

  if (brokenHooks.length > 0) {
    prompt += `\nBROKEN HOOKS CHECK:\n`;
    brokenHooks.forEach((h) => { prompt += `- ${h}\n`; });
  }

  prompt += `\n# 🧠 3. IMPLEMENTATION BOUNDARIES\n${RULES_DEFAULT_BLOCK}\n`;
  prompt += `\n# 🧪 5. VALIDATION LAYER (NON-NEGOTIABLE)\n`;

  prompt += `CHECK:\n`;
  if (files.length > 0) {
    files.forEach((f) => { prompt += `  - "${f}" exists\n`; });
  }
  if (functions.length > 0) {
    functions.forEach((f) => { prompt += `  - function "${f}" found via grep\n`; });
  }
  if (logs.length > 0) {
    logs.forEach((l) => { prompt += `  - "${l}" contains valid entries\n`; });
  }

  prompt += `\n# 📊 6. COMPLETENESS REPORT (FORCED OUTPUT)\n${formatCompleteness()}\n`;
  prompt += `\n# 🔁 7. AUTO-RECOVERY RULE\n${AUTO_RECOVERY_TEMPLATE}\n`;

  return prompt;
}

/**
 * Create a structured configuration object from a manual spec format.
 *
 * @param {object} manualSpec - From createManualSpec() in prompt-spec-mapper
 * @param {string} [additionalObjective] - Override objective text
 * @returns {object} Config for generateAtomicPrompt
 */
export function fromManualSpec(manualSpec, additionalObjective = "") {
  return {
    objective: additionalObjective || `Implement artifacts for "${manualSpec.promptName}"`,
    files: manualSpec.expectedFiles || [],
    functions: manualSpec.expectedFunctions || [],
    logs: manualSpec.expectedLogs || [],
    behaviors: manualSpec.expectedBehaviors || [],
    directories: manualSpec.expectedDirectories || [],
  };
}

/**
 * Validate that a config object has the minimum required fields.
 *
 * @param {object} config
 * @returns {boolean} Whether the config is valid
 */
export function validateGeneratorConfig(config) {
  if (!config || typeof config !== "object") return false;
  if (!config.objective || typeof config.objective !== "string" || config.objective.trim().length === 0) return false;
  return true;
}

/**
 * Get the generator version.
 * @returns {string}
 */
export function getGeneratorVersion() {
  return "2.0.0";
}

// ── Internal Formatting ───────────────────────────────────────────────────────

/**
 * Format the OBJECTIVE section.
 */
function formatObjective(objective) {
  if (!objective || objective.trim().length === 0) {
    return "[ERROR: No objective specified]";
  }
  return objective.trim() + "\n";
}

/**
 * Format the REQUIRED ARTIFACTS section.
 */
function formatArtifacts(files, functions, logs, behaviors, directories, brokenHooks) {
  let block = "";

  if (files.length > 0) {
    block += `FILES REQUIRED:\n`;
    files.forEach((f) => { block += `  - ${f}\n`; });
  }

  if (functions.length > 0) {
    block += `\nFUNCTIONS REQUIRED:\n`;
    functions.forEach((f) => {
      const name = f.endsWith("()") ? f : `${f}()`;
      block += `  - ${name}\n`;
    });
  }

  if (logs.length > 0) {
    block += `\nLOGS REQUIRED:\n`;
    logs.forEach((l) => { block += `  - ${l}\n`; });
  }

  if (behaviors.length > 0) {
    block += `\nBEHAVIOR:\n`;
    behaviors.forEach((b) => { block += `  - ${b}\n`; });
  }

  if (directories.length > 0) {
    block += `\nDIRECTORIES:\n`;
    directories.forEach((d) => { block += `  - ${d}\n`; });
  }

  if (brokenHooks.length > 0) {
    block += `\nBROKEN HOOKS CHECK:\n`;
    brokenHooks.forEach((h) => { block += `  - ${h}\n`; });
  }

  if (block.length === 0) {
    block = "[No artifacts specified — this prompt may be incomplete]\n";
  }

  return block;
}

/**
 * Format the IMPLEMENTATION BOUNDARIES section.
 * Merges user-provided rules with sensible defaults.
 */
function formatRules(customRules, protectedFiles) {
  const rules = new Set();

  // Default rules (always included)
  const defaults = [
    "Do NOT modify existing architecture",
    "Do NOT delete existing modules",
    "Do NOT introduce new external services",
    "Only extend current pipeline",
    "Keep interfaces unchanged",
  ];

  defaults.forEach((r) => rules.add(r));

  // Add custom rules
  customRules.forEach((r) => rules.add(r));

  // Add protected files
  if (protectedFiles.length > 0) {
    protectedFiles.forEach((f) => rules.add(`Do NOT modify: ${f}`));
  }

  let block = "";
  rules.forEach((r) => { block += `* ${r}\n`; });

  return block;
}

/**
 * Format the IMPLEMENTATION TASKS section.
 */
function formatTasks(tasks) {
  if (tasks.length === 0) {
    return "1. Implement the artifacts listed in section 2\n2. Verify all artifacts exist after implementation\n";
  }

  return tasks.map((t, i) => `${i + 1}. ${t}`).join("\n") + "\n";
}

/**
 * Format the VALIDATION LAYER section with concrete assertions.
 */
function formatValidation(files, functions, logs, directories, behaviors, brokenHooks, checks) {
  let block = "CHECK:\n";

  if (files.length > 0) {
    files.forEach((f) => { block += `  - "${f}" exists\n`; });
  }

  if (functions.length > 0) {
    functions.forEach((f) => {
      block += `  - function "${f}" found via grep\n`;
    });
  }

  if (logs.length > 0) {
    logs.forEach((l) => { block += `  - "${l}" contains valid entries\n`; });
  }

  if (directories.length > 0) {
    directories.forEach((d) => { block += `  - directory "${d}" exists\n`; });
  }

  if (behaviors.length > 0) {
    behaviors.forEach((b) => {
      block += `  - behavioral evidence: ${b}\n`;
    });
  }

  if (brokenHooks.length > 0) {
    brokenHooks.forEach((h) => {
      block += `  - hook integrity: ${h}\n`;
    });
  }

  // Add custom checks
  if (checks.length > 0) {
    checks.forEach((c) => {
      block += `  - ${c}\n`;
    });
  }

  // Add runtime import tests
  if (files.length > 0) {
    files.filter(f => f.endsWith('.js')).forEach(f => {
      const modulePath = f.replace(/^operator\//, './');
      block += `  - import test: node -e "import('${modulePath}')"\n`;
    });
  }

  if (block === "CHECK:\n") {
    block += "  [No checks specified — prompt may be incomplete]\n";
  }

  return block;
}

/**
 * Format the COMPLETENESS REPORT section with the expected JSON schema (v2.0).
 */
function formatCompleteness() {
  let schema = '```json\n';
  schema += '{\n';
  schema += '  "status": "COMPLETE",\n';
  schema += '  "missingFiles": [],\n';
  schema += '  "missingFunctions": [],\n';
  schema += '  "brokenHooks": [],\n';
  schema += '  "executionScore": 100\n';
  schema += '}\n';
  schema += '```\n';

  schema += '\nIf any missing arrays are non-empty → status MUST be "INCOMPLETE".\n';
  schema += 'If status is INCOMPLETE → executionScore MUST be < 100.\n';

  return schema;
}

// ── Static Templates ──────────────────────────────────────────────────────────

const AUTO_RECOVERY_TEMPLATE = `If INCOMPLETE:

RETRY MODE:
  - Only implement missing items from REQUIRED ARTIFACTS
  - Do NOT repeat completed work
  - After retry, re-validate completeness
  - If still incomplete → escalate with notes`;

const DIFF_GUARANTEE_TEMPLATE = `OUTPUT REQUIREMENT:
  - list all created files
  - list all modified files
  - list all new functions added
  - list all hooks attached`;

const BEHAVIOR_CONTRACT_TEMPLATE = `* system must be fully traceable
* every feature must map to a file
* every file must map to a function
* every function must be reachable from executor`;

const RULES_DEFAULT_BLOCK = `* Do NOT modify existing architecture
* Do NOT delete existing modules
* Do NOT introduce new external services
* Only extend current pipeline
* Keep interfaces unchanged`;
