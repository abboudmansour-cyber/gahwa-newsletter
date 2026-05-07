/**
 * evaluator.js — v4 Rule-Based Newsletter Quality Evaluator
 *
 * Evaluates newsletter JSON output using deterministic heuristics.
 * NO AI calls. NO external dependencies. Never crashes the pipeline.
 *
 * Scoring dimensions (each 0-10):
 *   - clarity:      Filler words, repetition, structure cleanliness
 *   - gccRelevance: GCC country/city references, regional terms
 *   - marketDepth:  Numerical data points, currency references, percentages
 *   - readability:  Section balance, word density, structure completeness
 *   - overall:      Weighted composite
 *
 * Weakness detection via keyword + structure analysis.
 *
 * @module evaluator
 */

// ── Generic filler / AI-ism word list ─────────────────────────────────────
const GENERIC_WORDS = [
  "delve",
  "navigate",
  "landscape",
  "evolving",
  "robust",
  "cutting-edge",
  "game-changing",
  "revolutionary",
  "unprecedented",
  "fast-paced",
  "ever-changing",
  "ever evolving",
  "dynamic",
  "transformative",
  "paradigm",
  "synergy",
  "leverage",
  "ecosystem",
  "holistic",
  "bespoke",
  "world-class",
  "best-in-class",
  "state-of-the-art",
  "think outside the box",
  "at the end of the day",
  "in today's world",
  "in this digital age",
  "forward-thinking",
  "mission-critical",
];

// ── GCC-specific keywords ────────────────────────────────────────────────
const GCC_KEYWORDS = [
  "saudi",
  "uae",
  "qatar",
  "kuwait",
  "oman",
  "bahrain",
  "gcc",
  "gulf",
  "riyadh",
  "jeddah",
  "dubai",
  "doha",
  "abu dhabi",
  "sharjah",
  "khalifa",
  "tadawul",
  "dfm",
  "adx",
  "qse",
  "boursa",
  "pif",
  "sama",
  "saudi arabia",
  "united arab emirates",
  "kingdom of saudi",
  "makkah",
  "medina",
  "neom",
  "red sea",
  "qiddiya",
  "roshen",
  "diriyah",
  "giga-project",
  "gigaproject",
  "vision 2030",
  "king salman",
  "mbz",
  "mbs",
  "ghq",
  "sabic",
  "aramco",
  "stc",
  "almarai",
  "savola",
  "emaar",
  "aldar",
  "adnoc",
  "qatar energy",
  "qnb",
  "fawri",
  "mada",
  "tabby",
  "tamara",
  "stc pay",
  "sar",
  "aed",
  "qar",
  "omr",
  "bhd",
  "halala",
  "fils",
  "dirham",
  "riyal",
  "dinar",
];

// ── Currency / financial indicators ───────────────────────────────────────
const CURRENCY_PATTERNS = /[\$\€\£]|sar|aed|qar|omr|bhd|usd|billion|million|trillion/i;

// ── Economic / macro indicators ───────────────────────────────────────────
const MACRO_KEYWORDS = [
  "economy",
  "economic",
  "gdp",
  "growth",
  "inflation",
  "cpi",
  "interest rate",
  "monetary",
  "fiscal",
  "budget",
  "deficit",
  "surplus",
  "trade",
  "export",
  "import",
  "foreign direct",
  "fdi",
  "sovereign",
  "fund",
  "ipo",
  "offering",
  "listing",
  "bond",
  "sukuk",
  "treasury",
  "reserve",
];

/**
 * Evaluate a newsletter JSON object for quality metrics.
 * Pure rule-based evaluation — no AI calls.
 *
 * @param {object} newsletter - The newsletter JSON output to evaluate
 * @returns {{clarity: number, gccRelevance: number, marketDepth: number, readability: number, overall: number, weaknessTags: string[], suggestedPromptAdjustments: string}}
 */
export function evaluateNewsletter(newsletter) {
  if (!newsletter || typeof newsletter !== "object") {
    console.log("[EVALUATOR] Invalid newsletter input — returning default scores");
    return getDefaultScores();
  }

  try {
    const sections = newsletter.sections || [];
    const text = extractFlatText(newsletter).toLowerCase();
    const jsonStr = JSON.stringify(newsletter).toLowerCase();

    // ── 1. GCC Relevance (0-10) ─────────────────────────────────────
    const gccHits = countKeywordHits(jsonStr, GCC_KEYWORDS);
    const gccScore = gccHits >= 8 ? 10 : gccHits >= 6 ? 8 : gccHits >= 4 ? 6 : gccHits >= 2 ? 4 : gccHits >= 1 ? 2 : 0;

    // ── 2. Market Depth (0-10) ───────────────────────────────────────
    const numbers = text.match(/\d+/g) || [];
    const numericValues = numbers.map(Number).filter((n) => !isNaN(n));
    const uniqueNumbers = new Set(numericValues).size;
    const currencyHits = (text.match(CURRENCY_PATTERNS) || []).length;
    const percentHits = (text.match(/%/g) || []).length;

    let depthScore = 0;
    if (uniqueNumbers >= 8) depthScore += 4;
    else if (uniqueNumbers >= 5) depthScore += 3;
    else if (uniqueNumbers >= 3) depthScore += 2;
    else if (uniqueNumbers >= 1) depthScore += 1;

    if (currencyHits >= 4) depthScore += 3;
    else if (currencyHits >= 2) depthScore += 2;
    else if (currencyHits >= 1) depthScore += 1;

    if (percentHits >= 3) depthScore += 3;
    else if (percentHits >= 1) depthScore += 2;

    // ── 3. Clarity (0-10) — start at 9, deduct for issues ────────────
    let clarityScore = 9;

    // Generic/AI language penalty
    const genericHits = countKeywordHits(text, GENERIC_WORDS);
    clarityScore -= Math.min(5, genericHits * 2);

    // Repeated bigrams penalty
    const repeatedBigrams = countRepeatedBigrams(text);
    if (repeatedBigrams > 4) clarityScore -= 2;
    else if (repeatedBigrams > 2) clarityScore -= 1;

    // Section structure penalty (missing headlines, empty content)
    let emptySections = 0;
    for (const section of sections) {
      const sectionText = JSON.stringify(section).toLowerCase();
      if (sectionText.length < 20) emptySections++;
    }
    clarityScore -= Math.min(3, emptySections);

    // ── 4. Readability (0-10) — start at 7 ───────────────────────────
    let readabilityScore = 7;

    // Section count check
    if (sections.length >= 4 && sections.length <= 7) readabilityScore += 1;
    else if (sections.length < 3) readabilityScore -= 2;
    else if (sections.length > 10) readabilityScore -= 1;

    // Average word length per section
    const words = text.split(/\s+/).filter(Boolean);
    const totalWords = words.length;

    if (totalWords >= 600 && totalWords <= 1400) readabilityScore += 1;
    else if (totalWords < 300) readabilityScore -= 2;
    else if (totalWords > 2000) readabilityScore -= 1;

    // Structure variety — check for lists, bold, headers
    const hasBullets = jsonStr.includes("•") || jsonStr.includes("- ") || jsonStr.includes("items");
    const hasNumbers = /\d+/.test(text);
    if (hasBullets) readabilityScore += 1;
    if (hasNumbers) readabilityScore += 1;

    // Clamp all scores
    const finalClarity = clampScore(clarityScore);
    const finalGcc = clampScore(gccScore);
    const finalDepth = clampScore(depthScore);
    const finalReadability = clampScore(readabilityScore);

    // ── 5. Overall — weighted average ────────────────────────────────
    const overall = Math.round(
      (finalClarity * 0.2 + finalGcc * 0.3 + finalDepth * 0.3 + finalReadability * 0.2)
    );

    // ── 6. Weakness detection ────────────────────────────────────────
    const weaknessTags = [];
    if (finalGcc < 5) weaknessTags.push("weak GCC specificity");
    if (finalDepth < 4) weaknessTags.push("low market depth — missing data points");
    if (finalClarity < 6) weaknessTags.push("too generic AI content");
    if (genericHits > 1) weaknessTags.push("generic AI filler language detected");
    if (finalReadability < 5) weaknessTags.push("poor readability — structure issues");
    if (!hasMacroContent(text)) weaknessTags.push("low macro insight");
    if (weaknessTags.length === 0) weaknessTags.push("good quality — no major issues detected");

    // ── 7. Suggested prompt adjustments ───────────────────────────────
    const suggestedPromptAdjustments = generateSuggestions(weaknessTags, finalGcc, finalDepth, finalClarity, genericHits);

    const result = {
      clarity: finalClarity,
      gccRelevance: finalGcc,
      marketDepth: finalDepth,
      readability: finalReadability,
      overall: clampScore(overall),
      weaknessTags: weaknessTags.slice(0, 3), // Top 3 only
      suggestedPromptAdjustments,
    };

    console.log(
      `[EVALUATOR] Scores — clarity: ${finalClarity}, gccRelevance: ${finalGcc}, ` +
        `marketDepth: ${finalDepth}, readability: ${finalReadability}, overall: ${result.overall}`
    );
    if (result.weaknessTags.length > 0) {
      console.log(`[EVALUATOR] Weaknesses: ${result.weaknessTags.join("; ")}`);
    }

    return result;
  } catch (err) {
    console.log(`[EVALUATOR] Evaluation crashed: ${err.message} — returning safe defaults`);
    return getDefaultScores();
  }
}

/**
 * Extract all text from newsletter object recursively.
 */
function extractFlatText(obj) {
  if (typeof obj === "string") return obj;
  if (typeof obj === "number") return String(obj);
  if (Array.isArray(obj)) return obj.map(extractFlatText).join(" ");
  if (obj && typeof obj === "object") {
    return Object.values(obj).map(extractFlatText).join(" ");
  }
  return "";
}

/**
 * Count how many distinct keywords appear in the text.
 */
function countKeywordHits(text, keywords) {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits++;
  }
  return hits;
}

/**
 * Detect if text has macro / economic content.
 */
function hasMacroContent(text) {
  return MACRO_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Count repeated bigrams (2-word sequences) in text.
 */
function countRepeatedBigrams(text) {
  const words = text.split(/\s+/).filter((w) => w.length > 2);
  const bigramCounts = {};
  for (let i = 0; i < words.length - 1; i++) {
    const bg = words[i] + " " + words[i + 1];
    bigramCounts[bg] = (bigramCounts[bg] || 0) + 1;
  }
  return Object.values(bigramCounts).filter((c) => c > 2).length;
}

/**
 * Generate human-readable prompt adjustment suggestions based on detected weaknesses.
 */
function generateSuggestions(weaknesses, gccScore, depthScore, clarityScore, genericHits) {
  const suggestions = [];

  if (weaknesses.includes("weak GCC specificity")) {
    suggestions.push(
      "Mandate at least 3 specific GCC country references (Saudi, UAE, Qatar) with local currency amounts"
    );
  }
  if (weaknesses.includes("low market depth — missing data points")) {
    suggestions.push(
      "Require at least one specific number or percentage in every section"
    );
  }
  if (weaknesses.includes("too generic AI content") || genericHits > 1) {
    suggestions.push(
      "Remove generic AI filler phrases. Use direct, data-driven language with concrete examples"
    );
  }
  if (weaknesses.includes("poor readability — structure issues")) {
    suggestions.push(
      "Improve section structure: shorter paragraphs, more bullet points, clearer headings"
    );
  }
  if (weaknesses.includes("low macro insight")) {
    suggestions.push(
      "Include macro-economic context (GDP trends, inflation, trade data) for each story"
    );
  }

  // General quality boosters
  if (gccScore < 6) {
    suggestions.push(
      "Add more GCC-specific market context (city-level deals, local company names, SAR/AED figures)"
    );
  }
  if (depthScore < 5) {
    suggestions.push(
      "Increase data density with specific numerical references and comparative metrics"
    );
  }
  if (clarityScore < 7) {
    suggestions.push(
      "Shorten sentences, remove redundancies, use active voice throughout"
    );
  }

  return suggestions.length > 0 ? suggestions.join(". ") + "." : "No adjustments needed.";
}

/**
 * Clamp a score to 0-10 range. Returns 7 if invalid.
 */
function clampScore(value) {
  if (typeof value !== "number" || isNaN(value)) return 7;
  return Math.max(0, Math.min(10, Math.round(value)));
}

/**
 * Safe default scores for fallback use.
 */
function getDefaultScores() {
  return {
    clarity: 7,
    gccRelevance: 7,
    marketDepth: 7,
    readability: 7,
    overall: 7,
    weaknessTags: ["evaluation skipped"],
    suggestedPromptAdjustments: "",
  };
}
