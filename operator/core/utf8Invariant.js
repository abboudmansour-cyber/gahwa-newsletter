/**
 * utf8Invariant.js — System-wide UTF-8 data integrity layer.
 *
 * Enforces a hard invariant: no invalid Unicode survives into JSON serialization.
 *
 * Catches:
 *   - U+FFFD replacement characters (bad decodes that entered as � escape
 *     sequences, bypassing raw-text sanitization and instantiated by JSON.parse)
 *   - Lone high surrogates (U+D800–U+DBFF not followed by a low surrogate)
 *   - Lone low surrogates (U+DC00–U+DFFF not preceded by a high surrogate)
 *
 * Preserves:
 *   - Valid surrogate pairs (emoji and other non-BMP characters)
 *   - All other valid Unicode
 *
 * Usage:
 *   import { enforceUtf8Invariant } from "./core/utf8Invariant.js";
 *   newsletter = enforceUtf8Invariant(newsletter);
 *   const payload = JSON.stringify(newsletter, null, 2);
 */

/**
 * Strip invalid Unicode from a single string.
 *
 * @param {string} str
 * @returns {string}
 */
export function cleanString(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/\uFFFD/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/**
 * Recursively enforce the UTF-8 invariant across an entire object tree.
 * Walks strings, arrays, and plain objects. Leaves all other values untouched.
 *
 * @param {*} input
 * @returns {*}
 */
export function enforceUtf8Invariant(input) {
  if (typeof input === "string") return cleanString(input);
  if (Array.isArray(input)) return input.map(enforceUtf8Invariant);
  if (input !== null && typeof input === "object") {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = enforceUtf8Invariant(v);
    }
    return out;
  }
  return input;
}
