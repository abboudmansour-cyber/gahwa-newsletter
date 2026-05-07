/**
 * prompt-evolver.js — Prompt Evolution Engine (Core)
 *
 * FINAL ARCHITECTURE — Manages prompt versioning and targeted evolution.
 *
 * Rules:
 *   - If same weakness appears in 3 consecutive runs (threshold configurable)
 *     → create a new prompt version with targeted improvement instructions
 *   - Otherwise keep stable — never rewrite on single weak runs
 *   - NEVER rewrite prompt structure, only append improvement instructions
 *   - Maintains versioned prompt files in prompts/ directory
 *
 * Extracted from the older feedback.js into its own module.
 *
 * @module prompt-evolver
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "..", "prompts");
const FEEDBACK_FILE = path.join(__dirname, "..", "logs", "feedback.json");
const CONSECUTIVE_WEAKNESS_THRESHOLD = 3;
const MAX_WEAKNESS_TAGS = 3;

// ── Init ────────────────────────────────────────────────────────────────────

try {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true });
} catch {
  // directory may already exist
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
    console.log(`[PROMPT-EVOLVER] Failed to write ${filePath}: ${err.message}`);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the current prompt version filename.
 * Scans prompts dir for newsletter_prompt_v*.md, returns the highest version.
 *
 * @returns {string} e.g. "newsletter_prompt_v1.md"
 */
export function getCurrentPromptVersion() {
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
 * Check if prompt evolution is needed based on feedback history.
 *
 * Rule: If 3 consecutive runs show the same weakness → trigger prompt modification.
 * Only prompt instructions evolve, NEVER system architecture.
 *
 * @param {Array} feedbackHistory - Full feedback history from feedback.json
 * @returns {boolean} true if prompt was evolved
 */
export function checkPromptEvolution(feedbackHistory) {
  if (!feedbackHistory || feedbackHistory.length < CONSECUTIVE_WEAKNESS_THRESHOLD) return false;

  const recent = feedbackHistory.slice(-CONSECUTIVE_WEAKNESS_THRESHOLD);
  const weaknessSets = recent.map((entry) => new Set(entry.weaknessTags || []));

  const commonWeaknesses = [...weaknessSets[0]].filter(
    (tag) =>
      weaknessSets[1].has(tag) &&
      weaknessSets[2].has(tag) &&
      tag !== "good quality — no major issues detected"
  );

  if (commonWeaknesses.length === 0) return false;

  for (const weakness of commonWeaknesses) {
    evolvePromptForWeakness(weakness, recent[recent.length - 1].suggestedPromptAdjustments);
  }

  return true;
}

/**
 * Evolve the newsletter prompt to address a persistent weakness.
 * Creates a new version with targeted improvements appended.
 *
 * @param {string} weakness - The weakness tag to address
 * @param {string} suggestion - Suggested adjustments from evaluation
 */
export function evolvePromptForWeakness(weakness, suggestion) {
  const currentVersion = getCurrentPromptVersion();
  const match = currentVersion.match(/newsletter_prompt_v(\d+)/);
  const versionNum = match ? parseInt(match[1], 10) : 1;
  const newVersion = versionNum + 1;

  const currentPromptPath = path.join(PROMPTS_DIR, `newsletter_prompt_v${versionNum}.md`);
  let currentContent = "";
  try {
    if (fs.existsSync(currentPromptPath)) {
      currentContent = fs.readFileSync(currentPromptPath, "utf-8");
    }
  } catch {
    // Create fresh if missing
  }

  const evolutionNote =
    `\n\n---\n## v${newVersion} Prompt Evolution\n\n` +
    `**Evolved on:** ${new Date().toISOString()}\n` +
    `**Triggered by:** "${weakness}" detected across 3 consecutive runs\n\n` +
    `### Targeted Improvement\n` +
    `This version includes the following adjustments to address recurring weakness:\n\n`;

  const adjustmentLines = suggestion
    ? `- ${suggestion.split(". ").filter(Boolean).map((s) => `${s.trim()}.`).join("\n- ")}`
    : `- Strengthen ${weakness.replace(/-/g, " ")}`;

  const newContent = currentContent
    ? currentContent + evolutionNote + adjustmentLines
    : evolutionNote + adjustmentLines;

  const newPromptPath = path.join(PROMPTS_DIR, `newsletter_prompt_v${newVersion}.md`);
  try {
    fs.writeFileSync(newPromptPath, newContent, "utf-8");
    console.log(
      `[PROMPT-EVOLVER] ⚡ Prompt evolved: newsletter_prompt_v${versionNum}.md → v${newVersion}.md`
    );
    console.log(`[PROMPT-EVOLVER]   Weakness addressed: ${weakness}`);
  } catch (err) {
    console.log(`[PROMPT-EVOLVER] Failed to evolve prompt: ${err.message}`);
  }
}

/**
 * Build a structured improvement hint string for injection into the DeepSeek prompt.
 * Includes:
 *   - Previous run score summary
 *   - Top 3 weakness tags
 *   - Last prompt version used + adjustments
 *   - Persistent weaknesses
 *   - CRITICAL instructions based on detected weaknesses
 *
 * @param {Array} feedbackHistory - Full feedback.json entries
 * @param {object} currentEval - Current evaluation result
 * @returns {string} Improvement hint section
 */
export function buildImprovementHint(feedbackHistory, currentEval) {
  const lastRun =
    feedbackHistory.length >= 2
      ? feedbackHistory[feedbackHistory.length - 2]
      : null;

  const promptVersion = getCurrentPromptVersion();

  let hint = "\n\n---\n### IMPROVE THESE WEAKNESSES IN THIS RUN\n";

  if (lastRun) {
    hint += `Last run overall score: ${lastRun.score.overall}/10\n`;
    hint +=
      `Last run scores — clarity: ${lastRun.score.clarity}, ` +
      `GCC relevance: ${lastRun.score.gccRelevance}, ` +
      `market depth: ${lastRun.score.marketDepth}, ` +
      `readability: ${lastRun.score.readability}\n`;
  }

  const weaknessTags = currentEval.weaknessTags || [];
  if (weaknessTags.length > 0) {
    hint += `\nTop weaknesses from last evaluation:\n`;
    for (const tag of weaknessTags.slice(0, MAX_WEAKNESS_TAGS)) {
      hint += `  - ${tag}\n`;
    }
  }

  const persistentWeaknesses = findPersistentWeaknesses(feedbackHistory, 5);
  if (persistentWeaknesses.length > 0) {
    hint += `\nPersistent weaknesses (appearing in recent runs):\n`;
    for (const pw of persistentWeaknesses.slice(0, 2)) {
      hint += `  - ${pw.tag} (${pw.count} of last 5 runs)\n`;
    }
  }

  hint += `\nCurrent prompt: ${promptVersion}\n`;
  if (currentEval.suggestedPromptAdjustments) {
    hint += `\nSuggested adjustments for this run:\n`;
    hint += `  ${currentEval.suggestedPromptAdjustments}\n`;
  }

  // Specific critical instructions based on weaknesses
  if (weaknessTags.includes("weak GCC specificity")) {
    hint +=
      `\nCRITICAL: Ensure strong GCC context. Mention specific countries (Saudi, UAE, Qatar) ` +
      `with local currency values and company names.\n`;
  }
  if (
    weaknessTags.includes("low market depth — missing data points") ||
    weaknessTags.includes("low macro insight")
  ) {
    hint +=
      `CRITICAL: Include specific numbers, percentages, and macro-economic data in every section.\n`;
  }
  if (
    weaknessTags.includes("too generic AI content") ||
    weaknessTags.includes("generic AI filler language detected")
  ) {
    hint +=
      `CRITICAL: Avoid generic corporate language. Be direct, specific, and data-driven.\n`;
  }

  return hint;
}

/**
 * Build a pre-run improvement hint for DeepSeek prompt injection.
 * Uses the LAST run's feedback — called BEFORE newsletter generation.
 *
 * @returns {string} Improvement hint or empty string if no history
 */
export function buildPreRunImprovementHint() {
  const history = readJson(FEEDBACK_FILE);
  if (history.length === 0) return "";

  const lastRun = history[history.length - 1];
  const promptVersion = getCurrentPromptVersion();

  let hint = "\n\n---\n### IMPROVE THESE WEAKNESSES IN THIS RUN\n";
  hint += `Last run overall score: ${lastRun.score.overall}/10\n`;
  hint +=
    `Last run scores — clarity: ${lastRun.score.clarity}, ` +
    `GCC relevance: ${lastRun.score.gccRelevance}, ` +
    `market depth: ${lastRun.score.marketDepth}, ` +
    `readability: ${lastRun.score.readability}\n`;

  const tags = lastRun.weaknessTags || [];
  if (tags.length > 0) {
    hint += `\nTop weaknesses from last evaluation:\n`;
    for (const tag of tags) {
      if (tag !== "good quality — no major issues detected") {
        hint += `  - ${tag}\n`;
      }
    }
  }

  const persistentWeaknesses = findPersistentWeaknesses(history, 5);
  if (persistentWeaknesses.length > 0) {
    hint += `\nPersistent weaknesses (appearing in recent runs):\n`;
    for (const pw of persistentWeaknesses.slice(0, 2)) {
      hint += `  - ${pw.tag} (${pw.count} of last 5 runs)\n`;
    }
  }

  hint += `\nCurrent prompt: ${promptVersion}\n`;
  if (lastRun.suggestedPromptAdjustments) {
    hint += `\nSuggested adjustments for this run:\n`;
    hint += `  ${lastRun.suggestedPromptAdjustments}\n`;
  }

  const tagsLower = tags.join(" ").toLowerCase();
  if (tagsLower.includes("weak gcc") || tagsLower.includes("gcc specific")) {
    hint +=
      `\nCRITICAL: Ensure strong GCC context. Mention specific countries (Saudi, UAE, Qatar) ` +
      `with local currency values and company names.\n`;
  }
  if (
    tagsLower.includes("market depth") ||
    tagsLower.includes("macro insight") ||
    tagsLower.includes("data")
  ) {
    hint +=
      `CRITICAL: Include specific numbers, percentages, and macro-economic data in every section.\n`;
  }
  if (tagsLower.includes("generic ai") || tagsLower.includes("filler")) {
    hint +=
      `CRITICAL: Avoid generic corporate language. Be direct, specific, and data-driven.\n`;
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
export function findPersistentWeaknesses(feedbackHistory, recentCount) {
  if (!feedbackHistory || feedbackHistory.length === 0) return [];
  const recent = feedbackHistory.slice(-recentCount);
  const weaknessCounts = {};

  for (const entry of recent) {
    const tags = new Set(entry.weaknessTags || []);
    for (const tag of tags) {
      weaknessCounts[tag] = (weaknessCounts[tag] || 0) + 1;
    }
  }

  return Object.entries(weaknessCounts)
    .filter(([_, count]) => count >= 2)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export default {
  getCurrentPromptVersion,
  checkPromptEvolution,
  evolvePromptForWeakness,
  buildImprovementHint,
  buildPreRunImprovementHint,
  findPersistentWeaknesses,
};
