import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

const API_KEY = process.env.DEEPSEEK_API_KEY;
const API_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";
const MAX_RETRIES = 1;
const MAX_SAFE_RESPONSE_LENGTH = 5000;

/**
 * Build the system prompt with strict JSON-only enforcement.
 * No embedded content — only lightweight action plans.
 */
function buildSystemPrompt(currentDate) {
  return `You are DeepSeek Reasoner acting as an execution planner for an automated newsletter system.

Your job is NOT conversation.
Your job is ONLY to produce lightweight execution plans.

SYSTEM CLOCK: Today is ${currentDate}.

Return ONLY valid minified JSON.
No markdown.
No explanations.
No prose.
No code fences.

OUTPUT FORMAT:
{
  "goal": "short description of what this plan achieves",
  "steps": [
    {
      "action": "generate_newsletter",
      "instruction": "Generate and save today's GCC Morning Brief newsletter"
    },
    {
      "action": "git",
      "instruction": "descriptive commit message"
    },
    {
      "action": "push",
      "path": "output/latest-newsletter.json"
    }
  ]
}

VALID ACTIONS:
- generate_newsletter: Generate newsletter content and save to output/latest-newsletter.json
- git: Commit and push all changes to GitHub. instruction is the commit message.
- push: Deliver newsletter JSON to Apps Script webhook. Optional "path" field defaults to output/latest-newsletter.json.

CONSTRAINTS:
- Keep steps minimal and executable.
- Do NOT embed file content or newsletter JSON in any step.
- Do NOT use "docs" or "fs" actions.
- Do NOT add commentary or explanation.
- Return ONLY the JSON object. No other text.`;
}

const FIX_PROMPT_SUFFIX =
  "\n\n---\nFix output. Return ONLY valid JSON.";

function buildUserPrompt(task) {
  return `TASK:
${task}

Generate a lightweight plan following the strict OUTPUT FORMAT described in the system prompt.`;
}

/**
 * Extract the first valid JSON object from a response string.
 * Strips:
 *   - markdown code fences (```json ... ```)
 *   - leading prose before the first { or [
 *   - trailing commentary after the last } or ]
 *
 * @param {string} text - Raw response text
 * @returns {string} Cleaned JSON string
 */
function extractJSON(text) {
  if (!text || typeof text !== "string") return "";

  let cleaned = text.trim();

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
  cleaned = cleaned.replace(/\s*```\s*$/i, "");

  // Find the first opening brace or bracket
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  const first =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
        ? firstBrace
        : Math.min(firstBrace, firstBracket);

  if (first === -1) return cleaned;

  // Find the last closing brace or bracket
  const lastBrace = cleaned.lastIndexOf("}");
  const lastBracket = cleaned.lastIndexOf("]");
  const last =
    lastBrace === -1
      ? lastBracket
      : lastBracket === -1
        ? lastBrace
        : Math.max(lastBrace, lastBracket);

  if (last === -1 || last < first) return cleaned;

  return cleaned.slice(first, last + 1);
}

/**
 * Check if response exceeds safe length and log a warning.
 *
 * @param {string} text - Response text to check
 */
function checkResponseSize(text) {
  if (!text || typeof text !== "string") return;

  if (text.length > MAX_SAFE_RESPONSE_LENGTH) {
    console.warn(
      `⚠ Large DeepSeek response detected (${text.length} chars — max safe: ${MAX_SAFE_RESPONSE_LENGTH})`
    );
  }
}

async function callDeepSeek(task, currentDate, fixMode = false) {
  const systemPrompt = buildSystemPrompt(currentDate);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: fixMode ? buildUserPrompt(task) + FIX_PROMPT_SUFFIX : buildUserPrompt(task) },
  ];

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error("❌ DeepSeek API HTTP Error:", res.status, res.statusText);
    console.error("Full response:", errorBody);
    throw new Error(`DeepSeek API returned ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    console.error("❌ Invalid DeepSeek response — no content in choices");
    console.error("Full response:", JSON.stringify(data, null, 2));
    throw new Error("DeepSeek returned empty or invalid response");
  }

  return text;
}

/**
 * Parse DeepSeek response into a plan object.
 * Applies response extraction safety before JSON.parse.
 * Retries ONCE with a "Fix output" instruction if parsing fails.
 *
 * @param {string} currentDate - The current date string (YYYY-MM-DD) from the system clock
 * @param {string} task - The task prompt to send
 */
export async function askDeepSeek(currentDate, task) {
  if (!API_KEY) {
    throw new Error("❌ DEEPSEEK_API_KEY is not set in .env");
  }

  // ── Attempt 1: normal call ─────────────────────────────────
  console.log("  ⟳ Generating plan...");
  const text1 = await callDeepSeek(task, currentDate, false);
  const plan1 = tryParse(text1);

  if (plan1) {
    return plan1;
  }

  // ── Attempt 2: retry with fix instruction ──────────────────
  console.log("  ⟳ Response was invalid JSON. Retrying with fix instruction...");
  const text2 = await callDeepSeek(task, currentDate, true);
  const plan2 = tryParse(text2);

  if (plan2) {
    return plan2;
  }

  throw new Error("DeepSeek failed to return valid JSON after retry");
}

/**
 * Attempt to parse a string as a JSON plan.
 * Applies response extraction safety before parsing.
 * Returns the parsed object, or null if parsing fails or structure is invalid.
 */
function tryParse(text) {
  // ── Max output safety check ──────────────────────────────────
  checkResponseSize(text);

  // ── Extract clean JSON from response ───────────────────────
  const cleaned = extractJSON(text);

  if (!cleaned) {
    console.error("  ❌ Empty response after extraction");
    console.error("  Raw text:", (text || "").slice(0, 200));
    return null;
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Validate structure: must have steps array
    if (!parsed || typeof parsed !== "object") {
      console.error("  ❌ Parsed response is not an object");
      return null;
    }
    if (!Array.isArray(parsed.steps)) {
      console.error("  ❌ Parsed response missing 'steps' array");
      return null;
    }

    return parsed;
  } catch (err) {
    console.error("  ❌ Failed to parse JSON:", err.message);
    console.error("  Cleaned text:", cleaned.slice(0, 200));
    return null;
  }
}

/**
 * Direct content generation call (bypasses plan parsing).
 * Used for generating newsletter content after the plan is resolved.
 *
 * @param {string} prompt - Content generation prompt
 * @param {string} currentDate - Current date for system prompt
 * @returns {string} Raw response text
 */
export async function callDeepSeekForContent(prompt, currentDate) {
  if (!API_KEY) {
    throw new Error("❌ DEEPSEEK_API_KEY is not set in .env");
  }

  const systemPrompt = `You are a GCC business newsletter writer.

SYSTEM CLOCK: Today is ${currentDate}.

Return ONLY valid minified JSON.
No markdown.
No explanations.
No prose.
No code fences.

Output the newsletter as a JSON object matching the schema described in the user prompt.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error("❌ DeepSeek API HTTP Error:", res.status, res.statusText);
    console.error("Full response:", errorBody);
    throw new Error(`DeepSeek API returned ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    console.error("❌ Invalid DeepSeek response — no content in choices");
    console.error("Full response:", JSON.stringify(data, null, 2));
    throw new Error("DeepSeek returned empty or invalid response");
  }

  return text;
}
