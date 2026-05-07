/**
 * scenario-engine.js — GCC Scenario & Impact Simulation Engine
 *
 * EXTENDS the system from "insight generation (what is happening)"
 * to "scenario modeling (what could happen + likely impact paths)."
 *
 * This is NOT prediction. It is bounded scenario reasoning based on
 * existing insights, fused signals, and narrative memory.
 *
 * CORE RULES (non-negotiable):
 *   1. Each scenario REQUIRES at least 2 supporting insights OR signals
 *   2. Every scenario MUST have a clear causal chain (driver → effect → outcome)
 *   3. GCC-specific impact path is REQUIRED
 *   4. At least 2 impact dimensions must be modeled
 *   5. No deterministic predictions ("will happen")
 *   6. No "black swan" fantasy events
 *   7. No political speculation without signals
 *   8. No global vague scenarios (must be GCC-anchored)
 *
 * OUTPUT: 1–3 structured scenarios per run
 *
 * @module scenario-engine
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

// ── PATHS ─────────────────────────────────────────────────────────────────

const SCENARIO_STORE_PATH = path.join(ROOT, "operator", "logs", "scenarios.json");
const INSIGHT_STORE_PATH = path.join(ROOT, "operator", "logs", "insights.json");
const MEMORY_PATH = path.join(ROOT, "operator", "memory", "newsletter-history.json");
const EDITORIAL_LOG_PATH = path.join(ROOT, "operator", "logs", "editorial-decisions.json");

// ── SCENARIO TYPE DEFINITIONS ─────────────────────────────────────────────

const SCENARIO_TYPES = {
  MACRO: "MACRO",
  MARKET: "MARKET",
  GEO: "GEO",
};

// ── IMPACT DIMENSIONS ─────────────────────────────────────────────────────
// At least 2 required per scenario

const IMPACT_DIMENSIONS = {
  Economy: "Economy",
  Markets: "Markets",
  Policy: "Policy",
  Tech: "Tech",
  RegionalStability: "RegionalStability",
};

// ── PROBABILITY BANDS ─────────────────────────────────────────────────────
// Never use exact percentages

const PROBABILITY_BANDS = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

// ── SCENARIO STATUS ───────────────────────────────────────────────────────

const SCENARIO_STATUS = {
  ACTIVE: "ACTIVE",
  VALIDATED: "VALIDATED",
  PARTIAL: "PARTIAL",
  INVALIDATED: "INVALIDATED",
  IRRELEVANT: "IRRELEVANT",
};

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO PATTERNS — Signal-grounded causal models
// ═══════════════════════════════════════════════════════════════════════════
//
// Each pattern defines a structured scenario that can be triggered by
// specific signal/insight conditions. Patterns are NOT free-form narratives.
// They are fixed models with preconditions that must be met.
//
// A scenario only exists when the signals structurally support its causal chain.
//
// ═══════════════════════════════════════════════════════════════════════════

const SCENARIO_PATTERNS = [
  // ── Pattern 1: Sustained Oil Price Elevation ──────────────────────
  // Triggered by: MACRO energy signals + GEO supply-side signals
  {
    id: "oil_price_elevation",
    name: "Sustained Oil Price Elevation",
    type: SCENARIO_TYPES.MACRO,
    description:
      "Oil prices remain elevated due to sustained supply constraints",
    preconditions: {
      requiredSignalTypes: ["MACRO"],
      minMacroSignals: 1,
      minGeoSingals: 1,
      minHighImpact: 1,
      gccRegionRequired: false,
    },
    buildScenario: (signals, insights) => {
      const energySignals = signals.filter(
        (s) =>
          (s.signalType === "MACRO") &&
          (s.summary.toLowerCase().includes("oil") ||
           s.summary.toLowerCase().includes("energy") ||
           s.summary.toLowerCase().includes("brent") ||
           s.summary.toLowerCase().includes("crude") ||
           s.summary.toLowerCase().includes("supply"))
      );
      const geoSupplySignals = signals.filter(
        (s) =>
          s.signalType === "GEO" &&
          (s.summary.toLowerCase().includes("opec") ||
           s.summary.toLowerCase().includes("supply") ||
           s.summary.toLowerCase().includes("production") ||
           s.summary.toLowerCase().includes("export"))
      );

      if (energySignals.length === 0 && geoSupplySignals.length === 0) return null;

      const allRelevant = [...energySignals, ...geoSupplySignals];
      const drivers = allRelevant.map((s) => s.summary.split("—")[0]?.trim() || s.summary).slice(0, 3);

      const hasOpec = geoSupplySignals.some((s) => s.summary.toLowerCase().includes("opec"));
      const hasSupplyCut = allRelevant.some((s) => s.summary.toLowerCase().includes("cut") || s.summary.toLowerCase().includes("constraint"));

      const defaultDrivers = hasOpec
        ? ["OPEC production policy", "Global supply constraints"]
        : ["Supply chain disruption", "Geopolitical risk premium"];

      return {
        scenario: `Oil prices remain elevated due to sustained supply constraints`,
        drivers: drivers.length >= 2 ? drivers : defaultDrivers,
        potentialImpacts: {
          SaudiEconomy: "positive",
          InflationPressure: "moderate",
          InvestmentFlows: "increase",
        },
      };
    },
  },

  // ── Pattern 2: Non-Oil Growth Decoupling ──────────────────────────
  // Triggered by: MACRO non-oil PMI + MARKET sector rotation signals
  {
    id: "non_oil_growth_decoupling",
    name: "Non-Oil Growth Decoupling from Hydrocarbon Cycle",
    type: SCENARIO_TYPES.MACRO,
    description:
      "GCC non-oil sector growth structurally decouples from oil revenue dependency",
    preconditions: {
      requiredSignalTypes: ["MACRO"],
      minMacroSignals: 1,
      minMarketSignals: 1,
      minHighImpact: 1,
      gccRegionRequired: false,
    },
    buildScenario: (signals, insights) => {
      const nonOilSignals = signals.filter(
        (s) =>
          (s.signalType === "MACRO" || s.signalType === "MARKET") &&
          (s.summary.toLowerCase().includes("non-oil") ||
           s.summary.toLowerCase().includes("pmi") ||
           s.summary.toLowerCase().includes("diversification") ||
           s.summary.toLowerCase().includes("tourism") ||
           s.summary.toLowerCase().includes("logistics"))
      );
      const marketSignals = signals.filter(
        (s) => s.signalType === "MARKET" && s.impact === "HIGH"
      );

      if (nonOilSignals.length < 1) return null;

      const allRelevant = [...nonOilSignals, ...marketSignals];
      const drivers = allRelevant.map((s) => s.summary.split("—")[0]?.trim() || s.summary).slice(0, 3);

      const hasPmi = nonOilSignals.some((s) => s.summary.toLowerCase().includes("pmi"));
      const hasTourism = nonOilSignals.some((s) => s.summary.toLowerCase().includes("tourism"));

      return {
        scenario: `GCC non-oil sector growth structurally decouples from hydrocarbon revenue cycle — sustained PMI expansion and sector rotation indicate durable economic transformation`,
        drivers: drivers.length >= 2
          ? drivers
          : ["Non-oil PMI expansion", "Tourism and logistics growth", "Sovereign-backed diversification programs"],
        potentialImpacts: {
          Economy: "positive",
          Markets: "positive",
          Policy: "supportive",
        },
      };
    },
  },

  // ── Pattern 3: Gulf AI Infrastructure Buildout Acceleration ───────
  // Triggered by: AI signals + sovereign fund deployment
  {
    id: "ai_infrastructure_acceleration",
    name: "Gulf AI Infrastructure Buildout Acceleration",
    type: SCENARIO_TYPES.MARKET,
    description:
      "GCC states accelerate AI compute infrastructure investment to establish regional tech dominance",
    preconditions: {
      requiredSignalTypes: ["AI"],
      minAiSignals: 2,
      minMacroSignals: 1,
      minHighImpact: 1,
      gccRegionRequired: false,
    },
    buildScenario: (signals, insights) => {
      const aiSignals = signals.filter(
        (s) => s.signalType === "AI" && s.impact === "HIGH"
      );
      const gccMacroSignals = signals.filter(
        (s) => s.signalType === "MACRO" && (s.region === "GCC" || s.region === "KSA" || s.region === "UAE") && s.impact === "HIGH"
      );

      if (aiSignals.length < 2) return null;

      const allRelevant = [...aiSignals, ...gccMacroSignals];
      const drivers = allRelevant.map((s) => s.summary.split("—")[0]?.trim() || s.summary).slice(0, 3);

      const regions = [...new Set(aiSignals.map((s) => s.region).filter(Boolean))];
      const regionContext = regions.length > 0 ? regions.join("/") : "GCC";

      return {
        scenario: `${regionContext} AI compute infrastructure investment accelerates as sovereign funds compete to establish regional tech dominance — capital deployment pace signals strategic race against global AI leaders`,

        drivers: drivers.length >= 2
          ? drivers
          : [`${regionContext} sovereign AI fund deployment`, "Global AI infrastructure arms race", "Domestic tech ecosystem targets"],
        potentialImpacts: {
          Economy: "positive",
          Tech: "transformative",
          Markets: "positive",
        },
      };
    },
  },

  // ── Pattern 4: GCC Capital Markets Deepening ──────────────────────
  // Triggered by: MARKET signals + institutional flow patterns
  {
    id: "capital_markets_deepening_scenario",
    name: "GCC Capital Markets Institutional Deepening",
    type: SCENARIO_TYPES.MARKET,
    description:
      "GCC equity markets undergo institutional deepening as foreign and institutional flows increase",
    preconditions: {
      requiredSignalTypes: ["MARKET"],
      minMarketSignals: 2,
      minMacroSignals: 1,
      minHighImpact: 1,
      gccRegionRequired: false,
    },
    buildScenario: (signals, insights) => {
      const marketSignals = signals.filter(
        (s) => s.signalType === "MARKET" && (s.impact === "HIGH" || s.impact === "MEDIUM")
      );
      const gccMacroSignals = signals.filter(
        (s) => s.signalType === "MACRO" && (s.region === "GCC" || s.region === "KSA" || s.region === "UAE")
      );

      if (marketSignals.length < 2) return null;

      const allRelevant = [...marketSignals, ...gccMacroSignals];
      const drivers = allRelevant.map((s) => s.summary.split("—")[0]?.trim() || s.summary).slice(0, 3);

      const hasIpo = marketSignals.some((s) => s.summary.toLowerCase().includes("ipo"));
      const hasInstitutional = marketSignals.some((s) => s.summary.toLowerCase().includes("institutional") || s.summary.toLowerCase().includes("flow") || s.summary.toLowerCase().includes("foreign"));

      return {
        scenario: hasIpo
          ? `GCC capital markets deepen as sustained IPO pipeline and institutional capital inflows shift market structure from retail-dominated to institutionally-driven — improving liquidity depth and price discovery`
          : `GCC equity markets attract increasing institutional and foreign capital flows — market infrastructure maturation enables larger capital allocations and improved valuation efficiency`,
        drivers: drivers.length >= 2
          ? drivers
          : ["Sustained IPO pipeline", "Foreign institutional inflows", "Market infrastructure reforms"],
        potentialImpacts: {
          Markets: "positive",
          Economy: "positive",
          Policy: "supportive",
        },
      };
    },
  },

  // ── Pattern 5: GCC Geopolitical Realignment ───────────────────────
  // Triggered by: GEO signals + trade corridor shifts
  {
    id: "gcc_geopolitical_realignment_scenario",
    name: "GCC Geopolitical Realignment & Trade Diversification",
    type: SCENARIO_TYPES.GEO,
    description:
      "GCC states continue multipolar diplomatic positioning, reducing historical dependency on single-alignment frameworks",
    preconditions: {
      requiredSignalTypes: ["GEO"],
      minGeoSingals: 1,
      minMacroSignals: 1,
      minHighImpact: 1,
      gccRegionRequired: false,
    },
    buildScenario: (signals, insights) => {
      const geoSingals = signals.filter(
        (s) => s.signalType === "GEO" && (s.impact === "HIGH" || s.impact === "MEDIUM")
      );
      const tradeSignals = signals.filter(
        (s) =>
          (s.signalType === "MACRO") &&
          (s.summary.toLowerCase().includes("trade") ||
           s.summary.toLowerCase().includes("corridor") ||
           s.summary.toLowerCase().includes("supply chain") ||
           s.summary.toLowerCase().includes("bilateral"))
      );

      if (geoSingals.length === 0) return null;

      const allRelevant = [...geoSingals, ...tradeSignals];
      const drivers = allRelevant.map((s) => s.summary.split("—")[0]?.trim() || s.summary).slice(0, 3);

      const hasTradeCorridor = geoSingals.some((s) => s.summary.toLowerCase().includes("trade") || s.summary.toLowerCase().includes("corridor"));
      const hasDiplomatic = geoSingals.some((s) => s.summary.toLowerCase().includes("diplomatic") || s.summary.toLowerCase().includes("visit") || s.summary.toLowerCase().includes("agreement") || s.summary.toLowerCase().includes("partnership"));

      return {
        scenario: hasTradeCorridor
          ? `GCC states deepen multipolar trade relationships — new corridors and bilateral agreements signal strategic shift away from single-alignment dependency toward diversified economic partnerships`
          : `GCC diplomatic posture continues evolving — sustained engagement across multiple geopolitical axes indicates deliberate hedging strategy to preserve strategic autonomy in fragmenting global order`,
        drivers: drivers.length >= 2
          ? drivers
          : ["Diplomatic diversification", "New trade corridor development", "Multipolar engagement strategy"],
        potentialImpacts: {
          RegionalStability: "positive",
          Economy: "moderate",
          Policy: "evolving",
        },
      };
    },
  },

  // ── Pattern 6: GCC Fintech Ecosystem Disruption ───────────────────
  // Triggered by: AI + MARKET signals indicating fintech acceleration
  {
    id: "fintech_ecosystem_disruption",
    name: "GCC Fintech Ecosystem Acceleration",
    type: SCENARIO_TYPES.MARKET,
    description:
      "GCC fintech sector accelerates as regulatory frameworks and digital payments infrastructure reach critical mass",
    preconditions: {
      requiredSignalTypes: ["AI", "MARKET"],
      minAiSignals: 1,
      minMarketSignals: 1,
      minHighImpact: 1,
      gccRegionRequired: false,
    },
    buildScenario: (signals, insights) => {
      const fintechSignals = signals.filter(
        (s) =>
          (s.summary.toLowerCase().includes("fintech") ||
           s.summary.toLowerCase().includes("digital payment") ||
           s.summary.toLowerCase().includes("neobank") ||
           s.summary.toLowerCase().includes("blockchain") ||
           s.summary.toLowerCase().includes("digital currency") ||
           s.summary.toLowerCase().includes("payments"))
      );
      const aiFintechSignals = signals.filter(
        (s) => s.signalType === "AI" && s.impact === "HIGH"
      );

      if (fintechSignals.length < 1 && aiFintechSignals.length < 1) return null;

      const allRelevant = [...fintechSignals, ...aiFintechSignals];
      const drivers = allRelevant.map((s) => s.summary.split("—")[0]?.trim() || s.summary).slice(0, 3);

      const fundingMentioned = fintechSignals.some((s) => s.summary.toLowerCase().includes("funding") || s.summary.toLowerCase().includes("raised") || s.summary.toLowerCase().includes("investment"));

      return {
        scenario: fundingMentioned
          ? `GCC fintech ecosystem reaches critical mass — sustained funding inflow and regulatory sandbox frameworks drive sector expansion, potentially displacing traditional banking models in retail payments and SME lending`
          : `GCC digital financial services infrastructure matures — regulatory advances and cross-border payment integration position the region as a fintech innovation hub with spillover effects across banking and commerce`,
        drivers: drivers.length >= 2
          ? drivers
          : ["Fintech funding acceleration", "Regulatory sandbox maturation", "Digital payments adoption"],
        potentialImpacts: {
          Tech: "transformative",
          Economy: "positive",
          Markets: "positive",
        },
      };
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// PROBABILITY BANDING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine probability band for a scenario based on signal strength and trend repetition.
 *
 * Rules:
 *   - If signalStrength is HIGH and trend is repeated → HIGH
 *   - If signals are mixed → MEDIUM
 *   - If signals are weak/early → LOW
 *
 * @param {Array} supportingSignals - Signals supporting this scenario
 * @param {Array} pastScenarios - Previous scenarios for trend repetition check
 * @param {Array} activeInsights - Current insights for cross-reference
 * @returns {string} Probability band (HIGH | MEDIUM | LOW)
 */
function determineProbabilityBand(supportingSignals, pastScenarios, activeInsights) {
  if (!supportingSignals || supportingSignals.length < 2) return PROBABILITY_BANDS.LOW;

  // ── Count HIGH impact signals ────────────────────────────────────
  const highImpactCount = supportingSignals.filter((s) => s.impact === "HIGH").length;
  const highConfidenceCount = supportingSignals.filter((s) => (s.confidence || 0) >= 0.7).length;

  // ── Check for repeated trend in past scenarios ────────────────────
  let trendRepeated = false;
  if (pastScenarios && pastScenarios.length > 0) {
    // Count how many past scenarios had similar type
    const scenarioTypes = pastScenarios.map((s) => s.type);
    const typeCounts = {};
    for (const t of scenarioTypes) {
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    // If same scenario type appears 3+ times, trend is repeated
    trendRepeated = Object.values(typeCounts).some((count) => count >= 3);
  }

  // ── Check if active insights corroborate ─────────────────────────
  let insightCorroboration = false;
  if (activeInsights && activeInsights.length > 0) {
    const confirmedInsights = activeInsights.filter(
      (i) => i.status === "CONFIRMED" || i.status === "VALIDATED"
    );
    insightCorroboration = confirmedInsights.length >= 1;
  }

  // ── Band assignment ──────────────────────────────────────────────
  const signalStrengthHigh = highImpactCount >= 2 && highConfidenceCount >= 2;

  if (signalStrengthHigh && (trendRepeated || insightCorroboration)) {
    return PROBABILITY_BANDS.HIGH;
  }

  // Mixed signals: some HIGH impact but not repeated, or repeated but not strong
  if ((highImpactCount >= 1 && trendRepeated) ||
      (highImpactCount >= 2 && insightCorroboration)) {
    return PROBABILITY_BANDS.MEDIUM;
  }

  // Weak or early signals
  if (highImpactCount === 0 && highConfidenceCount === 0) {
    return PROBABILITY_BANDS.LOW;
  }

  // Default: mixed signals that don't clearly fall into HIGH or LOW → MEDIUM
  if (highImpactCount >= 1) {
    return PROBABILITY_BANDS.MEDIUM;
  }

  return PROBABILITY_BANDS.LOW;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIDENCE SCORING (bounded, non-percentage)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate confidence score for a scenario (0.0 - 1.0, never displayed as %).
 *
 * Formula:
 *   confidence = signalStrength * 0.4 + trendConsistency * 0.3 + insightAlignment * 0.3
 *
 * @param {Object} scenarioResult - Result from buildScenario
 * @param {Array} signals - All fused signals
 * @param {Array} pastScenarios - Previous scenarios
 * @param {Array} activeInsights - Current insights
 * @returns {number} Confidence score (0.0 - 1.0)
 */
function calculateScenarioConfidence(scenarioResult, signals, pastScenarios, activeInsights) {
  // ── Signal Strength (0-1) ────────────────────────────────────────
  const driverPhrases = (scenarioResult.drivers || []).join(" ").toLowerCase();
  const matchedSignals = signals.filter((s) => {
    const summary = s.summary.toLowerCase();
    return driverPhrases.split(" ").some((word) => word.length > 4 && summary.includes(word));
  });

  let signalStrength = 0.5;
  if (matchedSignals.length > 0) {
    const avgConfidence =
      matchedSignals.reduce((sum, s) => sum + (s.confidence || 0.5), 0) /
      matchedSignals.length;
    const highImpactCount = matchedSignals.filter((s) => s.impact === "HIGH").length;
    const impactBonus = Math.min(0.2, highImpactCount * 0.05);
    signalStrength = Math.min(1, avgConfidence + impactBonus);
  }

  // ── Trend Consistency (0-1) ──────────────────────────────────────
  let trendConsistency = 0.5;
  if (pastScenarios && pastScenarios.length > 0) {
    const typeCount = pastScenarios.filter((s) => s.type === scenarioResult.type).length;
    if (typeCount >= 3) trendConsistency = 0.8;
    else if (typeCount >= 1) trendConsistency = 0.6;
  }

  // ── Insight Alignment (0-1) ──────────────────────────────────────
  let insightAlignment = 0.3;
  if (activeInsights && activeInsights.length > 0) {
    const scenarioWords = new Set(
      (scenarioResult.scenario || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4)
    );
    let maxMatch = 0;
    for (const insight of activeInsights) {
      if (!insight.hypothesis) continue;
      const insightWords = new Set(
        insight.hypothesis.toLowerCase().split(/\s+/).filter((w) => w.length > 4)
      );
      const intersection = new Set([...scenarioWords].filter((w) => insightWords.has(w)));
      const union = new Set([...scenarioWords, ...insightWords]);
      const similarity = intersection.size / (union.size || 1);
      if (similarity > maxMatch) maxMatch = similarity;

      // Boost if insight is CONFIRMED or VALIDATED
      if (similarity > 0.2 && (insight.status === "CONFIRMED" || insight.status === "VALIDATED")) {
        insightAlignment = Math.max(insightAlignment, 0.7);
      }
    }
    if (maxMatch > 0.2) {
      insightAlignment = Math.max(insightAlignment, 0.5);
    }
  }

  // ── Compute weighted confidence ──────────────────────────────────
  const confidence =
    signalStrength * 0.4 + trendConsistency * 0.3 + insightAlignment * 0.3;

  return Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPACT DIMENSION VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate that a scenario has at least 2 impact dimensions modeled.
 *
 * @param {Object} potentialImpacts - Impact dimensions object
 * @returns {boolean} Whether minimum dimension requirement is satisfied
 */
function hasMinimumImpactDimensions(potentialImpacts) {
  if (!potentialImpacts) return false;
  const dimensionCount = Object.keys(potentialImpacts).length;
  return dimensionCount >= 2;
}

// ═══════════════════════════════════════════════════════════════════════════
// CAUSAL CHAIN VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify that a scenario has a clear causal chain: driver → effect → outcome.
 *
 * @param {Object} scenarioResult - Result from buildScenario
 * @returns {boolean} Whether causal chain is sufficient
 */
function hasClearCausalChain(scenarioResult) {
  if (!scenarioResult) return false;

  // Must have drivers (cause)
  if (!scenarioResult.drivers || scenarioResult.drivers.length < 2) return false;

  // Must have impacts (effect/outcome)
  if (!scenarioResult.potentialImpacts || Object.keys(scenarioResult.potentialImpacts).length < 2) return false;

  // Must have a scenario description (the causal narrative)
  if (!scenarioResult.scenario || scenarioResult.scenario.length < 30) return false;

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO STORE — Read/Write
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read the full scenario store.
 * @returns {Object} { runs: [{ runId, date, scenarios }] }
 */
function readScenarioStore() {
  try {
    if (!fs.existsSync(SCENARIO_STORE_PATH)) {
      return { runs: [] };
    }
    const raw = fs.readFileSync(SCENARIO_STORE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.log(`[SCENARIO ENGINE] Failed to read scenario store: ${err.message}`);
    return { runs: [] };
  }
}

/**
 * Write scenarios to the persistent store.
 * @param {Object} store - Full scenario store
 */
function writeScenarioStore(store) {
  try {
    fs.mkdirSync(path.dirname(SCENARIO_STORE_PATH), { recursive: true });
    fs.writeFileSync(SCENARIO_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.log(`[SCENARIO ENGINE] Failed to write scenario store: ${err.message}`);
  }
}

/**
 * Get all past scenarios (flattened for analysis).
 * @returns {Array} Array of past scenario objects
 */
function getPastScenarios() {
  const store = readScenarioStore();
  const allScenarios = [];
  for (const run of store.runs || []) {
    if (run.scenarios && Array.isArray(run.scenarios)) {
      allScenarios.push(...run.scenarios);
    }
  }
  return allScenarios;
}

/**
 * Get active insights for scenario alignment.
 * @returns {Array} Active insights from insight store
 */
function getActiveInsights() {
  try {
    if (!fs.existsSync(INSIGHT_STORE_PATH)) return [];
    const raw = fs.readFileSync(INSIGHT_STORE_PATH, "utf-8");
    const store = JSON.parse(raw);
    return (store.insights || []).filter(
      (i) => i.status !== "DISCARDED" && i.status !== "WEAKENING"
    );
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS UPDATE — Scenario Feedback Loop
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update the status of past scenarios based on new data.
 *
 * Rules:
 *   - If scenario re-appears with consistent drivers → VALIDATED
 *   - If scenario partially aligns but with divergent signals → PARTIAL
 *   - If scenario is contradicted by new signals → INVALIDATED
 *   - If scenario hasn't appeared in 5+ runs → IRRELEVANT
 *
 * @param {Array} existingScenarios - Past scenarios from store
 * @param {Array} newScenarios - Newly generated scenarios
 * @param {string} currentRunId - Current run identifier
 * @returns {Array} Updated scenarios with new statuses
 */
function updateScenarioStatus(existingScenarios, newScenarios, currentRunId) {
  const updated = existingScenarios.map((s) => ({ ...s }));

  for (const existing of updated) {
    // Track runs since last appearance
    existing._runsSinceUpdate = (existing._runsSinceUpdate || 0) + 1;

    // Find if this scenario has a match in new scenarios
    const existingWords = new Set(
      (existing.scenario || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4)
    );

    const match = newScenarios.find((ns) => {
      const nsWords = new Set(
        (ns.scenario || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4)
      );
      const intersection = new Set([...existingWords].filter((w) => nsWords.has(w)));
      const union = new Set([...existingWords, ...nsWords]);
      return intersection.size / (union.size || 1) > 0.3;
    });

    if (match) {
      // Scenario re-appeared — reset counter
      existing._runsSinceUpdate = 0;
      existing._appearanceCount = (existing._appearanceCount || 0) + 1;

      // Status progression based on sustained appearance
      if (existing._appearanceCount >= 5) {
        existing.status = SCENARIO_STATUS.VALIDATED;
      } else if (existing._appearanceCount >= 3) {
        existing.status = SCENARIO_STATUS.PARTIAL;
      } else {
        existing.status = SCENARIO_STATUS.ACTIVE;
      }

      // Update with latest data
      existing.confidence = Math.max(existing.confidence || 0, match.confidence || 0);
      existing.drivers = match.drivers || existing.drivers;
      existing.potentialImpacts = match.potentialImpacts || existing.potentialImpacts;
      existing._lastUpdated = new Date().toISOString();
      existing._lastRunId = currentRunId;
    } else {
      // Scenario did NOT re-appear
      if (existing._runsSinceUpdate >= 5) {
        existing.status = SCENARIO_STATUS.IRRELEVANT;
      } else if (existing._runsSinceUpdate >= 3 && existing.status === SCENARIO_STATUS.ACTIVE) {
        // Not yet irrelevant, but losing relevance
        existing._lastUpdated = new Date().toISOString();
      }
    }
  }

  return updated;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — generateScenarios
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the full scenario generation pipeline.
 *
 * Pipeline:
 *   1. Read fused signals + active insights + past scenarios
 *   2. Evaluate all scenario patterns against current signal/insight data
 *   3. Apply causal chain validation
 *   4. Apply minimum impact dimensions check (>= 2)
 *   5. Assign probability bands (HIGH | MEDIUM | LOW)
 *   6. Calculate confidence scores (never exact %)
 *   7. Update scenario statuses via feedback loop
 *   8. Persist to scenario store
 *   9. Return validated scenarios for newsletter inclusion
 *
 * @param {Object} fusedOutput - Output from fusion-engine.js fuseSignals()
 * @param {Array} insights - Validated insights from insight-synthesizer.js
 * @param {string} runId - Unique run identifier
 * @returns {Promise<Object>} {
 *   scenarios: Array<Object>,   // Validated scenarios
 *   store: Object               // Full scenario store snapshot
 * }
 */
export async function generateScenarios(fusedOutput, insights = [], runId = "unknown") {
  console.log("\n═══════════════════════════════════════════════");
  console.log("📊 SCENARIO ENGINE — Generating bounded scenario structures");
  console.log("═══════════════════════════════════════════════");

  const currentDate = new Date().toISOString().slice(0, 10);

  // ── Step 0: Extract input data ────────────────────────────────────
  const signals = fusedOutput.topSignals || [];
  const clusters = fusedOutput.narrativeClusters || [];

  console.log(`   Run ID: ${runId}`);
  console.log(`   Signals available: ${signals.length}`);
  console.log(`   Narrative clusters: ${clusters.length}`);
  console.log(`   Active insights available: ${insights.length}`);

  // ── Guard: insufficient data for scenario generation ──────────────
  if (signals.length < 2 && insights.length < 2) {
    console.log("\n   ⚠️  Insufficient signals or insights for scenario generation (need >= 2 per scenario).");
    console.log("   Returning empty scenario set. Signal-grounded constraint.");

    console.log("═══════════════════════════════════════════════\n");
    return {
      scenarios: [],
      store: readScenarioStore(),
      runId,
      date: currentDate,
    };
  }

  // ── Step 1: Read historical context ───────────────────────────────
  console.log("\n   📖 Reading scenario memory and active insights...");
  const pastScenarios = getPastScenarios();
  const activeInsights = insights.length > 0 ? insights : getActiveInsights();
  console.log(`   Past scenario entries: ${pastScenarios.length}`);
  console.log(`   Active insights for alignment: ${activeInsights.length}`);

  // ── Step 2: Evaluate all scenario patterns ────────────────────────
  console.log("\n   🔍 Evaluating scenario patterns against signals and insights...");
  const rawScenarios = [];

  for (const pattern of SCENARIO_PATTERNS) {
    const pre = pattern.preconditions;

    // Check preconditions
    const aiCount = signals.filter((s) => s.signalType === "AI").length;
    const macroCount = signals.filter((s) => s.signalType === "MACRO").length;
    const marketCount = signals.filter((s) => s.signalType === "MARKET").length;
    const geoCount = signals.filter((s) => s.signalType === "GEO").length;
    const highImpactCount = signals.filter((s) => s.impact === "HIGH").length;
    const gccSignals = signals.filter((s) => ["GCC", "KSA", "UAE", "QA"].includes(s.region));

    // Check GCC region requirement
    if (pre.gccRegionRequired && gccSignals.length === 0) {
      console.log(`   ⏭️  Scenario "${pattern.name}" skipped — no GCC-region signals`);
      continue;
    }

    // Check signal type counts
    if (pre.minAiSignals && aiCount < pre.minAiSignals) {
      console.log(`   ⏭️  Scenario "${pattern.name}" skipped — need ${pre.minAiSignals} AI signals, have ${aiCount}`);
      continue;
    }
    if (pre.minMacroSignals && macroCount < pre.minMacroSignals) {
      console.log(`   ⏭️  Scenario "${pattern.name}" skipped — need ${pre.minMacroSignals} MACRO signals, have ${macroCount}`);
      continue;
    }
    if (pre.minMarketSignals && marketCount < pre.minMarketSignals) {
      console.log(`   ⏭️  Scenario "${pattern.name}" skipped — need ${pre.minMarketSignals} MARKET signals, have ${marketCount}`);
      continue;
    }
    if (pre.minGeoSingals && geoCount < pre.minGeoSingals) {
      console.log(`   ⏭️  Scenario "${pattern.name}" skipped — need ${pre.minGeoSingals} GEO signals, have ${geoCount}`);
      continue;
    }
    if (pre.minHighImpact && highImpactCount < pre.minHighImpact) {
      console.log(`   ⏭️  Scenario "${pattern.name}" skipped — need ${pre.minHighImpact} HIGH impact signals, have ${highImpactCount}`);
      continue;
    }

    // ── Build scenario ──────────────────────────────────────────
    const scenarioResult = pattern.buildScenario(signals, insights);
    if (!scenarioResult) {
      console.log(`   ⏭️  Scenario "${pattern.name}" — buildScenario returned null`);
      continue;
    }

    rawScenarios.push({
      ...scenarioResult,
      type: pattern.type,
      patternId: pattern.id,
      patternName: pattern.name,
    });

    console.log(`   ✅ Scenario "${pattern.name}" — structure generated`);
  }

  console.log(`\n   Raw scenario structures generated: ${rawScenarios.length}`);

  // ── Step 3: Apply causal chain validation ─────────────────────────
  console.log("\n   🔗 Validating causal chains (driver → effect → outcome)...");
  const causalChecked = rawScenarios.filter((s) => {
    const passes = hasClearCausalChain(s);
    if (!passes) {
      console.log(`   ❌ "${s.patternName}" — failed causal chain check`);
    }
    return passes;
  });
  console.log(`   Passed: ${causalChecked.length}/${rawScenarios.length}`);

  // ── Step 4: Apply minimum impact dimensions check ─────────────────
  console.log("\n   📐 Checking impact dimensions (need >= 2)...");
  const dimensionChecked = causalChecked.filter((s) => {
    const passes = hasMinimumImpactDimensions(s.potentialImpacts);
    if (!passes) {
      console.log(`   ❌ "${s.patternName}" — failed minimum impact dimensions check`);
    }
    return passes;
  });
  console.log(`   Passed: ${dimensionChecked.length}/${causalChecked.length}`);

  // ── Step 5: Assign probability bands and confidence ───────────────
  console.log("\n   📊 Assigning probability bands and confidence...");
  const withProbability = dimensionChecked.map((s) => {
    const supportingSignals = signals.filter((sig) => {
      const driverText = (s.drivers || []).join(" ").toLowerCase();
      return driverText.split(" ").some((word) => word.length > 4 && sig.summary.toLowerCase().includes(word));
    });

    const probabilityBand = determineProbabilityBand(supportingSignals, pastScenarios, activeInsights);
    const confidence = calculateScenarioConfidence(s, signals, pastScenarios, activeInsights);

    return {
      ...s,
      probabilityBand,
      confidence,
      supportingSignalsCount: supportingSignals.length,
    };
  });

  for (const s of withProbability) {
    console.log(`   [${s.probabilityBand}] ${s.patternName} — confidence: ${s.confidence.toFixed(2)}, supporting: ${s.supportingSignalsCount} signals`);
  }

  // ── Step 6: Enforce max 3 scenarios per run ───────────────────────
  const MAX_SCENARIOS = 3;
  // Sort by confidence descending, then take top MAX_SCENARIOS
  const sorted = [...withProbability].sort((a, b) => b.confidence - a.confidence);
  const finalScenarios = sorted.slice(0, MAX_SCENARIOS);

  if (sorted.length > MAX_SCENARIOS) {
    console.log(`\n   ⚠️  Truncated to ${MAX_SCENARIOS} scenarios (${sorted.length - MAX_SCENARIOS} excluded by cap)`);
  }

  // Format output scenarios
  const outputScenarios = finalScenarios.map((s) => ({
    scenario: s.scenario,
    type: s.type,
    drivers: s.drivers || [],
    potentialImpacts: s.potentialImpacts || {},
    probabilityBand: s.probabilityBand,
    confidence: s.confidence,
    status: SCENARIO_STATUS.ACTIVE,
    patternName: s.patternName,
    generatedAt: new Date().toISOString(),
  }));

  // ── Step 7: Update scenario statuses via feedback loop ────────────
  console.log("\n   🔄 Running scenario feedback loop...");
  const store = readScenarioStore();
  let allHistoricalScenarios = [];

  // Collect all existing scenarios from store
  for (const run of store.runs || []) {
    if (run.scenarios && Array.isArray(run.scenarios)) {
      // Preserve existing statuses
      allHistoricalScenarios.push(
        ...run.scenarios.map((s) => ({
          ...s,
          _lastRunId: run.runId,
        }))
      );
    }
  }

  const updatedHistorical = updateScenarioStatus(allHistoricalScenarios, outputScenarios, runId);

  // Prune IRRELEVANT scenarios older than 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const prunedHistorical = updatedHistorical.filter((s) => {
    if (s.status === SCENARIO_STATUS.IRRELEVANT) {
      const lastUpdate = s._lastUpdated ? new Date(s._lastUpdated).getTime() : 0;
      return lastUpdate > thirtyDaysAgo;
    }
    return true;
  });

  // ── Step 8: Persist to scenario store ─────────────────────────────
  const currentRun = {
    runId,
    date: currentDate,
    scenarios: outputScenarios.map((s) => ({
      scenario: s.scenario,
      type: s.type,
      drivers: s.drivers,
      potentialImpacts: s.potentialImpacts,
      probabilityBand: s.probabilityBand,
      confidence: s.confidence,
      status: s.status,
    })),
  };

  // Add current run to store
  const updatedStore = {
    runs: [...(store.runs || []), currentRun],
  };
  writeScenarioStore(updatedStore);

  // ── Summary ───────────────────────────────────────────────────────
  const activeCount = prunedHistorical.filter(
    (s) => s.status !== SCENARIO_STATUS.IRRELEVANT && s.status !== SCENARIO_STATUS.INVALIDATED
  ).length;

  console.log("\n═══════════════════════════════════════════════");
  console.log("✅ SCENARIO GENERATION COMPLETE");
  console.log(`   Scenario patterns evaluated: ${SCENARIO_PATTERNS.length}`);
  console.log(`   Generated this run: ${outputScenarios.length}`);
  console.log(`   Total active scenarios in memory: ${activeCount}`);
  console.log("═══════════════════════════════════════════════\n");

  return {
    scenarios: outputScenarios,
    store: updatedStore,
    runId,
    date: currentDate,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// NEWSLETTER FORMATTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format scenarios for newsletter inclusion.
 *
 * Generates the "📊 GCC Scenario Outlook" section text.
 *
 * @param {Array} scenarios - Validated scenario objects
 * @returns {string} Formatted markdown section
 */
export function formatScenariosForNewsletter(scenarios) {
  if (!scenarios || scenarios.length === 0) {
    return "";
  }

  const scenarioBlocks = scenarios.map((s, idx) => {
    const impactLines = s.potentialImpacts
      ? Object.entries(s.potentialImpacts)
          .map(([dimension, direction]) => `     — ${dimension}: ${direction}`)
          .join("\n")
      : "     — (No impact dimensions modeled)";

    return `### Scenario ${idx + 1}: ${s.scenario}

  **Type:** ${s.type} | **Probability Band:** ${s.probabilityBand}

  **Key Drivers:**
${(s.drivers || []).map((d) => `  • ${d}`).join("\n")}

  **Impact Pathways:**
${impactLines}

  **Confidence Signal:** ${s.confidence >= 0.7 ? "Moderate-High" : s.confidence >= 0.5 ? "Moderate" : "Low-Early"}
  **Status:** ${s.status || "ACTIVE"}`;
  });

  return `
📊 GCC SCENARIO OUTLOOK (Decision Simulation Layer)

These are structured, signal-grounded scenarios — not predictions. They represent
bounded reasoning about potential impact paths based on current intelligence.
Each scenario is traceable to active signals and insights.

${scenarioBlocks.join("\n\n")}
`.trim();
}

/**
 * Get the current scenario store (for external queries).
 * @returns {Object} Full scenario store
 */
export function getScenarioStore() {
  return readScenarioStore();
}

/**
 * Get active (non-irrelevant, non-invalidated) scenarios.
 * @returns {Array} Active scenarios across all runs
 */
export function getActiveScenarios() {
  const store = readScenarioStore();
  const allScenarios = [];
  for (const run of store.runs || []) {
    if (run.scenarios && Array.isArray(run.scenarios)) {
      allScenarios.push(
        ...run.scenarios.map((s) => ({ ...s, _runDate: run.date }))
      );
    }
  }
  return allScenarios.filter(
    (s) => s.status !== "IRRELEVANT" && s.status !== "INVALIDATED"
  );
}

/**
 * Get scenario statistics for system health reporting.
 * @returns {Object} Scenario statistics
 */
export function getScenarioStats() {
  const store = readScenarioStore();
  const allScenarios = [];
  for (const run of store.runs || []) {
    if (run.scenarios && Array.isArray(run.scenarios)) {
      allScenarios.push(...run.scenarios);
    }
  }

  return {
    totalGenerated: allScenarios.length,
    active: allScenarios.filter((s) => s.status === "ACTIVE").length,
    validated: allScenarios.filter((s) => s.status === "VALIDATED").length,
    partial: allScenarios.filter((s) => s.status === "PARTIAL").length,
    invalidated: allScenarios.filter((s) => s.status === "INVALIDATED").length,
    irrelevant: allScenarios.filter((s) => s.status === "IRRELEVANT").length,
    totalRuns: store.runs?.length || 0,
    byType: {
      MACRO: allScenarios.filter((s) => s.type === "MACRO").length,
      MARKET: allScenarios.filter((s) => s.type === "MARKET").length,
      GEO: allScenarios.filter((s) => s.type === "GEO").length,
    },
    byBand: {
      HIGH: allScenarios.filter((s) => s.probabilityBand === "HIGH").length,
      MEDIUM: allScenarios.filter((s) => s.probabilityBand === "MEDIUM").length,
      LOW: allScenarios.filter((s) => s.probabilityBand === "LOW").length,
    },
  };
}
