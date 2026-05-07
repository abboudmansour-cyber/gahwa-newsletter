#!/usr/bin/env node

/**
 * audit-runner.js — Standalone Prompt Audit CLI v2.0
 *
 * Runs the FULL Gahwa Atomic Execution Standard including:
 *   - Format Enforcement (validate 10-section prompt structure BEFORE)
 *   - Completeness Audit (verify artifacts AFTER, including brokenHooks)
 *   - Retry Generation (for incomplete runs)
 *   - Diff Guard (git-based change tracking)
 *   - Prompt Generation (10-section atomic prompts)
 *   - Traceability Map (feature→file→function→executor mapping)
 *   - Audit Log management
 *
 * Usage:
 *   node operator/audit-runner.js --help
 *   node operator/audit-runner.js --status
 *   node operator/audit-runner.js --enforce "prompt text" --level STRICT
 *   node operator/audit-runner.js --audit <prompt-name> -f f1 -fn fn1 -bh hook1
 *   node operator/audit-runner.js --diff --protect "file1" "file2"
 *   node operator/audit-runner.js --generate --objective "..." --files "f1" --functions "fn1"
 *   node operator/audit-runner.js --traceability
 *   node operator/audit-runner.js --retry
 *   node operator/audit-runner.js --log [count]
 *
 * @module audit-runner
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Import validator modules ──────────────────────────────────────────────────
async function loadModules() {
  const mapper = await import("./core/prompt-spec-mapper.js");
  const checker = await import("./core/prompt-completeness-checker.js");
  const auditor = await import("./core/prompt-auditor.js");
  const enforcer = await import("./core/prompt-format-enforcer.js");
  const diffGuard = await import("./core/diff-guard.js");
  const generator = await import("./core/prompt-generator.js");
  const traceability = await import("./core/traceability-matcher.js");
  return { mapper, checker, auditor, enforcer, diffGuard, generator, traceability };
}

// ── CLI Main ──────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  const modules = await loadModules();
  const { mapper, checker, auditor, enforcer, diffGuard, generator, traceability } = modules;

  // ── Usage / Help ────────────────────────────────────────────────────────
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  // ── Status ──────────────────────────────────────────────────────────────
  if (command === "--status" || command === "-s") {
    return printStatus(auditor, enforcer);
  }

  // ── Enforce: validate prompt structure BEFORE execution (10 sections) ───
  if (command === "--enforce" || command === "-e") {
    const promptText = args.slice(1).join(" ");
    const level = extractValue(args, "--level") || "NORMAL";
    return await runEnforce(enforcer, promptText, level);
  }

  // ── Check: quick file existence ─────────────────────────────────────────
  if (command === "--check" || command === "-c") {
    const promptName = args[1] || "quick-check";
    const expectedFiles = args.slice(2).filter((a) => !a.startsWith("--"));
    return await runCheck(auditor, checker, promptName, expectedFiles);
  }

  // ── Audit: full completeness check (with brokenHooks in v2.0) ───────────
  if (command === "--audit" || command === "-a") {
    const promptName = args[1] || "manual-audit";
    const expectedFiles = extractFlag(args, "--expected-files", "-f");
    const expectedFuncs = extractFlag(args, "--expected-funcs", "-fn");
    const expectedLogs = extractFlag(args, "--expected-logs", "-l");
    const expectedBrokenHooks = extractFlag(args, "--broken-hooks", "-bh");

    return await runFullAudit(auditor, checker, promptName, expectedFiles, expectedFuncs, expectedLogs, expectedBrokenHooks);
  }

  // ── Diff: git-based change tracking ─────────────────────────────────────
  if (command === "--diff" || command === "-d") {
    const protectedFiles = extractFlag(args, "--protect", "-p");
    const expectedChanges = extractFlag(args, "--expect-changes", "-ec");
    return await runDiff(diffGuard, protectedFiles, expectedChanges);
  }

  // ── Traceability: feature→file→function→executor mapping (NEW v2.0) ────
  if (command === "--traceability" || command === "-t") {
    return await runTraceability(traceability, args);
  }

  // ── Generate: create 10-section atomic-format prompt ────────────────────
  if (command === "--generate" || command === "-g") {
    return await runGenerate(generator, args);
  }

  // ── Retry: generate retry prompt for last incomplete run ────────────────
  if (command === "--retry" || command === "-r") {
    return await getRetryPrompt(auditor, generator);
  }

  // ── Log: view audit entries ─────────────────────────────────────────────
  if (command === "--log" || command === "-l") {
    const count = parseInt(args[1], 10) || 10;
    return await viewLog(auditor, count);
  }

  // ── Last: view last run ─────────────────────────────────────────────────
  if (command === "--last") {
    return await viewLast(auditor);
  }

  // ── Clear audit log ─────────────────────────────────────────────────────
  if (command === "--clear") {
    auditor.clearAuditLog();
    console.log("✅ Audit log cleared successfully");
    return;
  }

  // ── Pipeline: run full pipeline (enforce → validate → traceability) ─────
  if (command === "--pipeline" || command === "-pl") {
    const promptName = extractValue(args, "--prompt-name") || "pipeline-run";
    const expectedFiles = extractFlag(args, "--files");
    const expectedFuncs = extractFlag(args, "--functions");
    const expectedLogs = extractFlag(args, "--logs");
    const expectedBrokenHooks = extractFlag(args, "--hooks");
    return await runPipeline(modules, { promptName, expectedFiles, expectedFuncs, expectedLogs, expectedBrokenHooks });
  }

  // ── Unknown command ─────────────────────────────────────────────────────
  console.log(`❌ Unknown command: ${command}`);
  printUsage();
}

// ── CLI Helpers ───────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     ATOMIC PROMPT EXECUTION AUDITOR — CLI v2.0          ║
║     Gahwa Atomic Execution Standard                     ║
║     Sections 0-9: Enforce · Verify · Generate · Diff    ║
╚══════════════════════════════════════════════════════════╝

USAGE:
  node operator/audit-runner.js <command> [options]

COMMANDS:

  ---GENERAL---
  --status, -s                  Check system status + last run verdict
  --help, -h                    Show this help message

  ---BEFORE PROMPT EXECUTION---
  --enforce, -e "<prompt>"      Validate prompt follows 10-section Atomic Format
    --level <STRICT|NORMAL|LENIENT>  Validation strictness (default: NORMAL)

  ---AFTER PROMPT EXECUTION---
  --check, -c <name> [files...] Quick check: verify files exist
  --audit, -a <name>            Full completeness audit (v2.0 with brokenHooks):
    --expected-files, -f        List of expected file paths
    --expected-funcs, -fn       List of expected function names
    --expected-logs, -l         List of expected log artifacts
    --broken-hooks, -bh         List of hook integrity checks

  ---DIFF GUARD---
  --diff, -d                    Snapshot + compare filesystem changes
    --protect, -p               Files that must NOT be modified
    --expect-changes, -ec       Files that SHOULD have changed

  ---TRACEABILITY (NEW)---
  --traceability, -t            Build feature→file→function→executor map
    --feature <name>            Map a single feature (optional)
    --file <path>               Verify executor reachability for single file

  ---PROMPT GENERATION---
  --generate, -g                Generate 10-section atomic-format prompt:
    --objective "<text>"        Concrete objective (required)
    --files "f1" "f2"           Required file paths to create
    --functions "fn1" "fn2"     Required function names
    --logs "l1" "l2"            Required log file paths
    --rules "r1" "r2"           Custom implementation rules
    --protect "p1" "p2"         Files that must NOT be modified
    --hooks "h1" "h2"           Hook integrity checks

  ---RECOVERY---
  --retry, -r                   Generate retry prompt for last incomplete run

  ---PIPELINE---
  --pipeline, -pl               Run full pipeline (enforce + validate + traceability)
    --prompt-name <name>        Name for this pipeline run
    --files "f1" "f2"           Expected files
    --functions "fn1" "fn2"     Expected functions
    --hooks "h1" "h2"           Hook integrity checks

  ---ADMIN---
  --log, -l [count]             View recent audit entries (default: 10)
  --last                        View the last completed run
  --clear                       Reset the audit log

EXAMPLES:
  node operator/audit-runner.js --status
  node operator/audit-runner.js --enforce "Your prompt text here" --level STRICT
  node operator/audit-runner.js --audit "feature-x" -f "path/to/file.js" -fn "myFunc" -bh "hook-check"
  node operator/audit-runner.js --diff --protect "operator/core/evaluator.js"
  node operator/audit-runner.js --traceability
  node operator/audit-runner.js --traceability --feature "prompt-validation"
  node operator/audit-runner.js --generate --objective "Add webhook handler" --files "operator/core/handler.js" --functions "processWebhook"
  node operator/audit-runner.js --pipeline --prompt-name "my-change" --files "file.js" --functions "fn"
  node operator/audit-runner.js --retry
`);
}

function extractFlag(args, longFlag, shortFlag) {
  const items = [];
  let collecting = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === longFlag || args[i] === shortFlag) {
      collecting = true;
      continue;
    }
    if (collecting) {
      if (args[i].startsWith("--") || args[i].startsWith("-")) break;
      items.push(args[i]);
    }
  }

  return items;
}

function extractValue(args, flag) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return null;
}

// ── Command Implementations ───────────────────────────────────────────────────

async function runEnforce(enforcer, promptText, level) {
  if (!promptText || promptText.trim().length === 0) {
    console.log(`\n❌ [ENFORCE v2.0] No prompt text provided. Usage:`);
    console.log(`   node operator/audit-runner.js --enforce "your prompt here"`);
    console.log(`   node operator/audit-runner.js --enforce "prompt" --level STRICT`);
    return;
  }

  enforcer.enforcePromptFormat(promptText, { level });
}

async function runDiff(diffGuard, protectedFiles, expectedChanges) {
  console.log(`\n🛡️ [DIFF GUARD] Running diff scan`);

  const before = diffGuard.createSnapshot();
  const after = diffGuard.createSnapshot();

  const report = diffGuard.compareSnapshots(before, after, {
    protectedFiles,
    expectedChanges,
  });

  console.log(`\n📋 DIFF VERDICT: ${report.verdict.passed ? "✅ PASS" : "⛔ FAIL"}`);
  if (!report.verdict.passed) {
    console.log(`\n❌ Issues found:`);
    report.verdict.protectedViolations.forEach((v) =>
      console.log(`   🚫 ${v.file}: ${v.reason}`)
    );
    report.verdict.missingChanges.forEach((f) =>
      console.log(`   ❓ Expected change missing: ${f}`)
    );
  }

  return report;
}

/**
 * NEW v2.0: Run traceability analysis.
 */
async function runTraceability(traceability, args) {
  const featureName = extractValue(args, "--feature");
  const filePath = extractValue(args, "--file");

  if (featureName) {
    console.log(`\n🗺️  [TRACEABILITY] Mapping single feature: "${featureName}"`);
    return traceability.mapFeatureToFile(featureName);
  }

  if (filePath) {
    console.log(`\n🗺️  [TRACEABILITY] Verifying executor reachability for: "${filePath}"`);
    return traceability.verifyExecutorReachability(filePath);
  }

  console.log(`\n🗺️  [TRACEABILITY] Building full traceability map`);
  const map = traceability.buildTraceabilityMap({ persist: true });
  return map;
}

async function runGenerate(generator, args) {
  const objective = extractValue(args, "--objective");
  const files = extractFlag(args, "--files");
  const functions = extractFlag(args, "--functions");
  const logs = extractFlag(args, "--logs");
  const rules = extractFlag(args, "--rules");
  const hooks = extractFlag(args, "--hooks");

  if (!objective) {
    console.log(`\n❌ [GENERATE] --objective is required. Example:`);
    console.log(`   node operator/audit-runner.js --generate \\`);
    console.log(`     --objective "Add webhook handler" \\`);
    console.log(`     --files "operator/core/handler.js" \\`);
    console.log(`     --functions "processWebhook"`);
    return;
  }

  const prompt = generator.generateAtomicPrompt({
    objective,
    files,
    functions: functions,
    logs,
    rules,
    brokenHooks: hooks,
  });

  console.log(`\n═════════════════════════════════════════════════════════`);
  console.log(`📝 GENERATED ATOMIC PROMPT (10-Section Standard)`);
  console.log(`═════════════════════════════════════════════════════════\n`);
  console.log(prompt);
  console.log(`\n═════════════════════════════════════════════════════════`);
  console.log(`📋 Copy the prompt above and paste it as your Cline task.`);
  console.log(`   After execution, validate with: --audit or --check`);
  console.log(`   Verify traceability with: --traceability`);
  console.log(`═════════════════════════════════════════════════════════\n`);

  return prompt;
}

async function printStatus(auditor) {
  const lastRun = auditor.getLastRun();
  const isComplete = auditor.isLastRunComplete();
  const log = auditor.getAuditLog();

  console.log(`\n═══════════════════════════════════════`);
  console.log(`📊 AUDIT SYSTEM STATUS v2.0`);
  console.log(`═══════════════════════════════════════`);
  console.log(`Total runs tracked: ${log.length}`);
  console.log(`Last run:           ${lastRun ? lastRun.promptName : "(none)"}`);
  console.log(`Status:             ${lastRun ? lastRun.status : "N/A"}`);
  console.log(`Score:              ${lastRun ? lastRun.executionScore + "/100" : "N/A"}`);
  console.log(`Classification:     ${lastRun ? lastRun.failureClassification : "N/A"}`);
  console.log(`Next prompt:        ${isComplete ? "✅ PERMITTED" : "⛔ BLOCKED (incomplete)"}`);

  if (lastRun && !isComplete) {
    const retry = auditor.generateRetryPrompt(lastRun);
    console.log(`\n🔄 RETRY PROMPT AVAILABLE — run with --retry`);
  }

  console.log(`═══════════════════════════════════════\n`);
}

async function runCheck(auditor, checker, promptName, expectedFiles) {
  const spec = {
    promptName,
    timestamp: new Date().toISOString(),
    expectedFiles,
    expectedFunctions: [],
    expectedLogs: [],
    expectedBehaviors: [],
    expectedDirectories: [],
    expectedBrokenHooks: [],
    raw: "(CLI check)",
  };

  const startResult = auditor.startRun({ promptName, force: true });
  const result = auditor.completeRun(startResult.runId, { spec });

  console.log(`\n📋 VERDICT:`);
  if (result.isComplete) {
    console.log(`✅ All ${expectedFiles.length} expected file(s) confirmed on disk`);
  } else {
    console.log(`❌ ${result.missingItems.files.length}/${expectedFiles.length} file(s) missing`);
    result.missingItems.files.forEach((f) => console.log(`   • ${f}`));
    console.log(`\n🔄 Retry with: node operator/audit-runner.js --retry`);
  }

  return result;
}

async function runFullAudit(auditor, checker, promptName, expectedFiles, expectedFuncs, expectedLogs, expectedBrokenHooks) {
  const spec = {
    promptName,
    timestamp: new Date().toISOString(),
    expectedFiles,
    expectedFunctions: expectedFuncs,
    expectedLogs,
    expectedBehaviors: [],
    expectedDirectories: [],
    expectedBrokenHooks,
    raw: "(CLI full audit v2.0)",
  };

  const startResult = auditor.startRun({ promptName, force: true });
  const result = auditor.completeRun(startResult.runId, { spec });

  console.log(`\n📋 VERDICT:`);
  console.log(`Score:          ${result.executionScore}/100`);
  console.log(`Status:         ${result.status}`);
  console.log(`Classification: ${result.failureClassification}`);

  if (!result.isComplete) {
    console.log(`\n❌ FAILURES:`);
    if (result.missingItems.files.length > 0) {
      console.log(`   Files:     ${result.missingItems.files.join(", ")}`);
    }
    if (result.missingItems.functions.length > 0) {
      console.log(`   Functions: ${result.missingItems.functions.join(", ")}`);
    }
    if (result.missingItems.logs.length > 0) {
      console.log(`   Logs:      ${result.missingItems.logs.join(", ")}`);
    }
    if (result.missingItems.brokenHooks && result.missingItems.brokenHooks.length > 0) {
      console.log(`   Hooks:     ${result.missingItems.brokenHooks.join(", ")}`);
    }
  }

  return result;
}

async function getRetryPrompt(auditor) {
  const lastRun = auditor.getLastRun();

  if (!lastRun) {
    console.log("❌ No previous run found");
    return;
  }

  const isComplete = auditor.isLastRunComplete();

  if (isComplete) {
    console.log("✅ Last run was complete — no retry needed");
    return;
  }

  const retryPrompt = auditor.generateRetryPrompt(lastRun);
  console.log(`\n🔄 RETRY PROMPT for "${lastRun.promptName}"`);
  console.log("═".repeat(60));
  console.log(retryPrompt);
  console.log("═".repeat(60));
  console.log(`\n📋 Copy the retry prompt above and run it as a new Cline prompt.`);
  console.log(`   After completion, run: node operator/audit-runner.js --status`);
}

async function viewLog(auditor, count) {
  const log = auditor.getAuditLog();
  const recent = log.slice(-count).reverse();

  if (recent.length === 0) {
    console.log("📝 Audit log is empty");
    return;
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`📝 RECENT AUDIT ENTRIES (last ${recent.length})`);
  console.log(`═══════════════════════════════════════`);

  recent.forEach((entry, i) => {
    const icon = entry.status === "COMPLETE" ? "✅" :
                 entry.status === "BLOCKED" ? "⛔" :
                 entry.status === "RUNNING" ? "🔄" : "❌";
    console.log(`\n${i + 1}. ${icon} ${entry.promptName}`);
    console.log(`   ID:     ${entry.runId}`);
    console.log(`   Status: ${entry.status} (${entry.executionScore !== null ? entry.executionScore + "/100" : "N/A"})`);
    console.log(`   Class:  ${entry.failureClassification || "N/A"}`);
    console.log(`   Block:  ${entry.blockedNextPrompt ? "⛔ YES" : "NO"}`);
    if (entry.missingItems?.files?.length > 0) {
      console.log(`   Missing: ${entry.missingItems.files.join(", ")}`);
    }
    if (entry.missingItems?.brokenHooks?.length > 0) {
      console.log(`   Broken:  ${entry.missingItems.brokenHooks.join(", ")}`);
    }
  });

  console.log(`\n═══════════════════════════════════════\n`);
}

async function viewLast(auditor) {
  const lastRun = auditor.getLastRun();

  if (!lastRun) {
    console.log("❌ No previous run found");
    return;
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`📋 LAST RUN DETAILS`);
  console.log(`═══════════════════════════════════════`);
  console.log(JSON.stringify(lastRun, null, 2));
  console.log(`═══════════════════════════════════════\n`);
}

/**
 * NEW v2.0: Run full pipeline (enforce + validate + traceability).
 */
async function runPipeline(modules, config) {
  const { promptName, expectedFiles = [], expectedFuncs = [], expectedLogs = [], expectedBrokenHooks = [] } = config;

  console.log(`\n🏗️  [PIPELINE v2.0] Running full atomic execution standard`);
  console.log(`   Prompt:  "${promptName}"`);
  console.log(`   Files:   ${expectedFiles.length}`);
  console.log(`   Funcs:   ${expectedFuncs.length}`);
  console.log(`   Hooks:   ${expectedBrokenHooks.length}`);

  // Layer 1: Validate execution
  const { startRun, completeRun } = modules.auditor;
  const { checkManualCompleteness } = modules.checker;

  const startResult = startRun({ promptName, force: true });

  const spec = {
    promptName,
    timestamp: new Date().toISOString(),
    expectedFiles,
    expectedFunctions: expectedFuncs,
    expectedLogs,
    expectedBehaviors: [],
    expectedDirectories: [],
    expectedBrokenHooks,
    raw: "(pipeline)",
  };

  const result = completeRun(startResult.runId, { spec });

  console.log(`\n📋 PIPELINE VERDICT:`);
  console.log(`   Score:      ${result.executionScore}/100`);
  console.log(`   Status:     ${result.status}`);
  console.log(`   Class:      ${result.failureClassification}`);

  if (!result.isComplete) {
    if (result.missingItems.files.length > 0) {
      console.log(`\n❌ Missing files: ${result.missingItems.files.join(", ")}`);
    }
    if (result.missingItems.brokenHooks?.length > 0) {
      console.log(`\n❌ Broken hooks: ${result.missingItems.brokenHooks.join(", ")}`);
    }
  }

  // Layer 2: Build traceability map
  const { buildTraceabilityMap } = modules.traceability;
  buildTraceabilityMap({ persist: true });

  console.log(`\n🏁 Pipeline complete. Status: ${result.status === "COMPLETE" ? "✅ PASS" : "⛔ FAIL"}`);

  return result;
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(`[AUDIT-RUNNER] Fatal error: ${err.message}`);
  process.exit(1);
});
