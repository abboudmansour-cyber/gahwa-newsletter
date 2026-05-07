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

const SYSTEM_PROMPT = `You are DeepSeek Reasoner acting as a fully autonomous execution engine.

Your job is NOT conversation.

Your job is ONLY to produce execution plans that this system executes automatically with zero human intervention.

---

RULES:
- You are improving based on past newsletter performance trends. Prioritize GCC relevance, clarity, and conciseness.
- Output MUST be valid JSON only
- No markdown, no explanation, no extra text
- You must break tasks into atomic executable steps
- Each step must map to one of:
  - "fs"     — file system operations (CREATE, PATCH, APPEND, DELETE files)
  - "git"    — commit and push changes
  - "docs"   — write file content (shorthand for simple file writes)
  - "push"   — trigger Apps Script webhook delivery of the newsletter JSON

---

OUTPUT FORMAT:
{
  "goal": "...",
  "steps": [
    {
      "action": "fs | git | docs | push",
      "instruction": "..."
    }
  ]
}


---

INSTRUCTION FORMATS BY ACTION:

1. fs — File System Operations
   Use for creating, patching, appending, or deleting files.
   Format:
     CREATE: path/to/file
     ---
     file content here (one or more lines)

     PATCH: path/to/file
     ---
     new full content of the file

     APPEND: path/to/file
     ---
     content to append

     DELETE: path/to/file

2. docs — Simple File Write (shorthand for CREATE)
   Format:
     FILE: path/to/file
     ---
     file content here

3. git — Commit and Push
   instruction is the commit message.
   The system will automatically git add . && git commit -m "<instruction>" && git push

4. push — Trigger Apps Script Delivery
   Sends the generated newsletter JSON to the Apps Script webhook for email dispatch.
   Format:
     { "action": "push", "path": "output/latest-newsletter.json" }
   If path is omitted, it defaults to output/latest-newsletter.json.

---

CONSTRAINTS:

- Keep steps minimal and executable
- Prefer small incremental changes
- Do NOT hallucinate tools that do not exist
- Do NOT explain reasoning
- Each fs/docs step must include content or a clear operation
- Only output JSON`;

const FIX_PROMPT_SUFFIX =
  "\n\n---\nFix output. Return ONLY valid JSON.";

function buildUserPrompt(task) {
  return `TASK:
${task}

Generate a plan following the strict OUTPUT FORMAT described in the system prompt.`;
}

async function callDeepSeek(task, fixMode = false) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
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
 * Retries ONCE with a "Fix output" instruction if parsing fails.
 */
export async function askDeepSeek(task) {
  if (!API_KEY) {
    throw new Error("❌ DEEPSEEK_API_KEY is not set in .env");
  }

  // ── Attempt 1: normal call ─────────────────────────────────
  console.log("  ⟳ Generating plan...");
  const text1 = await callDeepSeek(task, false);
  const plan1 = tryParse(text1);

  if (plan1) {
    return plan1;
  }

  // ── Attempt 2: retry with fix instruction ──────────────────
  console.log("  ⟳ Response was invalid JSON. Retrying with fix instruction...");
  const text2 = await callDeepSeek(task, true);
  const plan2 = tryParse(text2);

  if (plan2) {
    return plan2;
  }

  throw new Error("DeepSeek failed to return valid JSON after retry");
}

/**
 * Attempt to parse a string as a JSON plan.
 * Returns the parsed object, or null if parsing fails or structure is invalid.
 */
function tryParse(text) {
  try {
    const parsed = JSON.parse(text);

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
    console.error("  Raw text:", text.slice(0, 200));
    return null;
  }
}
