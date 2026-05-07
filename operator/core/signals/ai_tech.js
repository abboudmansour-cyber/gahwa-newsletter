/**
 * ai_tech.js — AI & Technology Signal Generator
 *
 * Generates deterministic AI/tech signals relevant to the GCC region.
 * Covers: AI investments in GCC, Saudi/UAE AI initiatives, global AI spillover relevance.
 *
 * This is NOT connected to live feeds. Signals are derived from:
 *   - Current date context
 *   - Known GCC AI/tech investment patterns
 *   - Editorial frame data
 *
 * All output signals conform to the normalized signal format:
 *   { signalType, region, impact, confidence, summary, source }
 *
 * @module signals/ai_tech
 */

// ── BASE AI/TECH SIGNALS ─────────────────────────────────────────────────

const BASE_AI_TECH_SIGNALS = [
  {
    id: "ksa_ai_city",
    signalType: "AI",
    region: "KSA",
    impact: "HIGH",
    confidence: 0.75,
    summary: "Saudi Arabia accelerates NEOM AI City and data center investments with $15B committed to GPU clusters and sovereign AI infrastructure buildout.",
    source: "NEOM Tech & Digital / Saudi Vision 2030 AI Roadmap",
  },
  {
    id: "uae_ai_ministry",
    signalType: "AI",
    region: "UAE",
    impact: "HIGH",
    confidence: 0.80,
    summary: "UAE AI Ministry launches national AI adoption framework targeting 15% GDP contribution from AI by 2031, with mandatory federal AI training programs.",
    source: "UAE AI Ministry / UAE Strategy for AI 2031",
  },
  {
    id: "gcc_ai_funding",
    signalType: "AI",
    region: "GCC",
    impact: "HIGH",
    confidence: 0.70,
    summary: "GCC AI startup funding reaches $1.2B in Q1 2026, with enterprise AI, healthcare AI, and fintech AI capturing 80% of deal flow.",
    source: "Magnitt MENA Venture Report / Wamda AI Investment Tracker",
  },
  {
    id: "ksa_data_sovereignty",
    signalType: "AI",
    region: "KSA",
    impact: "MEDIUM",
    confidence: 0.75,
    summary: "Saudi Personal Data Protection Law (PDPL) enforcement phase triggers $500M+ in compliance spending, driving demand for local AI and cloud solutions.",
    source: "SDAIA / Saudi Data & AI Authority Regulations",
  },
  {
    id: "uae_global_ai_talent",
    signalType: "AI",
    region: "UAE",
    impact: "MEDIUM",
    confidence: 0.65,
    summary: "UAE launches Global AI Talent Visa program, attracting 2,500+ AI researchers and engineers, targeting top-10 global AI talent hub status by 2028.",
    source: "UAE Cabinet / Ministry of AI Talent Initiative",
  },
  {
    id: "gcc_quantum_computing",
    signalType: "AI",
    region: "GCC",
    impact: "LOW",
    confidence: 0.55,
    summary: "GCC quantum computing investments reach $2.5B with Saudi Arabia and UAE establishing national quantum research centers and partnerships with IBM and Google Quantum AI.",
    source: "Quantum Insider / GCC Quantum Initiative Tracker",
  },
  {
    id: "saudi_cloud_adoption",
    signalType: "AI",
    region: "KSA",
    impact: "MEDIUM",
    confidence: 0.80,
    summary: "Saudi cloud services market grows 28% YoY to $4.2B as Oracle, Microsoft, and Google expand local data center regions to meet sovereignty requirements.",
    source: "IDC Saudi Arabia Cloud Report / Gartner Cloud Adoption Metrics",
  },
  {
    id: "gcc_fintech_ai",
    signalType: "AI",
    region: "GCC",
    impact: "MEDIUM",
    confidence: 0.75,
    summary: "GCC fintech sector deploys AI-driven credit scoring, fraud detection, and robo-advisory at scale — digital banking adoption reaches 65% in KSA and 72% in UAE.",
    source: "SAMA / UAE Central Bank Fintech Report / Accenture GCC Digital Banking",
  },
  {
    id: "uae_web3_blockchain",
    signalType: "AI",
    region: "UAE",
    impact: "LOW",
    confidence: 0.60,
    summary: "UAE blockchain and Web3 infrastructure investments total $1.8B, with Dubai Blockchain Strategy targeting 50% of government transactions on DLT by 2027.",
    source: "Dubai Future Foundation / UAE Blockchain Strategy 2027",
  },
  {
    id: "gcc_cyber_resilience",
    signalType: "AI",
    region: "GCC",
    impact: "MEDIUM",
    confidence: 0.70,
    summary: "GCC cyber security spending exceeds $6B as AI-powered threat detection and national cyber resilience frameworks become priority for sovereign security.",
    source: "NCA Saudi / UAE Cyber Security Council / Gartner IT Security Spending",
  },
];

// ── SEASONAL ADJUSTMENTS ─────────────────────────────────────────────────

function getSeasonalAdjustments(currentDate) {
  const date = new Date(currentDate);
  const month = date.getMonth() + 1;

  const adjustments = [];

  // LEAP / global tech conferences (typically Jan-Feb)
  if ([1, 2].includes(month)) {
    adjustments.push({
      id: "ksa_ai_city",
      impactBoost: false,
      confidenceBoost: 0.05,
      reason: "LEAP / global tech conference season — GCC AI announcements peak",
    });
    adjustments.push({
      id: "uae_ai_ministry",
      impactBoost: false,
      confidenceBoost: 0.03,
      reason: "Tech conference season — policy and partnership announcements",
    });
  }

  // Q1/Q3 budget cycles for government AI spending
  if ([1, 3, 7, 9].includes(month)) {
    adjustments.push({
      id: "gcc_ai_funding",
      impactBoost: true,
      confidenceBoost: 0.03,
      reason: "Government budget cycle — AI spending allocations announced",
    });
  }

  // GITEX (typically Oct) — major GCC tech expo
  if (month === 10) {
    adjustments.push({
      id: "uae_global_ai_talent",
      impactBoost: true,
      confidenceBoost: 0.05,
      reason: "GITEX season — major AI product and talent announcements",
    });
    adjustments.push({
      id: "gcc_cyber_resilience",
      impactBoost: true,
      confidenceBoost: 0.03,
      reason: "GITEX season — cybersecurity product launches and partnerships",
    });
  }

  return adjustments;
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────

/**
 * Generate AI/technology signals relevant to the GCC region.
 *
 * @param {string} currentDate - ISO date string (YYYY-MM-DD)
 * @param {Object} [editorialFrame] - Optional editorial frame for context alignment
 * @returns {Array<Object>} Array of normalized AI/tech signals
 */
export function generateAITechSignals(currentDate, editorialFrame = null) {
  const adjustments = getSeasonalAdjustments(currentDate);

  const signals = BASE_AI_TECH_SIGNALS.map((base) => {
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
      const aiTopicActive = editorialFrame.priorityRanking.some(
        (t) => (t.category === "tech" || t.topic.toLowerCase().includes("ai")) && t.score >= 7.0
      );
      if (aiTopicActive && base.impact === "MEDIUM" && base.id !== "gcc_quantum_computing") {
        impact = base.id.startsWith("gcc_fintech") || base.id.startsWith("gcc_cyber") ? "HIGH" : "MEDIUM";
        adjustmentsApplied.push("Editorial frame alignment — AI/tech topic priority active");
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
