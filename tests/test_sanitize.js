/**
 * Test suite for safeText sanitization (operator/deepseek.js)
 * 
 * Run: node tests/test_sanitize.js
 */

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

console.log("\n🧪 Testing safeText sanitization...\n");

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

console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
