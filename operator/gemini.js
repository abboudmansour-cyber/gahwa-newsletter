import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;
const API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

/**
 * Sanitize UTF-8 string: normalize Unicode, strip null bytes and control chars.
 * Applied as the FIRST operation on every raw LLM output before any downstream processing.
 *
 * @param {string} text - Raw text to sanitize
 * @returns {string} Clean, normalized string
 */
function sanitizeUTF8(text) {
  if (!text || typeof text !== "string") return text;
  let cleaned = text.replace(/\0/g, "");
  cleaned = cleaned.replace(/\uFFFD/g, "");
  if (cleaned.normalize) cleaned = cleaned.normalize("NFC");
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return cleaned;
}

export async function askGemini(task) {
  if (!API_KEY) {
    throw new Error("❌ GEMINI_API_KEY is not set in .env");
  }

  const prompt = `
You are the planner for Gahwa Newsletter system.

Return ONLY valid JSON.

Break task into simple steps.

Rules:
- assume VS Code + Cline + GitHub workflow
- keep steps minimal
- no explanation

TASK:
${task}

OUTPUT:
{
  "steps": [
    {
      "action": "cline",
      "instruction": ""
    },
    {
      "action": "git",
      "instruction": ""
    }
  ]
}
`;

  const res = await fetch(`${API_URL}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error("❌ Gemini API HTTP Error:", res.status, res.statusText);
    console.error("Full response:", errorBody);
    throw new Error(`Gemini API returned ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    console.error("❌ Invalid Gemini response — no text in candidates");
    console.error("Full response:", JSON.stringify(data, null, 2));
    throw new Error("Gemini returned empty or invalid response");
  }

  const text = sanitizeUTF8(rawText);

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("❌ Failed to parse Gemini response as JSON");
    console.error("Raw text:", text);
    console.error("Full response:", JSON.stringify(data, null, 2));
    throw new Error("Gemini response was not valid JSON");
  }
}
