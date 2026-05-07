/**
 * evaluator.js — v3 Self-Improving Feedback Loop
 *
 * Evaluates newsletter output quality using DeepSeek.
 * Returns structured scores or safe defaults on failure.
 * Never crashes the operator pipeline.
 */

import { askDeepSeek } from "./deepseek.js";

const DEFAULT_SCORES = {
  clarity: 7,
  relevance: 7,
  gcc_focus: 7,
  readability: 7,
  overall: 7,
  issues: [],
};

/**
 * Evaluate a newsletter JSON object for quality metrics.
 *
 * @param {object} newsletter - The newsletter JSON output to evaluate
 * @returns {Promise<{clarity: number, relevance: number, gcc_focus: number, readability: number, overall: number, issues: string[]}>}
 */
export async function evaluateNewsletter(newsletter) {
  try {
    if (!newsletter || typeof newsletter !== "object") {
      console.log("[EVALUATOR] Invalid newsletter input — returning default scores");
      return { ...DEFAULT_SCORES };
    }

    // Build a compact representation for evaluation
    const sectionsText = (newsletter.sections || [])
      .map(
        (s, i) =>
          `[${i + 1}] Headline: ${s.headline || "N/A"}\n    Summary: ${(s.summary || "").slice(0, 100)}\n    Insight: ${(s.insight || "").slice(0, 100)}`
      )
      .join("\n\n");

    const evalPrompt = `You are a newsletter quality evaluator for GCC B2B content.

Evaluate the following GCC Morning Brief newsletter and return ONLY valid JSON.

SCORING CRITERIA:
- clarity (0-10): How clear and direct is the writing? No fluff.
- relevance (0-10): How relevant is the content to GCC/Saudi B2B decision-makers?
- gcc_focus (0-10): How focused is it on GCC market dynamics, data, and regional context?
- readability (0-10): Is it scannable, concise, and well-structured for executives?
- overall (0-10): Average weighted quality score.
- issues: Array of specific improvement suggestions (strings). Empty if none.

NEWSLETTER TITLE: ${newsletter.title || "GCC Morning Brief"}
DATE: ${newsletter.date || "unknown"}
SECTIONS (${newsletter.sections ? newsletter.sections.length : 0}):

${sectionsText}

Return ONLY valid JSON — no markdown, no code fences, no extra text:
{
  "clarity": 0-10,
  "relevance": 0-10,
  "gcc_focus": 0-10,
  "readability": 0-10,
  "overall": 0-10,
  "issues": []
}`;

    const result = await askDeepSeek(evalPrompt);

    if (result && typeof result === "object") {
      const scores = {
        clarity: clampScore(result.clarity),
        relevance: clampScore(result.relevance),
        gcc_focus: clampScore(result.gcc_focus),
        readability: clampScore(result.readability),
        overall: clampScore(result.overall),
        issues: Array.isArray(result.issues) ? result.issues : [],
      };

      console.log(
        `[EVALUATOR] Scores — clarity: ${scores.clarity}, relevance: ${scores.relevance}, gcc_focus: ${scores.gcc_focus}, readability: ${scores.readability}, overall: ${scores.overall}`
      );
      if (scores.issues.length > 0) {
        console.log(`[EVALUATOR] Issues (${scores.issues.length}): ${scores.issues.join("; ")}`);
      }

      return scores;
    }

    // Parsing returned null or unexpected shape — fallback to defaults
    console.log("[EVALUATOR] DeepSeek returned unexpected format — using default scores");
    return { ...DEFAULT_SCORES };
  } catch (err) {
    // Never crash the pipeline — log and return safe defaults
    console.log(`[EVALUATOR] Evaluation failed: ${err.message} — using default scores`);
    return { ...DEFAULT_SCORES };
  }
}

/**
 * Clamp a score to 0-10 range. Returns 7 if value is invalid.
 */
function clampScore(value) {
  if (typeof value !== "number" || isNaN(value)) return 7;
  return Math.max(0, Math.min(10, Math.round(value)));
}
