/**
 * prompt-completeness-checker.js — Prompt Completeness Checker v2.0
 *
 * Verifies that expected artifacts from a prompt execution actually exist
 * in the filesystem. Compares the prompt specification (from prompt-spec-mapper)
 * against the real filesystem, grep scans, and log directories.
 *
 * v2.0 Changes:
 *  - Added BROKEN_HOOKS failure classification
 *  - Added brokenHooks check in missingItems
 *  - Added hook integrity verification (export/import validation)
 *  - Added brokenHooks to COMPLETENESS REPORT JSON schema
 *
 * @module prompt-completeness-checker
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const LOGS_DIR = path.join(__dirname, "..", "logs");
const OPERATOR_DIR = path.join(__dirname, "..");

// ── Failure Classification Constants ──────────────────────────────────────────

export const FAILURE_CLASSIFICATIONS = {
  PARTIAL_IMPLEMENTATION: "PARTIAL_IMPLEMENTATION",
  LOGIC_DROP: "LOGIC_DROP",
  INCOMPLETE_PIPELINE: "INCOMPLETE_PIPELINE",
  BROKEN_HOOKS: "BROKEN_HOOKS",
  FULL_SUCCESS: "FULL_SUCCESS",
  NOT_EVALUATED: "NOT_EVALUATED",
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compare a prompt specification against the actual filesystem and codebase.
 *
 * @param {object} spec - The prompt specification from prompt-spec-mapper.js
 * @param {object} [options] - Optional configuration
 * @param {string[]} [options.ignorePaths] - Paths to ignore during scanning
 * @param {boolean} [options.strictMode] - If true, treat warnings as failures
 * @returns {object} Completeness report with missing items and execution score
 */
export function checkCompleteness(spec, options = {}) {
  if (!spec || !spec.promptName) {
    console.warn("[COMPLETENESS-CHECKER] Invalid spec provided");
    return createEmptyReport("invalid-spec");
  }

  const { ignorePaths = [], strictMode = false } = options;

  console.log(`\n🔍 [COMPLETENESS-CHECKER v2.0] Verifying prompt: "${spec.promptName}"`);
  console.log(`   Strict mode: ${strictMode ? "ON" : "OFF"}`);

  // ── Step 1: Check file existence ──────────────────────────────────────────
  const missingFiles = checkMissingFiles(spec.expectedFiles, ignorePaths);
  const foundFiles = spec.expectedFiles.filter(
    (f) => !missingFiles.includes(f)
  );

  // ── Step 2: Check function/class definitions via grep ─────────────────────
  const missingFunctions = checkMissingFunctions(
    spec.expectedFunctions,
    spec.expectedFiles,
    ignorePaths
  );
  const foundFunctions = spec.expectedFunctions.filter(
    (f) => !missingFunctions.includes(f)
  );

  // ── Step 3: Check log file entries ────────────────────────────────────────
  const missingLogs = checkMissingLogs(spec.expectedLogs);
  const foundLogs = spec.expectedLogs.filter(
    (l) => !missingLogs.includes(l)
  );

  // ── Step 4: Check directory existence ─────────────────────────────────────
  const missingDirectories = checkMissingDirectories(spec.expectedDirectories);
  const foundDirectories = spec.expectedDirectories.filter(
    (d) => !missingDirectories.includes(d)
  );

  // ── Step 5: Check behavioral evidence ─────────────────────────────────────
  const missingBehaviors = checkMissingBehaviors(spec.expectedBehaviors);
  const foundBehaviors = spec.expectedBehaviors.filter(
    (b) => !missingBehaviors.includes(b)
  );

  // ── Step 6: Check hook integrity (new in v2.0) ────────────────────────────
  const { brokenHooks, intactHooks } = checkBrokenHooks(spec.expectedBrokenHooks || []);

  // ── Step 7: Calculate execution score with hooks factored in ──────────────
  const executionScore = calculateExecutionScore(
    spec.expectedFiles.length,
    foundFiles.length,
    spec.expectedFunctions.length,
    foundFunctions.length,
    spec.expectedLogs.length,
    foundLogs.length,
    spec.expectedDirectories.length,
    foundDirectories.length,
    spec.expectedBehaviors.length,
    foundBehaviors.length,
    spec.expectedBrokenHooks ? spec.expectedBrokenHooks.length : 0,
    intactHooks.length
  );

  // ── Step 8: Classify failure type ─────────────────────────────────────────
  const failureClassification = classifyFailure(
    missingFiles,
    missingFunctions,
    missingLogs,
    brokenHooks,
    executionScore
  );

  // ── Step 9: Determine skipped steps ──────────────────────────────────────
  const skippedSteps = determineSkippedSteps(
    spec.expectedFiles,
    missingFiles,
    spec.expectedFunctions,
    missingFunctions,
    spec.expectedLogs,
    missingLogs,
    spec.expectedDirectories,
    missingDirectories,
    spec.expectedBehaviors,
    missingBehaviors,
    brokenHooks
  );

  // ── Build report ─────────────────────────────────────────────────────────
  const report = {
    promptName: spec.promptName,
    timestamp: new Date().toISOString(),
    specTimestamp: spec.timestamp,
    expectedDeliverables: [
      ...spec.expectedFiles.map((f) => ({ type: "file", name: f, found: !missingFiles.includes(f) })),
      ...spec.expectedFunctions.map((f) => ({ type: "function", name: f, found: !missingFunctions.includes(f) })),
      ...spec.expectedLogs.map((l) => ({ type: "log", name: l, found: !missingLogs.includes(l) })),
      ...spec.expectedDirectories.map((d) => ({ type: "directory", name: d, found: !missingDirectories.includes(d) })),
      ...spec.expectedBehaviors.map((b) => ({ type: "behavior", name: b, found: !missingBehaviors.includes(b) })),
      ...(spec.expectedBrokenHooks || []).map((h) => ({ type: "hook", name: h, found: !brokenHooks.includes(h) })),
    ],
    detectedFiles: findDetectedFiles(spec.expectedFiles),
    missingItems: {
      files: missingFiles,
      functions: missingFunctions,
      logs: missingLogs,
      directories: missingDirectories,
      behaviors: missingBehaviors,
      brokenHooks: brokenHooks,
    },
    foundItems: {
      files: foundFiles,
      functions: foundFunctions,
      logs: foundLogs,
      directories: foundDirectories,
      behaviors: foundBehaviors,
      hooks: intactHooks,
    },
    hookReport: {
      total: (spec.expectedBrokenHooks || []).length,
      intact: intactHooks.length,
      broken: brokenHooks.length,
      checks: brokenHooks,
    },
    skippedSteps,
    executionScore,
    failureClassification,
    status: executionScore === 100 ? "COMPLETE" : "INCOMPLETE",
    strictMode,
    warnings: [],
  };

  // Generate warnings AFTER report is fully built
  report.warnings = generateWarnings(report, strictMode);

  // ── Log results ─────────────────────────────────────────────────────────
  printReport(report);

  return report;
}

/**
 * Check completeness with manual override specification.
 * Includes brokenHooks in v2.0.
 */
export function checkManualCompleteness(promptName, manualSpec, options = {}) {
  const spec = {
    promptName,
    timestamp: new Date().toISOString(),
    expectedFiles: manualSpec.expectedFiles || [],
    expectedFunctions: manualSpec.expectedFunctions || [],
    expectedLogs: manualSpec.expectedLogs || [],
    expectedBehaviors: manualSpec.expectedBehaviors || [],
    expectedDirectories: manualSpec.expectedDirectories || [],
    expectedBrokenHooks: manualSpec.expectedBrokenHooks || [],
    raw: "(manual specification)",
    isManual: true,
  };
  return checkCompleteness(spec, options);
}

/**
 * Quick one-shot: parse a prompt and check completeness in one call.
 */
export function parseAndCheck(promptName, promptText, options = {}) {
  const spec = {
    promptName,
    timestamp: new Date().toISOString(),
    expectedFiles: options.expectedFiles || [],
    expectedFunctions: options.expectedFunctions || [],
    expectedLogs: options.expectedLogs || [],
    expectedBehaviors: options.expectedBehaviors || [],
    expectedDirectories: options.expectedDirectories || [],
    expectedBrokenHooks: options.expectedBrokenHooks || [],
    raw: promptText ? promptText.slice(0, 500) : "",
  };
  return checkCompleteness(spec, options);
}

/**
 * Determine if a previous run was complete based on its audit record.
 */
export function wasRunComplete(auditEntry) {
  if (!auditEntry) return false;
  return (
    auditEntry.status === "COMPLETE" &&
    auditEntry.executionScore === 100 &&
    (!auditEntry.missingItems ||
      (auditEntry.missingItems.files.length === 0 &&
        auditEntry.missingItems.functions.length === 0 &&
        (!auditEntry.missingItems.brokenHooks || auditEntry.missingItems.brokenHooks.length === 0)))
  );
}

// ── Internal Verification Logic ──────────────────────────────────────────────

function checkMissingFiles(expectedFiles, ignorePaths = []) {
  const missing = [];
  for (const filePath of expectedFiles) {
    const absolutePath = resolvePath(filePath);
    if (ignorePaths.some((p) => absolutePath.includes(p))) continue;
    if (!fs.existsSync(absolutePath)) missing.push(filePath);
  }
  return missing;
}

function checkMissingFunctions(expectedFunctions, searchFiles = [], ignorePaths = []) {
  if (expectedFunctions.length === 0) return [];
  const missing = [];
  const searchDirs = [OPERATOR_DIR, path.join(PROJECT_ROOT, "scripts")];

  for (const funcName of expectedFunctions) {
    let found = false;
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const result = execSync(
          `grep -rl "${funcName}" "${dir}" --include="*.js" --include="*.ts" --include="*.gs" --include="*.py" 2>/dev/null || true`,
          { encoding: "utf-8", timeout: 10000 }
        );
        if (result.trim().length > 0) { found = true; break; }
      } catch { /* grep failed silently */ }
    }
    if (!found) missing.push(funcName);
  }
  return missing;
}

function checkMissingLogs(expectedLogs) {
  if (expectedLogs.length === 0) return [];
  const missing = [];
  for (const logEntry of expectedLogs) {
    if (logEntry.endsWith(".json") || logEntry.endsWith(".log") || logEntry.endsWith(".txt")) {
      const absolutePath = resolvePath(logEntry);
      if (!fs.existsSync(absolutePath)) missing.push(logEntry);
    } else {
      const logFiles = fs.readdirSync(LOGS_DIR).filter(
        (f) => f.endsWith(".json") || f.endsWith(".log") || f.endsWith(".txt")
      );
      if (logFiles.length === 0) missing.push(logEntry);
    }
  }
  return missing;
}

function checkMissingDirectories(expectedDirectories) {
  if (expectedDirectories.length === 0) return [];
  const missing = [];
  for (const dir of expectedDirectories) {
    const absolutePath = resolvePath(dir);
    if (!fs.existsSync(absolutePath)) missing.push(dir);
  }
  return missing;
}

function checkMissingBehaviors(expectedBehaviors) {
  if (expectedBehaviors.length === 0) return [];
  const missing = [];
  const behaviorLower = expectedBehaviors.map((b) => b.toLowerCase());

  for (let i = 0; i < expectedBehaviors.length; i++) {
    const behavior = expectedBehaviors[i];
    const lower = behaviorLower[i];
    let evidenceFound = false;

    if (lower.includes("git") || lower.includes("commit") || lower.includes("push")) {
      evidenceFound = checkGitEvidence();
    }
    if ((lower.includes("webhook") || lower.includes("delivery") || lower.includes("push")) && !evidenceFound) {
      evidenceFound = checkDeliveryEvidence();
    }
    if ((lower.includes("block") || lower.includes("next prompt")) && !evidenceFound) {
      evidenceFound = checkBlockEvidence();
    }

    if (!evidenceFound) missing.push(behavior);
  }
  return missing;
}

/**
 * NEW in v2.0: Check hook integrity by verifying that expected exports
 * are actually reachable from their modules.
 */
function checkBrokenHooks(expectedHooks) {
  const broken = [];
  const intact = [];

  if (!expectedHooks || expectedHooks.length === 0) {
    return { brokenHooks: broken, intactHooks: intact };
  }

  for (const hookSpec of expectedHooks) {
    let isIntact = false;

    // Pattern: "modulePath exports functionName" or "modulePath (exportName)"
    const fileMatch = hookSpec.match(/^([^\s]+)/);
    const funcMatch = hookSpec.match(/exports\s+(\w+)/);
    const importMatch = hookSpec.match(/import\s+(\w+)/);

    if (fileMatch) {
      const filePath = resolvePath(fileMatch[1]);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          // Check for the function if specified
          if (funcMatch) {
            const funcName = funcMatch[1];
            const exportPattern = new RegExp(`export\\s+(?:function|const|let|var)\\s+${funcName}`);
            if (exportPattern.test(content)) {
              isIntact = true;
            }
          } else if (importMatch) {
            const importName = importMatch[1];
            const re = new RegExp(`import\\s+.*?\\b${importName}\\b`);
            if (re.test(content) || content.includes(importName)) {
              isIntact = true;
            }
          } else {
            // Just file existence check
            isIntact = true;
          }
        } catch {
          isIntact = false;
        }
      }
    }

    if (isIntact) {
      intact.push(hookSpec);
    } else {
      broken.push(hookSpec);
    }
  }

  return { brokenHooks: broken, intactHooks: intact };
}

// ── Behavioral Evidence Checks ────────────────────────────────────────────────

function checkGitEvidence() {
  try {
    const log = execSync("git log -1 --format=%H", {
      encoding: "utf-8", timeout: 5000, cwd: PROJECT_ROOT,
    });
    return log.trim().length > 0;
  } catch { return false; }
}

function checkDeliveryEvidence() {
  const deliveryLog = path.join(PROJECT_ROOT, "output", "delivery_log.txt");
  if (!fs.existsSync(deliveryLog)) return false;
  try {
    const content = fs.readFileSync(deliveryLog, "utf-8");
    return content.includes("VALIDATED SUCCESS") || content.includes("DUPLICATE_IGNORED");
  } catch { return false; }
}

function checkBlockEvidence() {
  const auditFile = path.join(LOGS_DIR, "prompt-execution-audit.json");
  if (!fs.existsSync(auditFile)) return false;
  try {
    const log = JSON.parse(fs.readFileSync(auditFile, "utf-8"));
    if (!Array.isArray(log)) return false;
    return log.some((entry) => entry.blockedNextPrompt === true);
  } catch { return false; }
}

// ── Scoring and Classification ────────────────────────────────────────────────

function calculateExecutionScore(
  totalFiles, foundFiles,
  totalFuncs, foundFuncs,
  totalLogs, foundLogs,
  totalDirs, foundDirs,
  totalBehaviors, foundBehaviors,
  totalHooks, intactHooks
) {
  const totalDeliverables = totalFiles + totalFuncs + totalLogs + totalDirs + totalBehaviors + totalHooks;
  if (totalDeliverables === 0) return 100;

  const fileScore = totalFiles > 0 ? (foundFiles / totalFiles) * 35 : 35;
  const funcScore = totalFuncs > 0 ? (foundFuncs / totalFuncs) * 25 : 25;
  const logScore = totalLogs > 0 ? (foundLogs / totalLogs) * 10 : 10;
  const dirScore = totalDirs > 0 ? (foundDirs / totalDirs) * 10 : 10;
  const behaviorScore = totalBehaviors > 0 ? (foundBehaviors / totalBehaviors) * 5 : 5;
  const hookScore = totalHooks > 0 ? (intactHooks / totalHooks) * 15 : 15;

  return Math.min(100, Math.max(0, Math.round(fileScore + funcScore + logScore + dirScore + behaviorScore + hookScore)));
}

function classifyFailure(missingFiles, missingFunctions, missingLogs, brokenHooks, executionScore) {
  if (executionScore === 100) return FAILURE_CLASSIFICATIONS.FULL_SUCCESS;

  // BROKEN_HOOKS takes priority when hooks are specified and broken
  if (brokenHooks && brokenHooks.length > 0) {
    return FAILURE_CLASSIFICATIONS.BROKEN_HOOKS;
  }

  if (missingFiles.length > 0) return FAILURE_CLASSIFICATIONS.PARTIAL_IMPLEMENTATION;
  if (missingFunctions.length > 0) return FAILURE_CLASSIFICATIONS.LOGIC_DROP;
  if (missingLogs.length > 0) return FAILURE_CLASSIFICATIONS.INCOMPLETE_PIPELINE;
  if (executionScore < 100) return FAILURE_CLASSIFICATIONS.PARTIAL_IMPLEMENTATION;

  return FAILURE_CLASSIFICATIONS.NOT_EVALUATED;
}

function determineSkippedSteps(
  expectedFiles, missingFiles,
  expectedFunctions, missingFunctions,
  expectedLogs, missingLogs,
  expectedDirectories, missingDirectories,
  expectedBehaviors, missingBehaviors,
  brokenHooks
) {
  const steps = [];

  if (missingFiles.length > 0) {
    steps.push({
      type: "FILE_CREATION",
      description: `${missingFiles.length} of ${expectedFiles.length} expected files were not created`,
      items: missingFiles,
    });
  }

  if (missingFunctions.length > 0) {
    steps.push({
      type: "FUNCTION_DEFINITION",
      description: `${missingFunctions.length} of ${expectedFunctions.length} expected functions/modules were not found`,
      items: missingFunctions,
    });
  }

  if (missingLogs.length > 0) {
    steps.push({
      type: "LOG_WRITING",
      description: `${missingLogs.length} of ${expectedLogs.length} expected log artifacts were not created`,
      items: missingLogs,
    });
  }

  if (missingDirectories.length > 0) {
    steps.push({
      type: "DIRECTORY_CREATION",
      description: `${missingDirectories.length} of ${expectedDirectories.length} expected directories were not created`,
      items: missingDirectories,
    });
  }

  if (missingBehaviors.length > 0) {
    steps.push({
      type: "BEHAVIORAL",
      description: `${missingBehaviors.length} of ${expectedBehaviors.length} expected behavioral outcomes had no evidence`,
      items: missingBehaviors,
    });
  }

  if (brokenHooks && brokenHooks.length > 0) {
    steps.push({
      type: "HOOK_INTEGRITY",
      description: `${brokenHooks.length} hook integrity checks failed`,
      items: brokenHooks,
    });
  }

  return steps;
}

function findDetectedFiles(expectedFiles) {
  return expectedFiles.filter((f) => { const abs = resolvePath(f); return fs.existsSync(abs); });
}

function generateWarnings(report, strictMode) {
  const warnings = [];

  if (report.executionScore < 100) {
    const severity = strictMode ? "CRITICAL" :
      report.executionScore < 50 ? "HIGH" :
      report.executionScore < 80 ? "MEDIUM" : "LOW";

    warnings.push({
      severity,
      message: `Execution completeness is ${report.executionScore}/100`,
      classification: report.failureClassification,
    });
  }

  if (report.missingItems.files.length > 0) {
    warnings.push({
      severity: "HIGH",
      message: `${report.missingItems.files.length} expected file(s) are missing from the filesystem`,
      items: report.missingItems.files,
    });
  }

  if (report.missingItems.brokenHooks && report.missingItems.brokenHooks.length > 0) {
    warnings.push({
      severity: "HIGH",
      message: `${report.missingItems.brokenHooks.length} hook integrity check(s) failed`,
      items: report.missingItems.brokenHooks,
    });
  }

  return warnings;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  const fromRoot = path.resolve(PROJECT_ROOT, filePath);
  if (fs.existsSync(fromRoot)) return fromRoot;
  const fromOperator = path.resolve(OPERATOR_DIR, filePath);
  if (fs.existsSync(fromOperator)) return fromOperator;
  return fromRoot;
}

function printReport(report) {
  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`📋 PROMPT COMPLETENESS REPORT v2.0`);
  console.log(`   Prompt:     "${report.promptName}"`);
  console.log(`   Status:     ${report.status}`);
  console.log(`   Score:      ${report.executionScore}/100`);
  console.log(`   Failure:    ${report.failureClassification}`);
  console.log(`═══════════════════════════════════════════════════`);

  if (report.missingItems.files.length > 0) {
    console.log(`\n❌ MISSING FILES (${report.missingItems.files.length}):`);
    report.missingItems.files.forEach((f) => console.log(`   • ${f}`));
  }

  if (report.missingItems.functions.length > 0) {
    console.log(`\n❌ MISSING FUNCTIONS (${report.missingItems.functions.length}):`);
    report.missingItems.functions.forEach((f) => console.log(`   • ${f}`));
  }

  if (report.missingItems.logs.length > 0) {
    console.log(`\n❌ MISSING LOGS (${report.missingItems.logs.length}):`);
    report.missingItems.logs.forEach((l) => console.log(`   • ${l}`));
  }

  if (report.missingItems.brokenHooks && report.missingItems.brokenHooks.length > 0) {
    console.log(`\n❌ BROKEN HOOKS (${report.missingItems.brokenHooks.length}):`);
    report.missingItems.brokenHooks.forEach((h) => console.log(`   • ${h}`));
  }

  if (report.foundItems.files.length > 0) {
    console.log(`\n✅ FOUND FILES (${report.foundItems.files.length}):`);
    report.foundItems.files.forEach((f) => console.log(`   • ${f}`));
  }

  if (report.hookReport.intact > 0) {
    console.log(`\n✅ INTACT HOOKS (${report.hookReport.intact}):`);
    report.hookReport.checks.forEach((h) => console.log(`   • ${h}`));
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Files:      ${report.foundItems.files.length}/${report.expectedDeliverables.filter(d => d.type === 'file').length}`);
  console.log(`   Functions:  ${report.foundItems.functions.length}/${report.expectedDeliverables.filter(d => d.type === 'function').length}`);
  console.log(`   Logs:       ${report.foundItems.logs.length}/${report.expectedDeliverables.filter(d => d.type === 'log').length}`);
  console.log(`   Behaviors:  ${report.foundItems.behaviors ? report.foundItems.behaviors.length : 0}/${report.expectedDeliverables.filter(d => d.type === 'behavior').length}`);
  console.log(`   Hooks:      ${report.hookReport.intact}/${report.hookReport.total}`);
  console.log(`═══════════════════════════════════════════════════\n`);
}

function createEmptyReport(promptName) {
  return {
    promptName,
    timestamp: new Date().toISOString(),
    specTimestamp: null,
    expectedDeliverables: [],
    detectedFiles: [],
    missingItems: { files: [], functions: [], logs: [], directories: [], behaviors: [], brokenHooks: [] },
    foundItems: { files: [], functions: [], logs: [], directories: [], behaviors: [], hooks: [] },
    hookReport: { total: 0, intact: 0, broken: 0, checks: [] },
    skippedSteps: [],
    executionScore: 0,
    failureClassification: FAILURE_CLASSIFICATIONS.NOT_EVALUATED,
    status: "INCOMPLETE",
    strictMode: false,
    warnings: [],
  };
}
