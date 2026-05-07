/**
 * llmGateway.js — Fault-Tolerant LLM Execution Gateway
 *
 * Centralized, bulletproof gateway for all DeepSeek LLM requests.
 * Provides:
 *   - Input sanitization (broken Unicode, control characters)
 *   - Global payload safety via JSON reviver
 *   - Retry logic on transient failures (429, 400, network timeout)
 *   - Error logging to /logs/llm-errors.json
 *
 * @module llmGateway
 */

import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load environment variables from operator/.env ─────────────
dotenv.config({
  path: path.resolve(__dirname, "../.env")
});

const LOGS_DIR = path.join(__dirname, "..", "logs");
const LLM_ERRORS_FILE = path.join(LOGS_DIR, "llm-errors.json");
const MAX_ERROR_ENTRIES = 100;

const API_KEY = process.env.DEEPSEEK_API_KEY;
const API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEFAULT_MODEL = "deepseek-reasoner";

/**
 * Sanitize a string to remove invalid Unicode characters that can cause
 * "lone leading surrogate" errors in DeepSeek API.
 *
 * - Removes broken surrogate pairs (U+D800–U+DFFF)
 * - Removes control characters (U+0000–U+001F, U+007F)
 *
 * @param {*} input - Value to sanitize (non-strings pass through)
 * @returns {*} Sanitized string or original value if not a string
 */
function safeText(input) {
  if (!input || typeof input !== "string") return input;

  return input
    .replace(/[\uD800-\uDFFF]/g, "")        // remove broken surrogate pairs
    .replace(/[\u0000-\u001F\u007F]/g, "");  // remove control characters
}

/**
 * Promise-based sleep helper.
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log an LLM error to /logs/llm-errors.json.
 * Keeps only the last 100 entries.
 *
 * @param {Error|string} error - The error object or message
 * @param {number} attempt - The attempt number (1-3)
 * @param {Array} [messages] - The messages array that was sent (for payload size)
 */
function logLLMError(error, attempt, messages) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });

    let entries = [];
    try {
      if (fs.existsSync(LLM_ERRORS_FILE)) {
        entries = JSON.parse(fs.readFileSync(LLM_ERRORS_FILE, "utf-8"));
        if (!Array.isArray(entries)) entries = [];
      }
    } catch {
      entries = [];
    }

    entries.push({
      timestamp: new Date().toISOString(),
      error: error?.message || String(error),
      attempt,
      payloadSize: messages ? JSON.stringify(messages).length : 0,
      messageIndex: Array.isArray(messages) ? messages.length - 1 : null,
    });

    const trimmed =
      entries.length > MAX_ERROR_ENTRIES
        ? entries.slice(-MAX_ERROR_ENTRIES)
        : entries;

    fs.writeFileSync(LLM_ERRORS_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (logErr) {
    console.error(`[LLM GATEWAY] Failed to write error log: ${logErr.message}`);
  }
}

/**
 * Determine if an error is a network-level error (timeout, connection refused, etc.).
 *
 * @param {Error} err - The error to check
 * @returns {boolean} True if this is a network-level error
 */
function isNetworkError(err) {
  return (
    err.name === "AbortError" ||
    err.code === "ETIMEDOUT" ||
    err.code === "ECONNREFUSED" ||
    err.code === "ENOTFOUND" ||
    err.code === "ECONNRESET" ||
    err.code === "EPIPE" ||
    err.type === "system" ||
    err.message?.includes("network") ||
    err.message?.includes("timeout") ||
    err.message?.includes("fetch failed")
  );
}

/**
 * Centralized, fault-tolerant gateway for all DeepSeek LLM requests.
 *
 * - Sanitizes all inputs (removes broken Unicode, control characters)
 * - Handles retries on transient failures (429, 400, network timeout)
 * - Logs all failures to /logs/llm-errors.json
 *
 * RETRY POLICY:
 *   - HTTP 400 (malformed): retry exactly once (post-sanitization)
 *   - HTTP 429 (rate limited): retry up to 2 times
 *   - Network/timeout errors: retry up to 2 times
 *   - HTTP 401/403 (auth): NEVER retry
 *   - Other HTTP errors: NEVER retry
 *
 * RETRY DELAYS:
 *   - Retry 1: 1 second
 *   - Retry 2: 3 seconds
 *
 * @param {Array} messages - Array of message objects with role/content
 * @param {Object} [options={}] - Optional parameters
 * @param {string} [options.model] - Model override (default: "deepseek-reasoner")
 * @param {number} [options.max_tokens] - Max tokens in response
 * @param {number} [options.temperature] - Temperature parameter
 * @returns {Promise<Object>} Parsed DeepSeek API response body
 * @throws {Error} On permanent failures or exhausted retries
 */
export async function callDeepSeek(messages, options = {}) {
  // ── Input validation ────────────────────────────────────────────
  if (!API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not set in environment");
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array");
  }

  // ── Global payload safety via JSON reviver ───────────────────────
  // Deep-sanitize ALL string values in the payload, including nested ones
  // This catches any edge cases where string values exist outside messages
  const payload = JSON.parse(
    JSON.stringify(
      {
        model: options.model || DEFAULT_MODEL,
        messages,
        ...(options.max_tokens !== undefined
          ? { max_tokens: options.max_tokens }
          : {}),
        ...(options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
      },
      (key, value) => (typeof value === "string" ? safeText(value) : value)
    )
  );

  const maxRetries = 2; // 2 retries = 3 total attempts
  let lastError = null;

  // ── Retry loop: attempt 1 (initial) + 2 retries = 3 total ───────
  for (let attempt = 1; attempt <= 1 + maxRetries; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      // ── Success ────────────────────────────────────────────────
      if (res.ok) {
        return await res.json();
      }

      // ── HTTP error handling ─────────────────────────────────────
      const errorBody = await res.text().catch(() => "");
      const error = new Error(
        `DeepSeek API returned ${res.status}: ${res.statusText}`
      );

      // Log every API failure
      logLLMError(error, attempt, messages);
      console.error(
        `[LLM GATEWAY] ❌ HTTP ${res.status} (attempt ${attempt}/3): ${res.statusText}`
      );
      if (errorBody) {
        console.error(`   Response: ${errorBody.slice(0, 500)}`);
      }

      // ── Auth errors — NEVER retry ─────────────────────────
      if (res.status === 401 || res.status === 403) {
        throw error;
      }

      // ── 400 malformed — retry only once (post-sanitization) ─
      if (res.status === 400) {
        if (attempt > 1) {
          // Already retried — give up
          throw error;
        }
        // Retry once
        console.log(
          `[LLM GATEWAY] 🔄 Retry ${attempt}/${maxRetries} in 1s (HTTP 400 — malformed)`
        );
        await sleep(1000);
        lastError = error;
        continue;
      }

      // ── Other retryable statuses: 429, 502, 503 ─────────────
      const isRetryable = [429, 502, 503].includes(res.status);

      if (!isRetryable || attempt > maxRetries) {
        throw error;
      }

      // Backoff: 1s for first retry, 3s for second
      const delay = attempt === 1 ? 1000 : 3000;
      console.log(
        `[LLM GATEWAY] 🔄 Retry ${attempt}/${maxRetries} in ${delay}ms (HTTP ${res.status})`
      );
      await sleep(delay);
      lastError = error;
      continue;
    } catch (err) {
      // ── Network-level errors (timeout, connection refused, DNS failure) ──
      if (isNetworkError(err)) {
        logLLMError(err, attempt, messages);
        console.error(
          `[LLM GATEWAY] 🌐 Network error (attempt ${attempt}/3): ${err.message}`
        );

        if (attempt > maxRetries) {
          throw err;
        }

        const delay = attempt === 1 ? 1000 : 3000;
        console.log(
          `[LLM GATEWAY] 🔄 Retry ${attempt}/${maxRetries} in ${delay}ms (network error)`
        );
        await sleep(delay);
        lastError = err;
        continue;
      }

      // If it's already an HTTP error we logged above, don't re-log
      if (!err.message?.startsWith("DeepSeek API returned")) {
        logLLMError(err, attempt, messages);
      }

      // Re-throw all other errors (JSON parse errors, assertion errors, etc.)
      throw err;
    }
  }

  // Shouldn't reach here, but defensive fallback
  throw lastError || new Error("All retry attempts exhausted");
}
