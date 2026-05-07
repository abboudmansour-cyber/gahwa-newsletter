/**
 * validate-env.js — Centralized Environment Validation
 *
 * SINGLE source of truth for environment variable validation.
 * Provides URL format checking and safe debug output.
 *
 * Every entry point (operator.js, server.js, scheduler.js, daily-runner.js)
 * MUST call validateEnvironment() or validateWebhookUrl() during startup.
 *
 * @module validate-env
 */

// ── WEBHOOK URL FORMAT VALIDATION ──────────────────────────────────────

/**
 * Validate the APPS_SCRIPT_WEBHOOK_URL format.
 *
 * Checks:
 *  - variable exists and is non-empty
 *  - starts with https://script.google.com/macros/s/
 *  - ends with /exec
 *
 * @param {string} url - The URL to validate
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateWebhookUrl(url) {
  if (!url || typeof url !== "string" || url.trim() === "") {
    return {
      valid: false,
      message:
        "APPS_SCRIPT_WEBHOOK_URL is not set.\n" +
        "  → Deploy your Apps Script Web App and add the exec URL to operator/.env\n" +
        "  → See operator/.env.template for the configuration reference.",
    };
  }

  const trimmed = url.trim();

  if (!trimmed.startsWith("https://script.google.com/macros/s/")) {
    return {
      valid: false,
      message:
        `❌ Invalid APPS_SCRIPT_WEBHOOK_URL format.\n` +
        `   Expected: https://script.google.com/macros/s/ABC123/exec\n` +
        `   Got:      ${maskUrl(trimmed)}\n` +
        `   → Deploy your Apps Script Web App and paste the exec URL into operator/.env`,
    };
  }

  if (!trimmed.endsWith("/exec")) {
    return {
      valid: false,
      message:
        `❌ Invalid APPS_SCRIPT_WEBHOOK_URL format — must end with /exec.\n` +
        `   Expected: https://script.google.com/macros/s/ABC123/exec\n` +
        `   Got:      ${maskUrl(trimmed)}\n` +
        `   → Make sure you're using the Web App deployment URL (ends with /exec)`,
    };
  }

  return { valid: true };
}

// ── SAFE DEBUG OUTPUT ──────────────────────────────────────────────────

/**
 * Log a safe, non-revealing status for the webhook URL.
 *
 * Logs ONLY: 🔗 Apps Script webhook configured: true/false
 * Does NOT print the URL or any part of it.
 */
export function logWebhookStatus() {
  const url = process.env.APPS_SCRIPT_WEBHOOK_URL;
  const configured = Boolean(url && url.trim() !== "");
  console.log(`🔗 Apps Script webhook configured: ${configured}`);
}

// ── ENVIRONMENT VALIDATION ─────────────────────────────────────────────

/**
 * Validate all required environment variables.
 *
 * Required variables:
 *  - DEEPSEEK_API_KEY
 *  - APPS_SCRIPT_WEBHOOK_URL
 *
 * If any are missing, prints a clear error message and exits.
 * If APPS_SCRIPT_WEBHOOK_URL is present, also validates its format.
 *
 * @param {object} [options]
 * @param {boolean} [options.exitOnFailure=true] - Whether to call process.exit(1) on failure
 * @returns {boolean} true if valid, false if invalid (only returns when exitOnFailure=false)
 */
export function validateEnvironment({ exitOnFailure = true } = {}) {
  const required = ["DEEPSEEK_API_KEY", "APPS_SCRIPT_WEBHOOK_URL"];
  const missing = required.filter((key) => !process.env[key] || process.env[key].trim() === "");

  if (missing.length > 0) {
    console.error("═══════════════════════════════════════════════════════");
    console.error("❌  ENVIRONMENT VALIDATION FAILED");
    console.error(`   Missing variables: ${missing.join(", ")}`);
    console.error("");
    console.error("   To fix:");
    console.error("     1. Copy the template:  cp operator/.env.template operator/.env");
    console.error("     2. Edit operator/.env and fill in the values.");
    console.error("     3. Or pass them as environment variables (e.g., via GitHub Secrets).");
    console.error("");

    if (missing.includes("APPS_SCRIPT_WEBHOOK_URL")) {
      console.error("   Add APPS_SCRIPT_WEBHOOK_URL to operator/.env");
    }

    console.error("═══════════════════════════════════════════════════════");

    if (exitOnFailure) {
      process.exit(1);
    }
    return false;
  }

  // ── Webhook URL format validation ─────────────────────────────────
  const webhookResult = validateWebhookUrl(process.env.APPS_SCRIPT_WEBHOOK_URL);
  if (!webhookResult.valid) {
    console.error("═══════════════════════════════════════════════════════");
    console.error(webhookResult.message);
    console.error("═══════════════════════════════════════════════════════");
    if (exitOnFailure) {
      process.exit(1);
    }
    return false;
  }

  console.log(`✅ Environment validated — all required variables present`);
  return true;
}

// ── URL MASKING HELPER ─────────────────────────────────────────────────

/**
 * Safely mask a URL for display in error messages.
 * Shows only the protocol + domain, masking the path.
 *
 * @param {string} url
 * @returns {string}
 */
function maskUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/macros/s/.../exec`;
  } catch {
    // If URL parsing fails, show a generic masked representation
    return "<url> (malformed or unparseable)";
  }
}
