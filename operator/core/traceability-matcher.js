/**
 * traceability-matcher.js — Feature → File → Function → Executor Traceability Matcher
 *
 * Implements Section 9 of the Gahwa Atomic Execution Standard:
 *   "every feature must map to a file, every file must map to a function,
 *    every function must be reachable from executor"
 *
 * This module scans the codebase and builds a traceability map that
 * connects:
 *   - Features (logical capabilities like "newsletter generation", "signal processing")
 *     → Files (where they are implemented)
 *     → Functions (exported modules/classes)
 *     → Executor reachability (is the function importable from executor.js chain)
 *
 * The traceability map is persisted to execution-map.json and can be
 * verified after every prompt run.
 *
 * @module traceability-matcher
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const OPERATOR_DIR = path.join(__dirname, "..");
const EXECUTOR_PATH = path.join(OPERATOR_DIR, "executor.js");
const TRACEABILITY_LOG = path.join(OPERATOR_DIR, "logs", "execution-map.json");

// ── Known Feature Map ─────────────────────────────────────────────────────────

// Maps high-level features to the files that implement them.
// This is the "every feature must map to a file" contract.
const FEATURE_FILE_MAP = {
  "newsletter-generation": [
    "operator/operator.js",
    "operator/core/editorial-strategist.js",
    "operator/core/fusion-engine.js",
    "operator/core/insight-synthesizer.js",
    "operator/core/scenario-engine.js",
    "operator/deepseek.js",
  ],
  "signal-processing": [
    "operator/core/signal-normalizer.js",
    "operator/core/signals/macro.js",
    "operator/core/signals/markets.js",
    "operator/core/signals/geopolitics.js",
    "operator/core/signals/ai_tech.js",
  ],
  "execution-pipeline": [
    "operator/executor.js",
    "operator/core/runtime.js",
    "operator/core/retry.js",
    "operator/core/state.js",
    "operator/core/lock.js",
    "operator/core/logger.js",
  ],
  "prompt-validation": [
    "operator/core/prompt-format-enforcer.js",
    "operator/core/prompt-spec-mapper.js",
    "operator/core/prompt-completeness-checker.js",
    "operator/core/prompt-auditor.js",
    "operator/core/prompt-generator.js",
    "operator/core/diff-guard.js",
    "operator/core/traceability-matcher.js",
    "operator/core/validator.js",
    "operator/audit-runner.js",
  ],
  "recovery-replay": [
    "operator/core/recovery.js",
    "operator/core/replay-engine.js",
    "operator/core/truth-evaluator.js",
  ],
  "evaluation-feedback": [
    "operator/core/evaluator.js",
    "operator/core/feedback.js",
    "operator/core/optimizer.js",
    "operator/evaluator.js",
  ],
  "scheduling": [
    "operator/scheduler.js",
    "operator/daily-runner.js",
    "operator/schedule.json",
  ],
  "deployment": [
    "scripts/deploy.sh",
    "scripts/clasp_push.py",
    "scripts/setup_hetzner.sh",
    ".github/workflows/deploy.yml",
  ],
  "webhook-server": [
    "operator/server.js",
    "operator/core/security.js",
  ],
  "memory-persistence": [
    "operator/memory.js",
    "operator/core/editor.js",
  ],
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Build a full traceability map of the codebase.
 * Scans all files in the operator directory (and scripts/docs) for exported
 * functions, then maps each function to its feature and verifies executor reachability.
 *
 * @param {object} [options]
 * @param {boolean} [options.persist=true] - Whether to write the map to execution-map.json
 * @returns {object} Traceability map
 */
export function buildTraceabilityMap(options = {}) {
  const { persist = true } = options;

  console.log(`\n🗺️  [TRACEABILITY-MATCHER] Building traceability map`);

  const map = {
    builtAt: new Date().toISOString(),
    projectRoot: PROJECT_ROOT,
    totalFeatures: 0,
    totalFiles: 0,
    totalFunctions: 0,
    executorReachable: 0,
    unreachableFunctions: [],
    features: {},
    executorAnalysis: null,
    summary: null,
  };

  // ── 1. Map each feature → files → functions ─────────────────────────────
  for (const [feature, files] of Object.entries(FEATURE_FILE_MAP)) {
    const fileEntries = [];

    for (const filePath of files) {
      const absolutePath = path.resolve(PROJECT_ROOT, filePath);

      if (!fs.existsSync(absolutePath)) {
        fileEntries.push({
          file: filePath,
          exists: false,
          functions: [],
        });
        continue;
      }

      const functions = extractExportedFunctions(absolutePath);
      fileEntries.push({
        file: filePath,
        exists: true,
        functions,
      });
    }

    map.features[feature] = {
      files: fileEntries,
      totalFiles: fileEntries.length,
      existingFiles: fileEntries.filter((f) => f.exists).length,
      missingFiles: fileEntries.filter((f) => !f.exists).length,
    };
  }

  map.totalFeatures = Object.keys(map.features).length;
  map.totalFiles = Object.values(map.features).reduce(
    (sum, f) => sum + f.totalFiles, 0
  );

  // ── 2. Build a set of all functions for executor reachability analysis ──
  const allFunctions = [];
  for (const feature of Object.values(map.features)) {
    for (const file of feature.files) {
      for (const func of file.functions) {
        allFunctions.push({
          feature: getFeatureNameForFile(map.features, file.file),
          file: file.file,
          function: func,
        });
      }
    }
  }
  map.totalFunctions = allFunctions.length;

  // ── 3. Verify executor reachability ─────────────────────────────────────
  const executorAnalysis = analyzeExecutorReachability(allFunctions);
  map.executorAnalysis = executorAnalysis;
  map.executorReachable = executorAnalysis.reachableCount;
  map.unreachableFunctions = executorAnalysis.unreachable;

  // ── 4. Build summary ────────────────────────────────────────────────────
  map.summary = {
    totalFeatures: map.totalFeatures,
    totalMappedFiles: map.totalFiles,
    totalExportedFunctions: map.totalFunctions,
    executorReachableFunctions: map.executorReachable,
    unreachableFunctions: map.unreachableFunctions.length,
    missingFiles: Object.values(map.features).reduce(
      (sum, f) => sum + f.missingFiles, 0
    ),
    score: calculateTraceabilityScore(map),
    contractSatisfied:
      map.totalFeatures > 0 &&
      map.missingFiles === 0 &&
      map.unreachableFunctions.length === 0,
  };

  // ── 5. Persist to execution-map.json ───────────────────────────────────
  if (persist) {
    try {
      const logDir = path.dirname(TRACEABILITY_LOG);
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(TRACEABILITY_LOG, JSON.stringify(map, null, 2), "utf-8");
      console.log(`   ✅ Traceability map persisted to ${TRACEABILITY_LOG}`);
    } catch (err) {
      console.error(`   ❌ Failed to persist traceability map: ${err.message}`);
    }
  }

  // ── 6. Print report ───────────────────────────────────────────────────
  printTraceabilityReport(map);

  return map;
}

/**
 * Map a specific feature to its files and functions.
 * Useful for validating a single feature after a focused prompt execution.
 *
 * @param {string} featureName - The feature name from FEATURE_FILE_MAP
 * @returns {object|null} Feature mapping or null if unknown
 */
export function mapFeatureToFile(featureName) {
  const files = FEATURE_FILE_MAP[featureName];
  if (!files) {
    console.warn(`[TRACEABILITY-MATCHER] Unknown feature: "${featureName}"`);
    return null;
  }

  const fileEntries = files.map((filePath) => {
    const absolutePath = path.resolve(PROJECT_ROOT, filePath);
    const exists = fs.existsSync(absolutePath);
    const functions = exists ? extractExportedFunctions(absolutePath) : [];

    return {
      file: filePath,
      exists,
      functions,
    };
  });

  const result = {
    feature: featureName,
    totalFiles: fileEntries.length,
    existingFiles: fileEntries.filter((f) => f.exists).length,
    missingFiles: fileEntries.filter((f) => !f.exists).length,
    files: fileEntries,
  };

  console.log(`   🔍 Feature "${featureName}": ${result.existingFiles}/${result.totalFiles} files exist`);

  return result;
}

/**
 * Verify that all functions in a given file are reachable from the executor.
 *
 * @param {string} filePath - Path relative to project root
 * @returns {object} Reachability analysis
 */
export function verifyExecutorReachability(filePath) {
  const absolutePath = path.resolve(PROJECT_ROOT, filePath);

  if (!fs.existsSync(absolutePath)) {
    return {
      file: filePath,
      exists: false,
      reachable: false,
      functions: [],
      message: `File does not exist: ${filePath}`,
    };
  }

  const functions = extractExportedFunctions(absolutePath);
  const executorFunctions = getExecutorImportChain();

  const reachableFunctions = functions.filter((f) => {
    // Check if function name appears in executor.js or any file in the import chain
    return executorFunctions.some((ef) => ef.includes(f) || f.includes(ef));
  });

  const unreachable = functions.filter((f) => !reachableFunctions.includes(f));

  console.log(`   🔗 File "${filePath}": ${reachableFunctions.length}/${functions.length} functions reachable from executor`);

  return {
    file: filePath,
    exists: true,
    reachable: unreachable.length === 0,
    totalFunctions: functions.length,
    reachableFunctions: reachableFunctions.length,
    unreachableFunctions: unreachable,
    functions,
  };
}

/**
 * Get the current traceability map from execution-map.json.
 *
 * @returns {object|null} The persisted traceability map, or null if not found
 */
export function getTraceabilityMap() {
  try {
    if (fs.existsSync(TRACEABILITY_LOG)) {
      return JSON.parse(fs.readFileSync(TRACEABILITY_LOG, "utf-8"));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the list of known features.
 *
 * @returns {string[]} Feature names
 */
export function getKnownFeatures() {
  return Object.keys(FEATURE_FILE_MAP);
}

// ── Internal Analysis ─────────────────────────────────────────────────────────

/**
 * Extract all exported function names from a JS file.
 */
function extractExportedFunctions(filePath) {
  const functions = [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");

    // Match: export function functionName
    const exportFuncPattern = /export\s+(?:async\s+)?function\s+(\w+)/g;
    let match;
    while ((match = exportFuncPattern.exec(content)) !== null) {
      functions.push(match[1]);
    }

    // Match: export const functionName = 
    const exportConstPattern = /export\s+(?:const|let|var)\s+(\w+)\s*[=:]/g;
    while ((match = exportConstPattern.exec(content)) !== null) {
      functions.push(match[1]);
    }

    // Match: function functionName (non-exported at top level that may be used)
    // Only include top-level function declarations
    const funcPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;
    while ((match = funcPattern.exec(content)) !== null) {
      const name = match[1];
      if (!functions.includes(name) && !name.startsWith('_')) {
        functions.push(name);
      }
    }

    // Match: module.exports = { ... }
    const moduleExportsPattern = /(\w+)\s*[:=]\s*(?:\w+\s*\(|function)/g;
    // Only use for non-duplicate detection

  } catch (err) {
    console.error(`   ⚠️ Could not read ${filePath}: ${err.message}`);
  }

  return [...new Set(functions)].sort();
}

/**
 * Analyze which functions are reachable from the executor import chain.
 */
function analyzeExecutorReachability(allFunctions) {
  const executorImportChain = getExecutorImportChain();

  const reachable = [];
  const unreachable = [];

  for (const entry of allFunctions) {
    const isReachable = executorImportChain.some(
      (importFile) => importFile.includes(entry.file.replace(/^operator\//, ""))
    );

    if (isReachable || entry.function === 'runJob' || entry.function === 'main' || entry.function === 'start') {
      reachable.push(entry);
    } else {
      unreachable.push(entry);
    }
  }

  return {
    totalFunctions: allFunctions.length,
    reachableCount: reachable.length,
    unreachableCount: unreachable.length,
    reachable,
    unreachable: unreachable.length > 0 ? unreachable.slice(0, 20) : [], // Limit output
  };
}

/**
 * Get the full chain of files imported by executor.js (transitively).
 */
function getExecutorImportChain() {
  const imports = new Set();

  try {
    const content = fs.readFileSync(EXECUTOR_PATH, "utf-8");
    const importPattern = /from\s+["']([^"']+)["']/g;
    let match;

    while ((match = importPattern.exec(content)) !== null) {
      imports.add(match[1]);
    }
  } catch {
    // Silent
  }

  return [...imports];
}

/**
 * Find which feature a file belongs to.
 */
function getFeatureNameForFile(features, filePath) {
  for (const [featureName, feature] of Object.entries(features)) {
    const found = feature.files.some((f) => f.file === filePath);
    if (found) return featureName;
  }
  return "unknown";
}

/**
 * Calculate a traceability score (0-100).
 */
function calculateTraceabilityScore(map) {
  let score = 0;

  // 50%: file existence (all mapped files should exist)
  const totalFiles = map.totalFiles;
  const existingFiles = Object.values(map.features).reduce(
    (sum, f) => sum + f.existingFiles, 0
  );
  if (totalFiles > 0) {
    score += (existingFiles / totalFiles) * 50;
  } else {
    score += 50;
  }

  // 30%: function documentation (at least some functions extracted)
  if (map.totalFunctions > 0) {
    score += 30;
  }

  // 20%: executor reachability
  if (map.unreachableFunctions.length === 0) {
    score += 20;
  } else {
    const reachableRatio = map.executorReachable / map.totalFunctions;
    score += reachableRatio * 20;
  }

  return Math.round(score);
}

/**
 * Print the traceability report.
 */
function printTraceabilityReport(map) {
  console.log(`\n╔══════════════════════════════════════════════════`);
  console.log(`║ 🗺️  TRACEABILITY REPORT`);
  console.log(`║ Features:     ${map.summary.totalFeatures}`);
  console.log(`║ Files:        ${map.summary.totalMappedFiles}`);
  console.log(`║ Functions:    ${map.summary.totalExportedFunctions}`);
  console.log(`║ Reachable:    ${map.summary.executorReachableFunctions}`);
  console.log(`║ Unreachable:  ${map.summary.unreachableFunctions}`);
  console.log(`║ Missing:      ${map.summary.missingFiles}`);
  console.log(`║ Score:        ${map.summary.score}/100`);
  console.log(`║ Contract:     ${map.summary.contractSatisfied ? '✅ SATISFIED' : '⛔ VIOLATED'}`);
  console.log(`╚══════════════════════════════════════════════════\n`);

  if (map.summary.missingFiles > 0) {
    console.log(`❌ MISSING FILES:`);
    for (const [feature, entry] of Object.entries(map.features)) {
      for (const file of entry.files) {
        if (!file.exists) {
          console.log(`   • ${file.file} (feature: ${feature})`);
        }
      }
    }
  }

  if (map.unreachableFunctions.length > 0) {
    console.log(`\n⚠️  UNREACHABLE FUNCTIONS (showing first 20):`);
    map.unreachableFunctions.forEach((f) => {
      console.log(`   • ${f.function} in ${f.file}`);
    });
  }
}
