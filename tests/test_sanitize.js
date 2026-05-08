/**
 * Test suite for sanitizeUTF8 (output sanitization) vs safeText (input sanitization)
 *
 * Run: node tests/test_sanitize.js
 */

// ── Output sanitizer: preserves newlines/tabs, NFC normalizes ──
function sanitizeUTF8(text) {
  if (!text || typeof text !== "string") return text;
  let cleaned = text.replace(/\0/g, "");
  cleaned = cleaned.replace(/\uFFFD/g, "");
  if (cleaned.normalize) cleaned = cleaned.normalize("NFC");
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return cleaned;
}

// ── Input sanitizer: strips newlines/tabs too ──
function safeText(input) {
  if (!input || typeof input !== "string") return input;
  return input
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "");
}

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
  }
}

console.log("\n🧪 Testing safeText (input) sanitization...\n");

// Test 1: Broken surrogate pair (lone leading surrogate)
const t1 = "hello\uD800world";
assert(safeText(t1) === "helloworld", "Removes lone leading surrogate (U+D800)");

// Test 2: Lone trailing surrogate
const t2 = "hello\uDC00world";
assert(safeText(t2) === "helloworld", "Removes lone trailing surrogate (U+DC00)");

// Test 3: Full surrogate range
const t3 = "a\uD800b\uDFFFc";
assert(safeText(t3) === "abc", "Removes all surrogate pairs (U+D800-U+DFFF)");

// Test 4: Null character
const t4 = "hello\u0000world";
assert(safeText(t4) === "helloworld", "Removes null character (U+0000)");

// Test 5: Control characters
const t5 = "line1\u000Aline2";
assert(safeText(t5) === "line1line2", "Removes line feed (U+000A)");

// Test 6: Tab character
const t6 = "col1\u0009col2";
assert(safeText(t6) === "col1col2", "Removes tab (U+0009)");

// Test 7: DEL character
const t7 = "hello\u007Fworld";
assert(safeText(t7) === "helloworld", "Removes DEL character (U+007F)");

// Test 8: Normal string passes through unchanged
const t8 = "GCC Morning Brief - Saudi non-oil GDP 4.5%";
assert(safeText(t8) === t8, "Normal string passes through unchanged");

// Test 9: Non-string inputs pass through
assert(safeText(null) === null, "null passes through");
assert(safeText(undefined) === undefined, "undefined passes through");
assert(safeText(42) === 42, "number passes through");
const obj = { key: "value" };
assert(safeText(obj) === obj, "object passes through");
const arr = [1, 2, 3];
assert(safeText(arr) === arr, "array passes through");

// Test 10: Empty string
assert(safeText("") === "", "Empty string returns empty string");

// Test 11: Mixed content with valid Unicode
const t11 = "Arabic: العربية, English: hello\uD800\u2000world";
assert(!safeText(t11).includes("\uD800"), "Valid Arabic text preserved, surrogates removed");
assert(safeText(t11).includes("العربية"), "Arabic characters preserved");

console.log(`\n🧪 Testing sanitizeUTF8 (output) sanitization...\n`);

// Test 12: Null bytes
const st1 = "hello\u0000world";
assert(sanitizeUTF8(st1) === "helloworld", "Removes null bytes");

// Test 13: Replacement character (U+FFFD)
const st2 = "hello\uFFFDworld";
assert(sanitizeUTF8(st2) === "helloworld", "Removes replacement character (U+FFFD)");

// Test 14: Newlines are PRESERVED (unlike safeText which strips them)
const st3 = "line1\nline2\nline3";
assert(sanitizeUTF8(st3) === "line1\nline2\nline3", "Preserves newlines (\\n)");

// Test 15: Tabs are PRESERVED
const st4 = "col1\tcol2\tcol3";
assert(sanitizeUTF8(st4) === "col1\tcol2\tcol3", "Preserves tabs (\\t)");

// Test 16: Carriage returns are PRESERVED
const st5 = "line1\r\nline2";
assert(sanitizeUTF8(st5) === "line1\r\nline2", "Preserves carriage returns (\\r)");

// Test 17: Control characters (excluding \n, \t, \r) are stripped
const st6 = "hello\x01\x02\x07world";
assert(sanitizeUTF8(st6) === "helloworld", "Strips control chars (U+0001-U+0008, U+000E-U+001F)");

// Test 18: DEL character stripped
const st7 = "hello\u007Fworld";
assert(sanitizeUTF8(st7) === "helloworld", "Removes DEL character (U+007F)");

// Test 19: Non-string inputs pass through
assert(sanitizeUTF8(null) === null, "null passes through");
assert(sanitizeUTF8(undefined) === undefined, "undefined passes through");
assert(sanitizeUTF8(42) === 42, "number passes through");
assert(sanitizeUTF8(obj) === obj, "object passes through");
assert(sanitizeUTF8(arr) === arr, "array passes through");

// Test 20: Empty string
assert(sanitizeUTF8("") === "", "Empty string returns empty string");

// Test 21: Normal string passes through unchanged
const st8 = "GCC Morning Brief - Saudi non-oil GDP 4.5%";
assert(sanitizeUTF8(st8) === st8, "Normal string passes through unchanged");

// Test 22: Vertical tab (U+000B) and form feed (U+000C) stripped
const st9 = "hello\x0B\x0Cworld";
assert(sanitizeUTF8(st9) === "helloworld", "Strips vertical tab (U+000B) and form feed (U+000C)");

// Test 23: Unicode NFC normalization
const st10 = "e\u0301"; // e + combining acute accent
assert(sanitizeUTF8(st10) === "\u00e9", "NFC normalizes combined characters (é)");

// Test 24: Arabic text preserved
const st11 = "مرحبا بالعالم";
assert(sanitizeUTF8(st11) === "مرحبا بالعالم", "Arabic text preserved unchanged");

console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
