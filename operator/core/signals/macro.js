/**
 * macro.js — Macroeconomic Signal Generator
 *
 * Generates deterministic macroeconomic signals for the GCC region.
 * Covers: oil prices, interest rates, inflation indicators, GCC sovereign fund activity.
 *
 * This is NOT connected to live feeds. Signals are derived from:
 *   - Current date context for seasonal/recurring events
 *   - Known GCC macroeconomic patterns
 *   - Editorial frame data for narrative alignment
 *
 * All output signals conform to the normalized signal format:
 *   { signalType, region, impact, confidence, summary, source }
 *
 * @module signals/macro
 */

// ── BASE SIGNALS — Deterministic Macro Profiles ──────────────────────────
// These are the foundational macro signals that drive GCC economic narratives.
// Each signal includes a base impact, confidence, and source.
// Dynamic adjustments (seasonal, event-based) are applied via adjustSignals().

const BASE_MACRO_SIGNALS = [
  {
    id: "oil_brent",
    signalType: "MACRO",
    region: "GCC",
    impact: "HIGH",
    confidence: 0.85,
    summary: "Brent crude trades near $78/bbl as OPEC+ maintains gradual output normalization amid global demand uncertainty.",
    source: "OPEC Monthly Market Report / EIA",
  },
  {
    id: "oil_gcc_spread",
    signalType: "MACRO",
    region: "GCC",
    impact: "HIGH",
    confidence: 0.80,
    summary: "GCC oil revenues forecast to sustain fiscal breakeven at current production levels, with Saudi Arabia needing ~$85/bbl for budget balance.",
    source: "IMF Regional Economic Outlook / SAMA",
  },
  {
    id: "fed_rate",
    signalType: "MACRO",
    region: "GCC",
    impact: "HIGH",
    confidence: 0.90,
    summary: "US Federal Reserve holds rates at 4.25-4.50% — GCC central banks (SAMA, UAE CB, QCB) expected to maintain currency peg alignment.",
    source: "Federal Reserve FOMC / SAMA Monetary Policy",
  },
  {
    id: "gcc_inflation",
    signalType: "MACRO",
    region: "GCC",
    impact: "MEDIUM",
    confidence: 0.75,
    summary: "GCC inflation remains contained at 2.1-2.8% YoY, driven by housing and food costs, below global averages.",
    source: "GASTAT / UAE FCSC / Qatar PSA",
  },
  {
    id: "pif_aum",
    signalType: "MACRO",
    region: "KSA",
    impact: "HIGH",
    confidence: 0.70,
    summary: "PIF total assets under management surpass $925B, with accelerated domestic deployment in giga-projects and international strategic stakes.",
    source: "PIF Annual Report / Sovereign Wealth Fund Institute",
  },
  {
    id: "mubadala_adia",
    signalType: "MACRO",
    region: "UAE",
    impact: "MEDIUM",
    confidence: 0.65,
    summary: "ADIA and Mubadala increase allocation to private credit and infrastructure, signaling shift toward yield-generating alternative assets.",
    source: "ADIA Review / Mubadala Investment Outlook",
  },
  {
    id: "qatar_gdp",
    signalType: "MACRO",
    region: "QA",
    impact: "MEDIUM",
    confidence: 0.70,
    summary: "Qatar GDP growth moderates to 2.5% as LNG expansion projects reach operational phase and non-energy sector diversification accelerates.",
    source: "Qatar Planning & Statistics Authority",
  },
  {
    id: "gcc_non_oil_gdp",
    signalType: "MACRO",
    region: "GCC",
    impact: "HIGH",
    confidence: 0.75,
    summary: "GCC non-oil GDP expands 4.2% YoY driven by tourism, logistics, financial services, and manufacturing — diversification momentum sustained.",
    source: "IMF / World Bank GCC Economic Update",
  },
  {
    id: "gcc_fiscal_breakeven",
    signalType: "MACRO",
    region: "GCC",
    impact: "MEDIUM",
    confidence: 0.80,
    summary: "GCC combined fiscal surplus projected at $45B for FY2026 as non-oil revenue growth offsets moderate oil price environment.",
    source: "IMF Fiscal Monitor / GCC Secretariat",
  },
  {
    id: "remittance_flows",
    signalType: "MACRO",
    region: "GCC",
    impact: "LOW",
    confidence: 0.65,
    summary: "GCC remittance outflows remain stable at ~$120B annually, with Saudi Arabia and UAE accounting for 70% of total flows.",
    source: "World Bank Migration & Development Brief",
  },
];

// ── SEASONAL ADJUSTMENTS ─────────────────────────────────────────────────
// Certain macro signals gain/lose relevance based on time of year.

function getSeasonalAdjustments(currentDate) {
  const date = new Date(currentDate);
  const month = date.getMonth() + 1; // 1-based

  const adjustments = [];

  // OPEC+ meeting months (typically Jan, Apr, Jun, Sep)
  if ([1, 4, 6, 9].includes(month)) {
    adjustments.push({
      id: "oil_brent",
      impactBoost: true,
      confidenceBoost: 0.05,
      reason: "OPEC+ meeting window — increased oil price volatility expected",
    });
  }

  // Saudi budget announcement (Dec/Jan)
  if ([1, 12].includes(month)) {
    adjustments.push({
      id: "gcc_fiscal_breakeven",
      impactBoost: true,
      confidenceBoost: 0.05,
      reason: "Saudi budget announcement season — fiscal outlook in focus",
    });
  }

  // Q1/Q3 GDP data releases
  if ([1, 3, 4, 7, 9, 10].includes(month)) {
    adjustments.push({
      id: "gcc_non_oil_gdp",
      impactBoost: true,
      confidenceBoost: 0.05,
      reason: "Quarterly GDP data release window",
    });
  }

  // IMF/World Bank spring/fall meetings
  if ([4, 10].includes(month)) {
    adjustments.push({
      id: "gcc_fiscal_breakeven",
      impactBoost: true,
      confidenceBoost: 0.05,
      reason: "IMF/World Bank meetings — regional economic outlook updates",
    });
  }

  return adjustments;
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────

/**
 * Generate macroeconomic signals for the GCC region.
 *
 * @param {string} currentDate - ISO date string (YYYY-MM-DD)
 * @param {Object} [editorialFrame] - Optional editorial frame for context alignment
 * @returns {Array<Object>} Array of normalized macro signals
 */
export function generateMacroSignals(currentDate, editorialFrame = null) {
  const adjustments = getSeasonalAdjustments(currentDate);

  const signals = BASE_MACRO_SIGNALS.map((base) => {
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
      const macroTopics = editorialFrame.priorityRanking.filter(
        (t) => t.category === "macro" && t.score >= 7.0
      );
      if (macroTopics.length > 0 && base.impact === "MEDIUM") {
        impact = "HIGH";
        adjustmentsApplied.push("Editorial frame alignment — macro topic priority elevated");
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

  // Filter out _internal fields before returning
  return signals.map(({ _id, _adjustments, ...signal }) => signal);
}
