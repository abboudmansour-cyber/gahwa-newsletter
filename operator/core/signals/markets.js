/**
 * markets.js — GCC Market Signal Generator
 *
 * Generates deterministic market signals for GCC equity and energy markets.
 * Covers: Tadawul, UAE markets, Qatar energy stocks, regional indices.
 *
 * This is NOT connected to live feeds. Signals are derived from:
 *   - Current date context
 *   - Known GCC market patterns
 *   - Editorial frame data
 *
 * All output signals conform to the normalized signal format:
 *   { signalType, region, impact, confidence, summary, source }
 *
 * @module signals/markets
 */

// ── BASE MARKET SIGNALS ──────────────────────────────────────────────────

const BASE_MARKET_SIGNALS = [
  {
    id: "tadawul_index",
    signalType: "MARKET",
    region: "KSA",
    impact: "HIGH",
    confidence: 0.80,
    summary: "Tadawul All Share Index (TASI) trades near 12,450, supported by banking and materials sectors, with YTD gains of 8.3%.",
    source: "Saudi Exchange (Tadawul) Daily Summary",
  },
  {
    id: "aramco_trading",
    signalType: "MARKET",
    region: "KSA",
    impact: "HIGH",
    confidence: 0.85,
    summary: "Saudi Aramco shares stabilize around SAR 28.50 as sustained dividend yield of 6.2% attracts institutional flows despite moderate oil price environment.",
    source: "Saudi Exchange / Bloomberg GCC Markets",
  },
  {
    id: "adx_dfm",
    signalType: "MARKET",
    region: "UAE",
    impact: "MEDIUM",
    confidence: 0.75,
    summary: "ADX and DFM indices mixed — Abu Dhabi index gains 0.8% on ADNOC and banking support, while Dubai trades flat on real estate profit-taking.",
    source: "Abu Dhabi Securities Exchange / Dubai Financial Market",
  },
  {
    id: "qatar_energy",
    signalType: "MARKET",
    region: "QA",
    impact: "MEDIUM",
    confidence: 0.75,
    summary: "Qatar Energy index rises 1.2% on North Field LNG expansion progress and sustained Asian demand for LNG contracts.",
    source: "Qatar Stock Exchange / Bloomberg Energy",
  },
  {
    id: "gcc_banking",
    signalType: "MARKET",
    region: "GCC",
    impact: "HIGH",
    confidence: 0.80,
    summary: "GCC banking sector shows robust NIM expansion as higher-for-longer rate environment boosts lending income — SNB, QNB, FAB report strong quarterly metrics.",
    source: "GCC Bank Earnings Reports / Reuters",
  },
  {
    id: "real_estate_idx",
    signalType: "MARKET",
    region: "UAE",
    impact: "MEDIUM",
    confidence: 0.70,
    summary: "Dubai real estate index corrects 2.1% as Emaar and DAMAC face profit-taking following 18-month rally — transaction volumes remain elevated.",
    source: "Dubai Land Department / DFM Real Estate Index",
  },
  {
    id: "gcc_ipo_pipeline",
    signalType: "MARKET",
    region: "GCC",
    impact: "MEDIUM",
    confidence: 0.65,
    summary: "GCC IPO pipeline remains active with 8+ listings in Q2 2026 across Tadawul, ADX, and QSE — healthcare and logistics sectors dominate issuance.",
    source: "Dealogic / Zawya IPO Watch",
  },
  {
    id: "sukuk_market",
    signalType: "MARKET",
    region: "GCC",
    impact: "LOW",
    confidence: 0.70,
    summary: "GCC sukuk issuance reaches $35B YTD as sovereigns and corporals capitalize on favorable pricing — Saudi Arabia leads with 45% of volumes.",
    source: "IIFM Sukuk Report / Bloomberg Fixed Income",
  },
  {
    id: "gcc_etf_flows",
    signalType: "MARKET",
    region: "GCC",
    impact: "LOW",
    confidence: 0.60,
    summary: "Foreign inflows into GCC equity ETFs total $2.8B YTD, with Tadawul ETF listings attracting 60% of regional passive flow.",
    source: "BlackRock / HSBC GCC Fund Flows Report",
  },
  {
    id: "uae_logistics_stocks",
    signalType: "MARKET",
    region: "UAE",
    impact: "MEDIUM",
    confidence: 0.65,
    summary: "UAE logistics and transport stocks outperform on e-commerce growth and port expansion — DP World, AD Ports, and Aramex see volume increases.",
    source: "Abu Dhabi Securities Exchange / AD Ports Group",
  },
];

// ── SEASONAL ADJUSTMENTS ─────────────────────────────────────────────────

function getSeasonalAdjustments(currentDate) {
  const date = new Date(currentDate);
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay(); // 0=Sun
  const dayOfMonth = date.getDate();

  const adjustments = [];

  // Earnings season (typically Feb-Mar, Aug-Sep, Nov-Dec)
  if ([2, 3, 8, 9, 11, 12].includes(month)) {
    adjustments.push({
      id: "gcc_banking",
      impactBoost: true,
      confidenceBoost: 0.05,
      reason: "Earnings season — banking sector results in focus",
    });
    adjustments.push({
      id: "aramco_trading",
      impactBoost: true,
      confidenceBoost: 0.03,
      reason: "Earnings season — corporate results drive sentiment",
    });
  }

  // Dividend distribution period (Apr-May in Saudi)
  if ([4, 5].includes(month)) {
    adjustments.push({
      id: "aramco_trading",
      impactBoost: false,
      confidenceBoost: 0.03,
      reason: "Dividend distribution period — yield-focused flows",
    });
  }

  // Weekday effect: Sunday (start of Saudi week) sees higher market analysis
  if (dayOfWeek === 0) {
    adjustments.push({
      id: "tadawul_index",
      impactBoost: false,
      confidenceBoost: 0.02,
      reason: "Start of Saudi trading week — weekend carry-over analysis",
    });
  }

  // Month-end portfolio rebalancing
  if (dayOfMonth >= 25 && dayOfMonth <= 31) {
    adjustments.push({
      id: "gcc_etf_flows",
      impactBoost: true,
      confidenceBoost: 0.05,
      reason: "Month-end portfolio rebalancing — fund flow reporting window",
    });
  }

  return adjustments;
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────

/**
 * Generate market signals for GCC equity and energy markets.
 *
 * @param {string} currentDate - ISO date string (YYYY-MM-DD)
 * @param {Object} [editorialFrame] - Optional editorial frame for context alignment
 * @returns {Array<Object>} Array of normalized market signals
 */
export function generateMarketSignals(currentDate, editorialFrame = null) {
  const adjustments = getSeasonalAdjustments(currentDate);

  const signals = BASE_MARKET_SIGNALS.map((base) => {
    let impact = base.impact;
    let confidence = base.confidence;
    let adjustmentsApplied = [];

    // Apply seasonal adjustments
    for (const adj of adjustments) {
      if (adj.id === base.id) {
        if (adj.impactBoost) {
          impact = impact === "LOW" ? "MEDIUM" : impact === "MEDIUM" ? "HIGH" : "HIGH";
        }
        confidence = Math.min(1, confidence + (adj.confidenceBoost || 0));
        adjustmentsApplied.push(adj.reason);
      }
    }

    // Apply editorial frame alignment if available
    if (editorialFrame && editorialFrame.priorityRanking) {
      const marketTopics = editorialFrame.priorityRanking.filter(
        (t) => (t.category === "markets" || t.topic.toLowerCase().includes("banking") || t.topic.toLowerCase().includes("earnings")) && t.score >= 6.0
      );
      if (marketTopics.length > 0 && base.impact === "MEDIUM") {
        impact = "HIGH";
        adjustmentsApplied.push("Editorial frame alignment — market topic priority elevated");
      }
    }

    return {
      signalType: base.signalType,
      region: base.region,
      impact,
      confidence: Math.round(confidence * 100) / 100,
      summary: base.summary,
      source: base.source,
      _id: base.id,
      _adjustments: adjustmentsApplied.length > 0 ? adjustmentsApplied : undefined,
    };
  });

  // Filter out internal fields before returning
  return signals.map(({ _id, _adjustments, ...signal }) => signal);
}
