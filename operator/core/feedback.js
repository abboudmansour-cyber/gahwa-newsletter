/**
 * feedback.js — v4 Self-Improving Feedback Loop
 *
 * Manages:
 *   1. `/logs/feedback.json` — structured feedback store (last 100 entries)
 *   2. Prompt evolution — detects recurring weaknesses across 3 consecutive runs
 *   3. Improvement summary — builds the "IMPROVE THESE WEAKNESSES" input for DeepSeek
 *
 * Pure filesystem-based learning. No ML. No external services.
 *
 * @module feedback
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateNewsletter } from "./evaluator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, "..", "logs");
const FEEDBACK_FILE = path.join(LOGS_DIR, "feedback.json");
const PROMPTS_DIR = path.resolve(__dirname, "..", "prompts");
const MAX_FEEDBACK = 100;
const CONSECUTIVE_WEAKNESS_THRESHOLD = 3;
const MAX_WEAKNESS_TAGS = 3;

// ── Prompts directory creation ────────────────────────────────────────────
try {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true });
} catch {
  // Silently fail — prompts dir might already exist
}

// ── Safe JSON file read/write helpers ──────────────────────────────────────

function readJson(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : defaultValue;
  } catch {
    return defaultValue;
  }
}

function writeJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.log(`[FEEDBACK] Failed to write ${filePath}: ${err.message}`);
  }
}

// ── Feedback entry structure ──────────────────────────────────────────────

/**
 * Build a standardized feedback entry from evaluator output.
 *
 * @param {string} runId
 * @param {object} scores - From evaluator.js
 * @returns {object} feedback entry
 */
function buildFeedbackEntry(runId, scores) {
  return {
    runId,
    timestamp: new Date().toISOString(),
    score: {
      clarity: scores.clarity ?? 7,
      gccRelevance: scores.gccRelevance ?? 7,
      marketDepth: scores.marketDepth ?? 7,
      readability: scores.readability ?? 7,
      overall: scores.overall ?? 7,
    },
    weaknessTags: (scores.weaknessTags || []).slice(0, MAX_WEAKNESS_TAGS),
    suggestedPromptAdjustments: scores.suggestedPromptAdjustments || "",
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Full feedback pipeline:
 *   1. Evaluate newsletter
 *   2. Append structured feedback to /logs/feedback.json
 *   3. Trim to last 100 entries
 *   4. Check for prompt evolution trigger
 *   5. Return feedback summary for DeepSeek ingestion
 *
 * @param {string} runId
 * @param {object} newsletter - Parsed newsletter JSON
 * @param {string} jobName - Job name for context
 * @returns {Promise<{evaluation: object, feedback: object, improvementHint: string, promptEvolved: boolean}>}
 */
export async function processFeedback(runId, newsletter, jobName = "daily-newsletter") {
  // Step 1: Evaluate
  const evaluation = evaluateNewsletter(newsletter);

  // Step 2: Build and append feedback entry
  const entry = buildFeedbackEntry(runId, evaluation);
  const history = readJson(FEEDBACK_FILE);
  history.push(entry);

  // Trim to max
  const trimmed = history.length > MAX_FEEDBACK ? history.slice(-MAX_FEEDBACK) : history;
  writeJson(FEEDBACK_FILE, trimmed);

  console.log(
    `[FEEDBACK] Saved run ${runId} — overall: ${entry.score.overall}/10, weaknesses: ${entry.weaknessTags.join(", ")}`
  );

  // Step 3: Check for prompt evolution trigger
  const promptEvolved = checkPromptEvolution(trimmed);
  if (promptEvolved) {
    console.log("[FEEDBACK] ⚡ Prompt evolution triggered — weaknesses detected across 3+ consecutive runs");
  }

  // Step 4: Build improvement hint for DeepSeek
  const improvementHint = buildImprovementHint(trimmed, evaluation);

  return {
    evaluation,
    feedback: entry,
    improvementHint,
    promptEvolved,
  };
}

/**
 * Build a structured improvement hint string for injection into the DeepSeek prompt.
 * Includes:
 *   - Previous run score summary
 *   - Top 3 weakness tags
 *   - Last prompt version used + adjustments
 *
 * @param {Array} feedbackHistory - Full feedback.json entries
 * @param {object} currentEval - Current evaluation result
 * @returns {string} Improvement hint section
 */
function buildImprovementHint(feedbackHistory, currentEval) {
  const lastRun = feedbackHistory.length >= 2
    ? feedbackHistory[feedbackHistory.length - 2]
    : null;

  // Get current prompt version
  const promptVersion = getCurrentPromptVersion();

  let hint = "\n\n---\n### IMPROVE THESE WEAKNESSES IN THIS RUN\n";

  // Previous run scores
  if (lastRun) {
    hint += `Last run overall score: ${lastRun.score.overall}/10\n`;
    hint += `Last run scores — clarity: ${lastRun.score.clarity}, ` +
      `GCC relevance: ${lastRun.score.gccRelevance}, ` +
      `market depth: ${lastRun.score.marketDepth}, ` +
      `readability: ${lastRun.score.readability}\n`;
  }

  // Weakness tags
  const weaknessTags = currentEval.weaknessTags || [];
  if (weaknessTags.length > 0) {
    hint += `\nTop weaknesses from last evaluation:\n`;
    for (const tag of weaknessTags.slice(0, MAX_WEAKNESS_TAGS)) {
      hint += `  - ${tag}\n`;
    }
  }

  // Persistent weaknesses (appearing in 2+ of last 5 runs)
  const persistentWeaknesses = findPersistentWeaknesses(feedbackHistory, 5);
  if (persistentWeaknesses.length > 0) {
    hint += `\nPersistent weaknesses (appearing in recent runs):\n`;
    for (const pw of persistentWeaknesses.slice(0, 2)) {
      hint += `  - ${pw.tag} (${pw.count} of last 5 runs)\n`;
    }
  }

  // Prompt version and adjustments
  hint += `\nCurrent prompt: ${promptVersion}\n`;
  if (currentEval.suggestedPromptAdjustments) {
    hint += `\nSuggested adjustments for this run:\n`;
    hint += `  ${currentEval.suggestedPromptAdjustments}\n`;
  }

  // Specific instruction based on weaknesses
  if (weaknessTags.includes("weak GCC specificity")) {
    hint += `\nCRITICAL: Ensure strong GCC context. Mention specific countries (Saudi, UAE, Qatar) ` +
      `with local currency values and company names.\n`;
  }
  if (weaknessTags.includes("low market depth — missing data points") ||
      weaknessTags.includes("low macro insight")) {
    hint += `CRITICAL: Include specific numbers, percentages, and macro-economic data in every section.\n`;
  }
  if (weaknessTags.includes("too generic AI content") ||
      weaknessTags.includes("generic AI filler language detected")) {
    hint += `CRITICAL: Avoid generic corporate language. Be direct, specific, and data-driven.\n`;
  }

  return hint;
}

/**
 * Find weaknesses that appear persistently across recent runs.
 *
 * @param {Array} feedbackHistory
 * @param {number} recentCount - Look back this many runs
 * @returns {Array<{tag: string, count: number}>}
 */
function findPersistentWeaknesses(feedbackHistory, recentCount) {
  const recent = feedbackHistory.slice(-recentCount);
  const weaknessCounts = {};

  for (const entry of recent) {
    const tags = new Set(entry.weaknessTags || []);
    for (const tag of tags) {
      weaknessCounts[tag] = (weaknessCounts[tag] || 0) + 1;
    }
  }

  return Object.entries(weaknessCounts)
    .filter(([_, count]) => count >= 2) // Appears in 2+ runs
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Prompt Evolution Rule:
 * If 3 consecutive runs show the same weakness → trigger prompt modification.
 * Otherwise keep stable. Only prompt text evolves, NEVER system architecture.
 *
 * @param {Array} feedbackHistory - Full feedback history
 * @returns {boolean} true if prompt was evolved
 */
function checkPromptEvolution(feedbackHistory) {
  if (feedbackHistory.length < CONSECUTIVE_WEAKNESS_THRESHOLD) return false;

  // Get last N entries
  const recent = feedbackHistory.slice(-CONSECUTIVE_WEAKNESS_THRESHOLD);

  // Find weaknesses that appear in ALL 3 consecutive runs
  const weaknessSets = recent.map((entry) => new Set(entry.weaknessTags || []));

  // Intersect weakness tags across all 3 runs
  const commonWeaknesses = [...weaknessSets[0]].filter(
    (tag) => weaknessSets[1].has(tag) && weaknessSets[2].has(tag) && tag !== "good quality — no major issues detected"
  );

  if (commonWeaknesses.length === 0) return false;

  // ── Evolve the prompt ─────────────────────────────────────────────
  for (const weakness of commonWeaknesses) {
    evolvePromptForWeakness(weakness, recent[recent.length - 1].suggestedPromptAdjustments);
  }

  return true;
}

/**
 * Evolve the newsletter prompt to address a persistent weakness.
 * Creates a new version of the prompt with targeted improvements.
 *
 * @param {string} weakness - The weakness tag to address
 * @param {string} suggestion - Suggested adjustments from evaluation
 */
function evolvePromptForWeakness(weakness, suggestion) {
  const currentVersion = getCurrentPromptVersion();
  const match = currentVersion.match(/newsletter_prompt_v(\d+)/);
  const versionNum = match ? parseInt(match[1], 10) : 1;
  const newVersion = versionNum + 1;

  // Read current prompt content
  const currentPromptPath = path.join(PROMPTS_DIR, `newsletter_prompt_v${versionNum}.md`);
  let currentContent = "";
  try {
    if (fs.existsSync(currentPromptPath)) {
      currentContent = fs.readFileSync(currentPromptPath, "utf-8");
    }
  } catch {
    // Fall through — create fresh if missing
  }

  // Build evolution section
  const evolutionNote = `\n\n---\n## v${newVersion} Prompt Evolution\n\n` +
    `**Evolved on:** ${new Date().toISOString()}\n` +
    `**Triggered by:** "${weakness}" detected across 3 consecutive runs\n\n` +
    `### Targeted Improvement\n` +
    `This version includes the following adjustments to address recurring weakness:\n\n`;

  const adjustmentLines = suggestion
    ? `- ${suggestion.split(". ").filter(Boolean).map((s) => `${s.trim()}.`).join("\n- ")}`
    : `- Strengthen ${weakness.replace(/-/g, " ")}`;

  // Create next version with evolution note appended
  const newContent = currentContent
    ? currentContent + evolutionNote + adjustmentLines
    : evolutionNote + adjustmentLines;

  const newPromptPath = path.join(PROMPTS_DIR, `newsletter_prompt_v${newVersion}.md`);
  try {
    fs.writeFileSync(newPromptPath, newContent, "utf-8");
    console.log(`[FEEDBACK] ⚡ Prompt evolved: newsletter_prompt_v${versionNum}.md → v${newVersion}.md`);
    console.log(`[FEEDBACK]   Weakness addressed: ${weakness}`);
  } catch (err) {
    console.log(`[FEEDBACK] Failed to evolve prompt: ${err.message}`);
  }
}

/**
 * Get the current prompt version filename.
 * Scans prompts dir for newsletter_prompt_v*.md, returns the highest version.
 *
 * @returns {string} e.g. "newsletter_prompt_v1.md"
 */
function getCurrentPromptVersion() {
  try {
    if (!fs.existsSync(PROMPTS_DIR)) return "newsletter_prompt_v1.md";
    const files = fs.readdirSync(PROMPTS_DIR);
    const promptFiles = files
      .filter((f) => f.startsWith("newsletter_prompt_v") && f.endsWith(".md"))
      .sort();

    if (promptFiles.length === 0) return "newsletter_prompt_v1.md";
    return promptFiles[promptFiles.length - 1];
  } catch {
    return "newsletter_prompt_v1.md";
  }
}

/**
 * Build a pre-run improvement hint for injection into DeepSeek prompt.
 * Uses the LAST run's feedback to tell DeepSeek what to improve BEFORE generating.
 * Called BEFORE newsletter generation (unlike buildImprovementHint which runs after).
 *
 * @returns {string} Improvement hint section to append to DeepSeek prompt
 */
export function buildPreRunImprovementHint() {
  const history = readJson(FEEDBACK_FILE);
  if (history.length === 0) {
    return "";
  }

  const lastRun = history[history.length - 1];
  const promptVersion = getCurrentPromptVersion();

  let hint = "\n\n---\n### IMPROVE THESE WEAKNESSES IN THIS RUN\n";

  // Last run scores
  hint += `Last run overall score: ${lastRun.score.overall}/10\n`;
  hint += `Last run scores — clarity: ${lastRun.score.clarity}, ` +
    `GCC relevance: ${lastRun.score.gccRelevance}, ` +
    `market depth: ${lastRun.score.marketDepth}, ` +
    `readability: ${lastRun.score.readability}\n`;

  // Weakness tags from last run
  const tags = lastRun.weaknessTags || [];
  if (tags.length > 0) {
    hint += `\nTop weaknesses from last evaluation:\n`;
    for (const tag of tags) {
      if (tag !== "good quality — no major issues detected") {
        hint += `  - ${tag}\n`;
      }
    }
  }

  // Persistent weaknesses (2+ of last 5 runs)
  const persistentWeaknesses = findPersistentWeaknesses(history, 5);
  if (persistentWeaknesses.length > 0) {
    hint += `\nPersistent weaknesses (appearing in recent runs):\n`;
    for (const pw of persistentWeaknesses.slice(0, 2)) {
      hint += `  - ${pw.tag} (${pw.count} of last 5 runs)\n`;
    }
  }

  // Prompt version
  hint += `\nCurrent prompt: ${promptVersion}\n`;
  if (lastRun.suggestedPromptAdjustments) {
    hint += `\nSuggested adjustments for this run:\n`;
    hint += `  ${lastRun.suggestedPromptAdjustments}\n`;
  }

  // Specific CRITICAL instructions based on weaknesses
  const tagsLower = tags.join(" ").toLowerCase();
  if (tagsLower.includes("weak gcc") || tagsLower.includes("gcc specific")) {
    hint += `\nCRITICAL: Ensure strong GCC context. Mention specific countries (Saudi, UAE, Qatar) ` +
      `with local currency values and company names.\n`;
  }
  if (tagsLower.includes("market depth") || tagsLower.includes("macro insight") || tagsLower.includes("data")) {
    hint += `CRITICAL: Include specific numbers, percentages, and macro-economic data in every section.\n`;
  }
  if (tagsLower.includes("generic ai") || tagsLower.includes("filler")) {
    hint += `CRITICAL: Avoid generic corporate language. Be direct, specific, and data-driven.\n`;
  }

  return hint;
}

/**
 * Get the feedback history for external use (e.g., by replay.js or status checks).
 * @returns {Array}
 */
export function getFeedbackHistory() {
  return readJson(FEEDBACK_FILE);
}

/**
 * Get the latest feedback entry.
 * @returns {object|null}
 */
export function getLatestFeedback() {
  const history = readJson(FEEDBACK_FILE);
  return history.length > 0 ? history[history.length - 1] : null;
}
