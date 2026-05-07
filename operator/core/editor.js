#!/usr/bin/env node

/**
 * editor.js — Editorial Intelligence Engine
 *
 * Transforms raw GCC information into a deterministic editorial frame:
 *   - priority ranking of topics by editorial importance
 *   - narrative structure for story ordering
 *   - breaking signal detection
 *
 * This is NOT an AI model.
 * This is a deterministic editorial ranking + structuring system.
 *
 * Used by operator.js before DeepSeek calls to ensure:
 *   - macro stories always appear first
 *   - narrative flow is consistent across runs
 *   - DeepSeek receives structured editorial guidance
 *
 * @module editor
 */

// ──────────────────────────────────────────────────────────────
// TOPIC PROFILES — Deterministic Scoring Rules
// ──────────────────────────────────────────────────────────────
// Each profile defines:
//   - baseScore: editorial importance (1–10)
//   - category:   macro | policy | tech | startups | sector | minor
//   - narrativeSlot: where this topic fits in the story flow
//   - reason:    editorial justification for the score
//
// HIGH PRIORITY (8–10): oil, Saudi policy, SWF, macro, banking
// MEDIUM PRIORITY (5–7): AI/tech, startups, corporate earnings
// LOW PRIORITY (1–4): tourism data, partnerships, generic tech
// ──────────────────────────────────────────────────────────────

const TOPIC_PROFILES = [
  {
    id: "oil_macro",
    topic: "Oil price movements & energy markets",
    baseScore: 9.5,
    category: "macro",
    narrativeSlot: "Macro anchors (oil, rates, markets)",
    reason: "Core GCC economic driver — market-moving, high macro impact",
  },
  {
    id: "saudi_policy",
    topic: "Saudi Arabia policy & Vision 2030 announcements",
    baseScore: 9.0,
    category: "policy",
    narrativeSlot: "Sovereign / policy moves",
    reason: "Sovereign-level directional signal for the entire GCC",
  },
  {
    id: "swf_moves",
    topic: "Sovereign wealth fund moves (PIF, Mubadala, QIA, ADIA)",
    baseScore: 8.5,
    category: "policy",
    narrativeSlot: "Sovereign / policy moves",
    reason: "Capital deployment signals reveal GCC strategic direction",
  },
  {
    id: "macro_shifts",
    topic: "Macroeconomic indicators (GDP, inflation, interest rates)",
    baseScore: 8.0,
    category: "macro",
    narrativeSlot: "Macro anchors (oil, rates, markets)",
    reason: "Sets macro context for all decision-making",
  },
  {
    id: "banking_regulation",
    topic: "Banking & financial regulation changes",
    baseScore: 7.5,
    category: "macro",
    narrativeSlot: "Macro anchors (oil, rates, markets)",
    reason: "Capital markets impact, regulatory shift signal",
  },
  {
    id: "geopolitics",
    topic: "Regional geopolitics & trade relations",
    baseScore: 7.5,
    category: "geopolitics",
    narrativeSlot: "Regional geopolitics",
    reason: "Shapes investment climate and risk perception",
  },
  {
    id: "ai_tech",
    topic: "AI & technology developments in GCC",
    baseScore: 7.0,
    category: "tech",
    narrativeSlot: "AI & tech developments",
    reason: "Defining transformation story in the region — big investment flows",
  },
  {
    id: "startup_funding",
    topic: "Startup funding rounds & VC activity",
    baseScore: 6.5,
    category: "startups",
    narrativeSlot: "Startup & VC activity",
    reason: "GCC startup ecosystem maturity and innovation indicator",
  },
  {
    id: "corporate_earnings",
    topic: "Corporate earnings (Aramco, SABIC, QNB, ADNOC, stc)",
    baseScore: 6.0,
    category: "markets",
    narrativeSlot: "Macro anchors (oil, rates, markets)",
    reason: "Company-level performance reveals sector health",
  },
  {
    id: "fintech",
    topic: "Fintech regulation & digital banking",
    baseScore: 5.5,
    category: "tech",
    narrativeSlot: "AI & tech developments",
    reason: "Fastest-growing regulated sector in the GCC",
  },
  {
    id: "tourism",
    topic: "Tourism metrics & hospitality data",
    baseScore: 5.0,
    category: "sector",
    narrativeSlot: "Sector deep dives",
    reason: "Post-oil diversification health indicator",
  },
  {
    id: "logistics_trade",
    topic: "Logistics, ports & trade corridor developments",
    baseScore: 4.5,
    category: "sector",
    narrativeSlot: "Sector deep dives",
    reason: "Trade infrastructure and corridor strategy signal",
  },
  {
    id: "public_investment",
    topic: "Public investment & giga-project milestones",
    baseScore: 4.5,
    category: "sector",
    narrativeSlot: "Sector deep dives",
    reason: "Government spending multiplier for private sector",
  },
  {
    id: "horcea_retail",
    topic: "HORECA & retail spending data",
    baseScore: 3.5,
    category: "sector",
    narrativeSlot: "Sector deep dives",
    reason: "Consumer economy health indicator, lifestyle economy insights",
  },
  {
    id: "partnerships",
    topic: "Minor partnerships & MOUs",
    baseScore: 2.5,
    category: "minor",
    narrativeSlot: "Briefs / rounding",
    reason: "Low macro impact — filler-level signal",
  },
  {
    id: "generic_tech",
    topic: "Generic tech announcements (non-GCC specific)",
    baseScore: 1.5,
    category: "minor",
    narrativeSlot: "Briefs / rounding",
    reason: "Not GCC-specific, low editorial value",
  },
];

// ──────────────────────────────────────────────────────────────
// NARRATIVE ORDER — Morning Brew–style editorial flow
// ──────────────────────────────────────────────────────────────
// DeepSeek MUST follow this order when constructing the newsletter.
// This ensures consistent narrative structure across all runs.

const NARRATIVE_ORDER = [
  "Macro anchors (oil, rates, markets)",
  "Sovereign / policy moves",
  "Regional geopolitics",
  "AI & tech developments",
  "Startup & VC activity",
  "Sector deep dives",
  "Briefs / rounding",
];

// ──────────────────────────────────────────────────────────────
// BREAKING SIGNAL PATTERNS
// ──────────────────────────────────────────────────────────────
// Deterministic patterns that trigger "breaking" flags.
// These are checked against the date context and topic profiles.

const BREAKING_SIGNAL_PATTERNS = [
  {
    pattern: /oil.*[±+\->]\s*[2-9]/i,
    label: "oil spike > 2%",
    severity: "high",
  },
  {
    pattern: /(policy|royal|decree|announce).*(vision|reform|initiative)/i,
    label: "policy announcement",
    severity: "high",
  },
  {
    pattern: /\$\s*[1-9]\d{8,}/,
    label: "major deal > $1B",
    severity: "high",
  },
  {
    pattern: /(central bank|sama|monetary policy).*(rate|hike|cut|hold|decision)/i,
    label: "monetary policy move",
    severity: "high",
  },
  {
    pattern: /(opec\+).*(cut|reduce|increase|decision|meeting)/i,
    label: "OPEC+ decision",
    severity: "high",
  },
  {
    pattern: /(ipo|listing).*\$\s*[5-9]\d{8,}/i,
    label: "major IPO > $500M",
    severity: "high",
  },
  {
    pattern: /(mega.project|giga.project|neom|red sea|diriyah|roshn)/i,
    label: "giga-project milestone",
    severity: "medium",
  },
];

// ──────────────────────────────────────────────────────────────
// SEASONAL / CALENDAR WEIGHTS
// ──────────────────────────────────────────────────────────────
// Certain topics get score boosts based on the time of year.
// Based on the GCC Topics document seasonal calendar.

function getSeasonalBoost(currentDate) {
  const date = new Date(currentDate);
  const month = date.getMonth() + 1; // 1-based

  const boosts = [];

  // Ramadan (approx. lunar — simplified to typical window)
  if (month >= 2 && month <= 4) {
    boosts.push({ topicId: "horcea_retail", boost: 1.5, reason: "Ramadan consumer spending patterns" });
  }

  // Hajj season (approx. June-July 2026)
  if (month >= 5 && month <= 7) {
    boosts.push({ topicId: "tourism", boost: 2.0, reason: "Hajj season tourism / travel demand" });
    boosts.push({ topicId: "logistics_trade", boost: 1.0, reason: "Hajj logistics demand" });
    boosts.push({ topicId: "horcea_retail", boost: 1.0, reason: "Hajj hospitality demand" });
  }

  // OPEC+ meetings (typically quarterly — Jan, Apr, Jun, Sep)
  if ([1, 4, 6, 9].includes(month)) {
    boosts.push({ topicId: "oil_macro", boost: 1.0, reason: "OPEC+ meeting window" });
  }

  // Year-end sovereign wealth reviews
  if (month === 12 || month === 1) {
    boosts.push({ topicId: "swf_moves", boost: 1.5, reason: "Sovereign wealth annual review season" });
    boosts.push({ topicId: "public_investment", boost: 1.5, reason: "Budget announcement season" });
  }

  // Q1/Q3 trade data releases
  if ([1, 3, 4, 7, 9, 10].includes(month)) {
    boosts.push({ topicId: "logistics_trade", boost: 1.0, reason: "Trade data release window" });
    boosts.push({ topicId: "macro_shifts", boost: 1.0, reason: "Quarterly GDP / economic data releases" });
  }

  return boosts;
}

// ──────────────────────────────────────────────────────────────
// DAY-OF-WEEK CONTEXT
// ──────────────────────────────────────────────────────────────
// Weekend context (Fri-Sat in Saudi) affects what editorial
// weight is appropriate.

function getDayOfWeekContext(currentDate) {
  const day = new Date(currentDate).getDay(); // 0=Sun, ..., 6=Sat
  const isWeekend = day === 5 || day === 6; // Fri-Sat in Saudi

  return {
    isWeekend,
    dayName: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day],
    isStartOfWeek: day === 0,    // Sunday = start of Saudi work week
    isMidWeek: day >= 1 && day <= 3, // Mon-Wed peak business days
    isEndOfWeek: day === 4,      // Thursday = last business day before weekend
  };
}

// ──────────────────────────────────────────────────────────────
// CORE: BUILD EDITORIAL FRAME
// ──────────────────────────────────────────────────────────────

/**
 * Build a deterministic editorial frame for the newsletter pipeline.
 *
 * @param {string} currentDate - ISO date string (YYYY-MM-DD)
 * @param {Object} [options] - Optional overrides
 * @param {Array}  [options.extraSignals] - Additional breaking signals to inject
 * @returns {Object} editorialFrame
 */
export function buildEditorialFrame(currentDate, options = {}) {
  const dayContext = getDayOfWeekContext(currentDate);
  const seasonalBoosts = getSeasonalBoost(currentDate);

  // ── Step 1: Score all topic profiles ──────────────────────
  const priorityRanking = TOPIC_PROFILES.map((profile) => {
    let score = profile.baseScore;

    // Apply seasonal boosts
    const matchingBoosts = seasonalBoosts.filter((b) => b.topicId === profile.id);
    for (const boost of matchingBoosts) {
      score += boost.boost;
    }

    // Clamp to 1–10 range
    score = Math.max(1, Math.min(10, score));

    return {
      topic: profile.topic,
      score: Math.round(score * 10) / 10, // one decimal place
      category: profile.category,
      narrativeSlot: profile.narrativeSlot,
      reason: profile.reason,
    };
  });

  // Sort by score descending
  priorityRanking.sort((a, b) => b.score - a.score);

  // ── Step 2: Build narrative order (constrained by profiles) ──
  // Map each narrative slot to the topics that belong there
  const narrativeStructure = NARRATIVE_ORDER.map((slot) => {
    const topicsInSlot = priorityRanking
      .filter((t) => t.narrativeSlot === slot)
      .map((t) => ({
        topic: t.topic,
        score: t.score,
      }));

    return {
      slot,
      priority: NARRATIVE_ORDER.indexOf(slot) + 1,
      topics: topicsInSlot,
    };
  });

  // ── Step 3: Detect breaking signals ──────────────────────
  const breakingSignals = priorityRanking
    .filter((topic) => {
      // A topic scores as "breaking" if it's high priority and in a high-impact category
      return topic.score >= 8.0 && ["macro", "policy", "geopolitics"].includes(topic.category);
    })
    .map((topic) => ({
      signal: `High-priority topic active: ${topic.topic}`,
      source: topic.reason,
      severity: topic.score >= 9.0 ? "high" : "medium",
    }));

  // Add any extra signals passed in
  if (options.extraSignals && Array.isArray(options.extraSignals)) {
    for (const signal of options.extraSignals) {
      breakingSignals.push(signal);
    }
  }

  // ── Step 4: Compile editorial frame ──────────────────────
  return {
    frameGeneratedAt: new Date().toISOString(),
    dateContext: currentDate,
    dayContext,
    priorityRanking,
    narrativeOrder: NARRATIVE_ORDER,
    narrativeStructure,
    breakingSignals,
    editorialDirective: [
      "Follow this editorial ordering and prioritization when constructing the newsletter.",
      "Start with the highest-impact macro events.",
      "Progress through each narrative slot in the specified order.",
      "Maintain Morning Brew–style flow: macro first → then policy → then markets → then tech/startups → then sector deep dives.",
      "Do NOT randomize or reorder stories.",
      "If a narrative slot has no content, skip it — do not force filler.",
    ].join(" "),
    metadata: {
      engine: "editorial-intelligence-layer",
      version: "1.0.0",
      type: "deterministic",
      seasonalBoostsApplied: seasonalBoosts.length > 0 ? seasonalBoosts : [],
    },
  };
}

// ──────────────────────────────────────────────────────────────
// UTILITY: Format editorial frame as a prompt attachment
// ──────────────────────────────────────────────────────────────

/**
 * Format the editorial frame as a string block that can be
 * injected into a DeepSeek prompt.
 *
 * @param {Object} editorialFrame - Output of buildEditorialFrame()
 * @returns {string} Formatted prompt attachment
 */
export function formatEditorialFrame(editorialFrame) {
  const ranking = editorialFrame.priorityRanking
    .map(
      (t, i) =>
        `  ${i + 1}. [${t.score.toFixed(1)}/10] ${t.topic} — ${t.reason}`
    )
    .join("\n");

  const narrativeFlow = editorialFrame.narrativeOrder
    .map((slot, i) => `  ${i + 1}. ${slot}`)
    .join("\n");

  const signals = editorialFrame.breakingSignals
    .map((s) => `  ⚡ [${s.severity.toUpperCase()}] ${s.signal}`)
    .join("\n");

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 EDITORIAL FRAME — Apply to this newsletter
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRIORITY RANKING (highest to lowest editorial importance):
${ranking}

NARRATIVE ORDER (MUST follow this sequence):
${narrativeFlow}

BREAKING SIGNALS:
${signals || "  (none detected)"}

EDITORIAL DIRECTIVE:
${editorialFrame.editorialDirective}

CONTEXT:
  Date: ${editorialFrame.dateContext}
  Day: ${editorialFrame.dayContext.dayName}${editorialFrame.dayContext.isWeekend ? " (Weekend — expect thinner news flow)" : ""}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}
