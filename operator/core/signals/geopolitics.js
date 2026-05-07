/**
 * geopolitics.js — Geopolitical Signal Generator
 *
 * Generates deterministic geopolitical signals for the GCC region.
 * Covers: GCC diplomatic updates, OPEC decisions, regional stability signals.
 *
 * This is NOT connected to live feeds. Signals are derived from:
 *   - Current date context
 *   - Known GCC geopolitical patterns
 *   - Editorial frame data
 *
 * All output signals conform to the normalized signal format:
 *   { signalType, region, impact, confidence, summary, source }
 *
 * @module signals/geopolitics
 */

// ── BASE GEOPOLITICAL SIGNALS ────────────────────────────────────────────

const BASE_GEO_SIGNALS = [
  {
    id: "opec_plus_strategy",
    signalType: "GEO",
    region: "GCC",
    impact: "HIGH",
    confidence: 0.85,
    summary: "OPEC+ maintains cautious output strategy with 2.2M bpd voluntary cuts extended, balancing market share discipline against global demand slowdown signals.",
    source: "OPEC+ Communiqué / Reuters OPEC Watch",
  },
  {
    id: "saudi_iran_relations",
    signalType: "GEO",
    region: "KSA",
    impact: "HIGH",
    confidence: 0.70,
    summary: "Saudi-Iran diplomatic engagement continues with embassy operations normalized, though regional proxy competition in Yemen and Iraq persists.",
    source: "MFA Saudi Arabia / Gulf State Analytics",
  },
  {
    id: "uae_israel_abraham",
    signalType: "GEO",
    region: "UAE",
    impact: "MEDIUM",
    confidence: 0.75,
    summary: "UAE-Israel economic corridor expands with $3.5B in bilateral trade, technology partnerships, and investment flows under Abraham Accords framework.",
    source: "UAE Ministry of Economy / Israel-GCC Business Council",
  },
  {
    id: "gcc_china_trade",
    signalType: "GEO",
    region: "GCC",
    impact: "HIGH",
    confidence: 0.80,
    summary: "GCC-China trade volumes exceed $350B annually with yuan-denominated oil contracts gaining traction, signaling de-dollarization momentum in energy trade.",
    source: "China-GCC Strategic Dialogue / Gulf Research Center",
  },
  {
    id: "gcc_eu_trade_deal",
    signalType: "GEO",
    region: "GCC",
    impact: "MEDIUM",
    confidence: 0.65,
    summary: "GCC-EU Free Trade Agreement negotiations resume after 15-year hiatus, focusing on services, digital trade, and clean energy technology transfers.",
    source: "EU Commission Trade Directorate / GCC Secretariat",
  },
  {
    id: "red_sea_shipping",
    signalType: "GEO",
    region: "GCC",
    impact: "HIGH",
    confidence: 0.75,
    summary: "Red Sea shipping disruptions continue to impact GCC port throughput and insurance costs, though maritime security patrols show stabilizing effect.",
    source: "Lloyd's List / GCC Maritime Security Briefing",
  },
  {
    id: "gcc_india_partnership",
    signalType: "GEO",
    region: "GCC",
    impact: "MEDIUM",
    confidence: 0.75,
    summary: "GCC-India strategic partnership deepens with food security deals, energy cooperation, and expanded air transport agreements worth $2.8B.",
    source: "GCC-India Joint Ministerial Commission",
  },
  {
    id: "saudi_visa_reforms",
    signalType: "GEO",
    region: "KSA",
    impact: "MEDIUM",
    confidence: 0.85,
    summary: "Saudi Arabia expands tourism and business visa reforms, including 5-year multiple-entry visas for 49 countries, boosting FDI and tourism targets.",
    source: "Saudi Ministry of Tourism / Saudi Vision 2030 Tracker",
  },
  {
    id: "qatar_energy_diplomacy",
    signalType: "GEO",
    region: "QA",
    impact: "MEDIUM",
    confidence: 0.80,
    summary: "Qatar leverages LNG position to mediate regional disputes and secure long-term energy supply agreements with European and Asian partners.",
    source: "Qatar Ministry of Foreign Affairs / Energy Intelligence",
  },
  {
    id: "gcc_turkey_normalization",
    signalType: "GEO",
    region: "GCC",
    impact: "LOW",
    confidence: 0.65,
    summary: "GCC-Turkey economic normalization progresses with $25B trade target and sovereign investment commitments in Turkish energy and defense sectors.",
    source: "UAE-Turkey Joint Economic Commission / Anadolu Agency",
  },
];

// ── SEASONAL ADJUSTMENTS ─────────────────────────────────────────────────

function getSeasonalAdjustments(currentDate) {
  const date = new Date(currentDate);
  const month = date.getMonth() + 1;

  const adjustments = [];

  // OPEC+ meetings (Jan, Apr, Jun, Sep)
  if ([1, 4, 6, 9].includes(month)) {
    adjustments.push({
      id: "opec_plus_strategy",
      impactBoost: true,
      confidenceBoost: 0.05,
      reason: "OPEC+ ministerial meeting window — production decisions in focus",
    });
  }

  // UN General Assembly (Sep) — diplomatic activity peak
  if (month === 9) {
    adjustments.push({
      id: "gcc_china_trade",
      impactBoost: false,
      confidenceBoost: 0.05,
      reason: "UNGA diplomatic season — bilateral meetings intensify",
    });
    adjustments.push({
      id: "saudi_iran_relations",
      impactBoost: false,
      confidenceBoost: 0.03,
      reason: "UNGA diplomatic season — regional dialogue in focus",
    });
  }

  // GCC Summit (typically Dec)
  if (month === 12) {
    adjustments.push({
      id: "gcc_eu_trade_deal",
      impactBoost: true,
      confidenceBoost: 0.05,
      reason: "GCC Summit preparatory period — trade policy announcements expected",
    });
    adjustments.push({
      id: "gcc_india_partnership",
      impactBoost: false,
      confidenceBoost: 0.03,
      reason: "Year-end diplomatic reviews and partnership updates",
    });
  }

  // Red Sea monsoon season (Oct-Mar) — increased shipping disruption risk
  if (month >= 10 || month <= 3) {
    adjustments.push({
      id: "red_sea_shipping",
      impactBoost: true,
      confidenceBoost: 0.03,
      reason: "Seasonal weather patterns increase Red Sea shipping disruption risk",
    });
  }

  return adjustments;
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────

/**
 * Generate geopolitical signals for the GCC region.
 *
 * @param {string} currentDate - ISO date string (YYYY-MM-DD)
 * @param {Object} [editorialFrame] - Optional editorial frame for context alignment
 * @returns {Array<Object>} Array of normalized geopolitical signals
 */
export function generateGeopoliticalSignals(currentDate, editorialFrame = null) {
  const adjustments = getSeasonalAdjustments(currentDate);

  const signals = BASE_GEO_SIGNALS.map((base) => {
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

    // Apply editorial frame alignment
    if (editorialFrame && editorialFrame.priorityRanking) {
      const geoTopicActive = editorialFrame.priorityRanking.some(
        (t) => t.category === "geopolitics" && t.score >= 7.0
      );
      if (geoTopicActive && base.impact === "MEDIUM") {
        // If geopolitics is editorially important, boost related signals
        if (["red_sea_shipping", "saudi_iran_relations"].includes(base.id)) {
          impact = "HIGH";
          adjustmentsApplied.push("Editorial frame alignment — geopolitics elevated");
        }
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

  return signals.map(({ _id, _adjustments, ...signal }) => signal);
}
