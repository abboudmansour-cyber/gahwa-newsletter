/**
 * security.js — Webhook Request Verification
 *
 * Validates GitHub webhook HMAC-SHA256 signatures.
 * Falls back to allowing requests if no secret is configured (with warning).
 *
 * @module security
 */

import crypto from "crypto";

let webhookSecret = "";

/**
 * Configure the webhook secret. Must be called before verifyRequest.
 *
 * @param {string} secret - The GITHUB_WEBHOOK_SECRET value
 */
export function configure(secret) {
  webhookSecret = secret || "";
}

/**
 * Verify a GitHub webhook request signature.
 *
 * @param {string} signature - The x-hub-signature-256 header value
 * @param {string} body - Raw request body as a string
 * @returns {{ valid: boolean, message?: string }}
 */
export function verifyRequest(signature, body) {
  // No secret configured — allow but warn
  if (!webhookSecret) {
    console.log("⚠️ GITHUB_WEBHOOK_SECRET not configured — skipping signature validation.");
    console.log("   Set GITHUB_WEBHOOK_SECRET in operator/.env for production security.");
    return { valid: true };
  }

  if (!signature) {
    console.log("❌ Invalid webhook signature");
    console.log("   Missing x-hub-signature-256 header.");
    return { valid: false, message: "Missing x-hub-signature-256 header" };
  }

  // Extract the hash part (GitHub sends "sha256=abc123...")
  const providedSig = signature.replace(/^sha256=/, "");

  // Compute expected signature
  const hmac = crypto.createHmac("sha256", webhookSecret);
  hmac.update(body, "utf-8");
  const expectedSig = hmac.digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedSig, "hex"),
      Buffer.from(expectedSig, "hex")
    );

    if (!isValid) {
      console.log("❌ Invalid webhook signature");
      console.log("   Signature mismatch — possible unauthorized request.");
      return { valid: false, message: "Signature mismatch" };
    }

    return { valid: true };
  } catch (err) {
    console.log("❌ Invalid webhook signature");
    console.log(`   Signature verification error: ${err.message}`);
    return { valid: false, message: err.message };
  }
}
