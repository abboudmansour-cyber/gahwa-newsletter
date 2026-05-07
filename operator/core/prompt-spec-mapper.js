/**
 * prompt-spec-mapper.js — Prompt Specification Mapper
 *
 * Parses Cline prompts to extract expected artifacts — files, modules,
 * functions, logs, and behaviors — that should exist after execution.
 *
 * This is the FIRST component of the Prompt Execution Validator Layer.
 * It transforms a prompt string into a structured expectation map that
 * can be verified against the actual filesystem.
 *
 * Expected Artifact Types:
 *   - files       : file paths that should exist after prompt execution
 *   - functions   : named functions/classes that should be defined
 *   - logs        : log file entries that should be produced
 *   - modules     : importable modules that should be created
 *   - behaviors   : behavioral outcomes (e.g., "webhook called", "git push")
 *
 * @module prompt-spec-mapper
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Regex patterns for extracting expected deliverables ──────────────────────

const PATTERNS = {
  // File creation patterns: "CREATE file", "create file", "Add file", "write to"
  fileCreation: [
    /(?:create|add|write|generate|save)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?(?:at\s+)?[`']?([\w./-]+\.[a-z]+)[`']?/gi,
    /(?:create|add|write|generate|save)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?(?:at\s+)?[`']?([\w./-]+)[`']?/gi,
    /`([\w./-]+\.[a-z]+)`/g,
    /\/operator\/(?:core|logs|prompts)\/[\w./-]+\.[a-z]+/g,
  ],

  // Module/class/function definition patterns
  functionDefinition: [
    /(?:module|class|function|method|handler)\s+[`']?(\w+)[`']?/gi,
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)\s*=/g,
    /def\s+(\w+)\s*\(/g,
    /function\s+(\w+)\s*\(/g,
  ],

  // Log file patterns: "log to", "write to log", "log file"
  logArtifact: [
    /(?:log|record|write)\s+(?:to\s+)?(?:the\s+)?(?:log\s+)?[`']?([\w./-]+\.json)[`']?/gi,
    /(?:audit|report)\s+(?:file|log|entry)/gi,
  ],

  // Behavioral patterns: "on success do X", "when Y happens"
  behavioralAction: [
    /(?:must|should|will|shall|need to)\s+(\w+(?:\s+\w+){0,3})/gi,
    /(?:trigger|call|invoke|execute|run)\s+(\w+(?:\s+\w+){0,3})/gi,
    /block\s+(?:next\s+)?prompt\s+(?:if|when)/gi,
  ],

  // Directory creation patterns
  directoryCreation: [
    /(?:create|add|ensure)\s+(?:directory|folder|dir)\s+[`']?([\w./-]+)[`']?/gi,
  ],
};

// ── Known project structure for context-aware extraction ──────────────────────

const KNOWN_BASE_DIRS = [
  "operator/core",
  "operator/logs",
  "operator/prompts",
  "operator/runtime",
  "operator/output",
  "operator/memory",
  "operator/tools",
  "scripts",
  "docs",
  "output",
  "newsletters",
  "tests",
  "templates",
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a prompt string and extract all expected deliverables.
 *
 * @param {string} promptName - A descriptive name for this prompt
 * @param {string} promptText - The full prompt text to parse
 * @returns {object} Mapped specification with expected artifacts
 */
export function mapPromptSpec(promptName, promptText) {
  if (!promptText || typeof promptText !== "string") {
    console.warn(`[PROMPT-MAPPER] No prompt text provided for "${promptName}"`);
    return createEmptySpec(promptName);
  }

  console.log(`\n📐 [PROMPT-MAPPER] Parsing prompt: "${promptName}"`);

  const expectedFiles = extractExpectedFiles(promptText);
  const expectedFunctions = extractExpectedFunctions(promptText);
  const expectedLogs = extractExpectedLogs(promptText);
  const expectedBehaviors = extractExpectedBehaviors(promptText);
  const expectedDirectories = extractExpectedDirectories(promptText);

  const spec = {
    promptName,
    timestamp: new Date().toISOString(),
    expectedFiles,
    expectedFunctions,
    expectedLogs,
    expectedBehaviors,
    expectedDirectories,
    raw: promptText.slice(0, 500), // Store preview for reference
  };

  console.log(`   📁 Files expected:     ${expectedFiles.length > 0 ? expectedFiles.join(", ") : "(none detected)"}`);
  console.log(`   🔧 Functions expected: ${expectedFunctions.length > 0 ? expectedFunctions.join(", ") : "(none detected)"}`);
  console.log(`   📝 Logs expected:      ${expectedLogs.length > 0 ? expectedLogs.join(", ") : "(none detected)"}`);
  console.log(`   🎯 Behaviors expected: ${expectedBehaviors.length > 0 ? expectedBehaviors.length : "(none detected)"}`);
  console.log(`   📂 Directories:        ${expectedDirectories.length > 0 ? expectedDirectories.join(", ") : "(none detected)"}`);

  return spec;
}

/**
 * Parse multiple prompts and return a merged spec.
 * Useful when a single execution involves multiple Cline prompts.
 *
 * @param {Array<{name: string, text: string}>} prompts
 * @returns {object} Merged specification
 */
export function mapMultiPromptSpec(prompts) {
  const merged = createEmptySpec("merged-multi-prompt");

  for (const { name, text } of prompts) {
    const spec = mapPromptSpec(name, text);
    merged.expectedFiles.push(...spec.expectedFiles);
    merged.expectedFunctions.push(...spec.expectedFunctions);
    merged.expectedLogs.push(...spec.expectedLogs);
    merged.expectedBehaviors.push(...spec.expectedBehaviors);
    merged.expectedDirectories.push(...spec.expectedDirectories);
    merged.subPrompts.push(name);
  }

  // Deduplicate
  merged.expectedFiles = [...new Set(merged.expectedFiles)];
  merged.expectedFunctions = [...new Set(merged.expectedFunctions)];
  merged.expectedLogs = [...new Set(merged.expectedLogs)];
  merged.expectedBehaviors = deduplicateBehaviors(merged.expectedBehaviors);
  merged.expectedDirectories = [...new Set(merged.expectedDirectories)];

  return merged;
}

/**
 * Load a prompt from a file and map it.
 *
 * @param {string} promptName - Name for this prompt
 * @param {string} filePath - Path to the prompt file (relative to project root)
 * @returns {object|null} Mapped specification, or null if file not found
 */
export function mapPromptFromFile(promptName, filePath) {
  try {
    const resolved = path.resolve(__dirname, "..", filePath);
    if (!fs.existsSync(resolved)) {
      console.warn(`[PROMPT-MAPPER] Prompt file not found: ${filePath}`);
      return null;
    }
    const text = fs.readFileSync(resolved, "utf-8");
    return mapPromptSpec(promptName, text);
  } catch (err) {
    console.error(`[PROMPT-MAPPER] Error reading prompt file: ${err.message}`);
    return null;
  }
}

/**
 * Parse prompt from process argv or environment.
 *
 * @returns {object} Specification from argv-supplied prompt
 */
export function mapPromptFromArgv() {
  const promptName = process.argv[2] || "unnamed-prompt";
  const promptText = process.argv[3] || "";
  return mapPromptSpec(promptName, promptText);
}

/**
 * Create a manually defined specification (for cases where auto-parsing is unreliable).
 *
 * @param {string} promptName
 * @param {object} manualSpec - Object with expectedFiles[], expectedFunctions[], etc.
 * @returns {object} Complete specification
 */
export function createManualSpec(promptName, manualSpec = {}) {
  return {
    promptName,
    timestamp: new Date().toISOString(),
    expectedFiles: manualSpec.expectedFiles || [],
    expectedFunctions: manualSpec.expectedFunctions || [],
    expectedLogs: manualSpec.expectedLogs || [],
    expectedBehaviors: manualSpec.expectedBehaviors || [],
    expectedDirectories: manualSpec.expectedDirectories || [],
    raw: "(manual specification)",
    isManual: true,
  };
}

// ── Internal Extraction Logic ────────────────────────────────────────────────

/**
 * Extract expected file paths from a prompt.
 */
function extractExpectedFiles(text) {
  const files = new Set();

  for (const pattern of PATTERNS.fileCreation) {
    let match;
    // Reset lastIndex for non-global regexps
    if (pattern instanceof RegExp && !pattern.global) break;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[1] || match[0];
      // Normalize path
      const normalized = candidate.replace(/^[`']|[`']$/g, "").trim();
      if (isLikelyFilePath(normalized)) {
        files.add(normalized);
      }
    }
  }

  return [...files];
}

/**
 * Extract expected function/class/module names from a prompt.
 */
function extractExpectedFunctions(text) {
  const functions = new Set();

  for (const pattern of PATTERNS.functionDefinition) {
    let match;
    if (pattern instanceof RegExp && !pattern.global) {
      const m = pattern.exec(text);
      if (m) functions.add(m[1]);
      continue;
    }
    // Reset and iterate for global patterns
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1];
      if (name && isLikelyFunctionName(name)) {
        functions.add(name);
      }
    }
  }

  return [...functions];
}

/**
 * Extract expected log artifacts from a prompt.
 */
function extractExpectedLogs(text) {
  const logs = new Set();

  for (const pattern of PATTERNS.logArtifact) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const logPath = match[1];
      if (logPath) {
        logs.add(logPath);
      } else {
        // Generic log artifact detected
        logs.add("(unspecified log artifact)");
      }
    }
  }

  return [...logs];
}

/**
 * Extract expected behavioral actions from a prompt.
 */
function extractExpectedBehaviors(text) {
  const behaviors = [];

  for (const pattern of PATTERNS.behavioralAction) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const action = match[1] || match[0];
      if (action) {
        behaviors.push(action.trim());
      }
    }
  }

  return deduplicateBehaviors(behaviors);
}

/**
 * Extract expected directory creations from a prompt.
 */
function extractExpectedDirectories(text) {
  const dirs = new Set();

  for (const pattern of PATTERNS.directoryCreation) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const dir = match[1];
      if (dir) {
        dirs.add(dir.replace(/^[`']|[`']$/g, "").trim());
      }
    }
  }

  return [...dirs];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Determine if a string looks like a valid file path.
 */
function isLikelyFilePath(str) {
  if (!str || str.length < 3) return false;

  // Must have a file extension or be a known path pattern
  const hasExtension = /\.[a-z]{2,}$/i.test(str);
  const isKnownPath = KNOWN_BASE_DIRS.some((dir) => str.startsWith(dir));
  const isAbsolute = str.startsWith("/");

  return hasExtension || isKnownPath || isAbsolute;
}

/**
 * Determine if a string looks like a valid function/class name.
 */
function isLikelyFunctionName(str) {
  if (!str || str.length < 2) return false;
  // Must be a valid JS identifier start
  return /^[a-zA-Z_$][\w$]*$/.test(str);
}

/**
 * Deduplicate behavioral entries by their core action verb.
 */
function deduplicateBehaviors(behaviors) {
  return [...new Set(behaviors.map((b) => b.toLowerCase().trim()))];
}

/**
 * Create an empty spec object for fallback.
 */
function createEmptySpec(promptName) {
  return {
    promptName,
    timestamp: new Date().toISOString(),
    expectedFiles: [],
    expectedFunctions: [],
    expectedLogs: [],
    expectedBehaviors: [],
    expectedDirectories: [],
    subPrompts: [],
    raw: "",
  };
}
