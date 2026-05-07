/**
 * fusion-engine.js — Signal Fusion Engine
 *
 * Merges signals from all four intelligence modules (macro, markets,
 * geopolitics, AI/tech) and produces a unified intelligence layer.
 *
 * Responsibilities:
 *   1. Merge signals from all modules
 *   2. Rank them by impact, confidence, and GCC relevance
 *   3. Cluster into narrative groups
 *   4. Generate story angles derived from signal clusters
 *   5. Produce GCC Intelligence Signals section for newsletter
 *
 * AGENT BARRIER INTEGRATION:
 *   macro-agent, gcc-agent, risk-agent, editor-agent all synchronize
 *   through agent-orchestrator.js barriers. Editor-agent never runs
 *   until all three signal agents are marked complete.
 *
 * Output:
 *   {
 *     topSignals: [],
 *     narrativeClusters: [],
 *     storyAngles: [],
 *     gccIntelligenceBrief: {}
 *   }
 *
 * @module fusion-engine
 */

import { normalizeSignals, applySignalWeight } from "./signal-normalizer.js";
import { generateMacroSignals } from "./signals/macro.js";
import { generateMarketSignals } from "./signals/markets.js";
import { generateGeopoliticalSignals } from "./signals/geopolitics.js";
import { generateAITechSignals } from "./signals/ai_tech.js";
import { runEditorialReview } from "./editorial-strategist.js";
import {
  markAgentComplete,
  waitUntilAllAgentsComplete,
  verifyAgentCompletion,
} from "./agent-orchestrator.js";
import { emitEvent } from "./event-emitter.js";

// ── IMPACT WEIGHT MAP ───────────────────────────────────────────────────
// Numeric weight for ranking purposes
const IMPACT_WEIGHTS = { HIGH: 3, MEDIUM: 2, LOW: 1 };

// ── NARRATIVE CLUSTER DEFINITIONS ───────────────────────────────────────
// Each cluster groups signals by thematic area and generates
// a unified narrative summary.

const NARRATIVE_CLUSTERS = [
  {
    id: "energy_macro",
    name: "Energy & Macro Environment",
    description: "Oil prices, GCC fiscal policy, interest rates, and macroeconomic trends",
    signalTypes: ["MACRO"],
    priority: 1,
  },
  {
    id: "market_movements",
    name: "Capital Markets & Equity Flows",
    description: "GCC stock indices, IPO activity, institutional flows, and sector performance",
    signalTypes: ["MARKET"],
    priority: 2,
  },
  {
    id: "geopolitical_risk",
    name: "Geopolitics & Trade Dynamics",
    description: "Diplomatic developments, trade corridors, security risks, and OPEC strategy",
    signalTypes: ["GEO"],
    priority: 3,
  },
  {
    id: "digital_transformation",
    name: "AI, Tech & Digital Transformation",
    description: "AI investment, cloud adoption, fintech, cybersecurity, and innovation policy",
    signalTypes: ["AI"],
    priority: 4,
  },
];

// ── FUSION SCORE ─────────────────────────────────────────────────────────

/**
 * Calculate a fusion score for a single signal.
 *
 * Formula:
 *   fusionScore = (impactWeight * 3) + (confidence * 5) + (gccBonus ? 2 : 0)
 *
 * Where:
 *   - impactWeight: 3 (HIGH), 2 (MEDIUM), 1 (LOW)
 *   - confidence: 0–1 (multiplied by 5)
 *   - gccBonus: +2 if region is GCC (broadest relevance)
 *
 * Max possible score: 10
 *   (HIGH=3 * scaling) + (confidence=1.0 * 5) + (GCC bonus=2)
 *
 * @param {Object} signal - Normalized signal
 * @returns {number} Fusion score (0–10)
 */
function calculateFusionScore(signal) {
  const impactWeight = IMPACT_WEIGHTS[signal.impact] || 1;
  const gccBonus = signal.region === "GCC" ? 2 : 0;
  const confidenceScore = signal.confidence * 5;

  return Math.round((impactWeight + confidenceScore + gccBonus) * 10) / 10;
}

// ── NARRATIVE CLUSTERING ────────────────────────────────────────────────

/**
 * Cluster signals into narrative groups.
 *
 * @param {Array<Object>} signals - Array of normalized signals
 * @returns {Array<Object>} Array of cluster objects with their signals
 */
function clusterSignals(signals) {
  return NARRATIVE_CLUSTERS.map((cluster) => {
    const clusterSignals = signals.filter((s) =>
      cluster.signalTypes.includes(s.signalType)
    );

    // Calculate cluster strength (average fusion score of top 3 signals)
    const sorted = [...clusterSignals].sort(
      (a, b) => calculateFusionScore(b) - calculateFusionScore(a)
    );
    const topInCluster = sorted.slice(0, 3);
    const avgStrength =
      topInCluster.length > 0
        ? Math.round(
            (topInCluster.reduce((sum, s) => sum + calculateFusionScore(s), 0) /
              topInCluster.length) *
              10
          ) / 10
        : 0;

    // Generate cluster narrative summary
    const narrativeSummary = topInCluster
      .map((s) => s.summary)
      .join(" | ");

    return {
      id: cluster.id,
      name: cluster.name,
      description: cluster.description,
      priority: cluster.priority,
      signalCount: clusterSignals.length,
      activeSignals: topInCluster,
      strength: avgStrength,
      narrativeSummary: narrativeSummary
        ? narrativeSummary.slice(0, 500)
        : "No active signals in this cluster.",
    };
  });
}

// ── STORY ANGLE GENERATION ──────────────────────────────────────────────

/**
 * Generate story angles from the fused intelligence layer.
 *
 * Each story angle is a narrative hook derived from signal clusters,
 * designed for newsletter section creation.
 *
 * @param {Array<Object>} topSignals - Top-ranked signals
 * @param {Array<Object>} clusters - Narrative clusters
 * @returns {Array<Object>} Story angles with angle, rationale, and supporting signals
 */
function generateStoryAngles(topSignals, clusters) {
  const angles = [];

  // Angle 1: Top signal dominance
  if (topSignals.length >= 2) {
    angles.push({
      angle: `${topSignals[0].signalType} Dominance: ${topSignals[0].summary.slice(0, 60)}...`,
      rationale: "Highest fusion score — primary market driver this cycle",
      supportingSignals: topSignals.slice(0, 2).map((s) => s.summary),
      strength: calculateFusionScore(topSignals[0]),
    });
  }

  // Angle 2: Cross-cluster convergence
  const activeClusters = clusters.filter((c) => c.activeSignals.length >= 2);
  if (activeClusters.length >= 2) {
    const clusterNames = activeClusters.slice(0, 2).map((c) => c.name);
    angles.push({
      angle: `Cross-Cluster Signal: ${clusterNames.join(" + ")}`,
      rationale: "Multiple intelligence domains converging — systemic theme emerging",
      supportingSignals: activeClusters
        .slice(0, 2)
        .flatMap((c) => c.activeSignals.map((s) => s.summary)),
      strength: Math.round(
        activeClusters.reduce((sum, c) => sum + c.strength, 0) /
          activeClusters.length *
          10
      ) / 10,
    });
  }

  // Angle 3: GCC-centric power move
  const gccSignals = topSignals.filter((s) => s.region === "GCC" && s.impact === "HIGH");
  if (gccSignals.length >= 2) {
    const weightedSignals = gccSignals.map((s) => {
      const { weight } = applySignalWeight(s);
      return { ...s, weight };
    });
    const topWeighted = weightedSignals.sort((a, b) => b.weight - a.weight)[0];
    angles.push({
      angle: `GCC Strategic Read: ${topWeighted.summary.slice(0, 60)}...`,
      rationale: "HIGH impact GCC-wide signal with 1.5x weighting — sovereign-level implication",
      supportingSignals: gccSignals.map((s) => s.summary),
      strength: 10.0, // GCC-weighted signals get max narrative strength
    });
  }

  // Angle 4: Emerging risk vector
  const riskSignals = topSignals.filter(
    (s) => s.signalType === "GEO"
  );
  if (riskSignals.length >= 1) {
    angles.push({
      angle: `Risk Vector: ${riskSignals[0].summary.slice(0, 60)}...`,
      rationale: "Geopolitical or trade signal with regional stability implications",
      supportingSignals: riskSignals.slice(0, 2).map((s) => s.summary),
      strength: riskSignals.length >= 2 ? 8.5 : 7.0,
    });
  }

  // Sort by strength descending
  angles.sort((a, b) => b.strength - a.strength);

  return angles;
}

// ── GCC INTELLIGENCE BRIEF ──────────────────────────────────────────────

/**
 * Build the GCC Intelligence Signals section for the newsletter.
 *
 * Structure:
 *   🔎 GCC Intelligence Signals
 *   - Top macro driver
 *   - Top market movement
 *   - Top geopolitical shift
 *   - Top AI/tech catalyst
 *
 * @param {Array<Object>} topSignals - Ranked signals
 * @returns {Object} The intelligence brief section
 */
function buildIntelligenceBrief(topSignals) {
  const getTopInCategory = (signalType) => {
    const filtered = topSignals.filter((s) => s.signalType === signalType);
    return filtered.length > 0 ? filtered[0] : null;
  };

  return {
    macro: getTopInCategory("MACRO"),
    market: getTopInCategory("MARKET"),
    geo: getTopInCategory("GEO"),
    ai: getTopInCategory("AI"),
  };
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────

/**
 * Run the full signal fusion pipeline with editorial gatekeeping.
 *
 * Pipeline with AGENT BARRIER:
 *   1. macro-agent → run macro signals → mark "macro" complete
 *   2. gcc-agent   → run market signals → mark "gcc" complete
 *   3. risk-agent  → run geopolitical signals → mark "risk" complete
 *   4. BARRIER: waitUntilAllAgentsComplete(["macro","gcc","risk"])
 *   5. editor-agent → editorial review + fusion ranking + intelligence brief
 *                   → mark "editor" complete
 *   6. Emit AGENT_BATCH_COMPLETE
 *
 * @param {string} currentDate - ISO date string (YYYY-MM-DD)
 * @param {Object} [editorialFrame] - Optional editorial frame from editor.js
 * @param {Object} ctx - ExecutionContext (ONLY source of identity)
 * @returns {Promise<Object>} Fused intelligence output
 */
export async function fuseSignals(currentDate, editorialFrame = null, ctx = { runId: "unknown" }) {
  const runId = ctx.runId;

  console.log("\n═══════════════════════════════════════════════");
  console.log("🧠 SIGNAL FUSION ENGINE (Agent-Synchronized)");
  console.log(`   Run ID: ${runId}`);
  console.log("═══════════════════════════════════════════════");

  // ═══════════════════════════════════════════════════════════════════════
  // AGENT 1: macro-agent → Generate MACRO signals → mark complete
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n   [AGENT:macro] 📊 Generating MACRO signals...");
  const macroSignals = generateMacroSignals(currentDate, editorialFrame);
  console.log(`   [AGENT:macro] ✅ Generated ${macroSignals.length} macro signals`);
  markAgentComplete("macro", ctx);

  // ═══════════════════════════════════════════════════════════════════════
  // AGENT 2: gcc-agent → Generate MARKET + AI/TECH signals → mark complete
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n   [AGENT:gcc] 📈 Generating MARKET signals...");
  const marketSignals = generateMarketSignals(currentDate, editorialFrame);
  console.log(`   [AGENT:gcc] 🤖 Generating AI/TECH signals...`);
  const aiSignals = generateAITechSignals(currentDate, editorialFrame);
  console.log(`   [AGENT:gcc] ✅ Generated ${marketSignals.length} market + ${aiSignals.length} AI signals`);
  markAgentComplete("gcc", ctx);

  // ═══════════════════════════════════════════════════════════════════════
  // AGENT 3: risk-agent → Generate GEOPOLITICAL signals → mark complete
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n   [AGENT:risk] 🌐 Generating GEOPOLITICAL signals...");
  const geoSignals = generateGeopoliticalSignals(currentDate, editorialFrame);
  console.log(`   [AGENT:risk] ✅ Generated ${geoSignals.length} geopolitical signals`);
  markAgentComplete("risk", ctx);

  // ═══════════════════════════════════════════════════════════════════════
  // AGENT BARRIER: wait for macro + gcc + risk to all be complete
  // editor-agent NEVER runs before this barrier passes
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n   [BARRIER] Waiting for all signal agents to complete...");
  const barrierPassed = await waitUntilAllAgentsComplete(
    ["macro", "gcc", "risk"],
    ctx
  );

  if (!barrierPassed) {
    console.error("\n   ❌ [BARRIER] FAILED — agent timeout. Exiting fusion pipeline.");
    console.error(`   ❌ [BARRIER] Run ID: ${runId}`);
    throw new Error(`Agent barrier timeout: macro/gcc/risk did not all complete within timeout`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AGENT 4: editor-agent → Normalize + editorial gate + fusion
  // Runs ONLY after barrier confirms all 3 signal agents are complete
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n   [AGENT:editor] 🔄 Running editorial gate (barrier passed)...");

  // ── Step 1: Merge all raw signals ─────────────────────────────
  const allRawSignals = [...macroSignals, ...marketSignals, ...geoSignals, ...aiSignals];
  console.log(`   [AGENT:editor] ✅ ${allRawSignals.length} total raw signals merged`);

  // ── Step 2: Normalize and filter ──────────────────────────────
  console.log("\n   [AGENT:editor] 🔄 Normalizing and filtering signals...");
  const { normalized, rejected, stats } = normalizeSignals(allRawSignals, {
    applyGCCFilter: true,
  });

  console.log(`   [AGENT:editor] ✅ ${stats.valid} valid signals passed filter`);
  console.log(`   [AGENT:editor] ❌ ${stats.filtered} filtered (GCC filter)`);
  console.log(`   [AGENT:editor] ⚠️  ${stats.invalid} invalid schema`);

  // ── Step 3: EDITORIAL REVIEW (Gatekeeper) ─────────────────────
  console.log("\n   [AGENT:editor] 📋 Running editorial review gate...");
  const { approved: editoriallyApproved, editorialSummary } = runEditorialReview(
    normalized,
    runId
  );

  console.log(`   [AGENT:editor] ✅ ${editorialSummary.included} signals APPROVED for fusion`);
  console.log(`   [AGENT:editor] ❌ ${editorialSummary.excluded} EXCLUDED`);
  console.log(`   [AGENT:editor] ⏭️  ${editorialSummary.deferred} DEFERRED`);

  // ── Guard: if no signals survive editorial review ──────────────
  if (editoriallyApproved.length === 0) {
    console.log("\n   ⚠️  No signals passed editorial review — returning empty fusion.");

    const emptyFused = {
      fusedAt: new Date().toISOString(),
      dateContext: currentDate,
      runId,
      stats: {
        totalRaw: allRawSignals.length,
        validNormalized: stats.valid,
        gccFiltered: stats.filtered,
        invalidDropped: stats.invalid,
        editoriallyApproved: 0,
        editoriallyExcluded: editorialSummary.excluded,
        editoriallyDeferred: editorialSummary.deferred,
        topSignalsCount: 0,
        clustersCount: 0,
        storyAnglesCount: 0,
      },
      topSignals: [],
      narrativeClusters: [],
      storyAngles: [],
      gccIntelligenceBrief: { macro: null, market: null, geo: null, ai: null },
      editorialSummary,
    };

    // Mark editor complete even for empty results
    markAgentComplete("editor", ctx);

    console.log("\n═══════════════════════════════════════════════");
    console.log("✅ SIGNAL FUSION COMPLETE (empty — editorial filter)");
    console.log(`   Run ID: ${runId}`);
    console.log("═══════════════════════════════════════════════\n");

    return emptyFused;
  }

  // ── Step 4: Rank approved signals by fusion score ─────────────
  console.log("\n   [AGENT:editor] 📊 Ranking editorially approved signals by fusion score...");
  const rankedSignals = editoriallyApproved
    .map((signal) => ({
      ...signal,
      fusionScore: calculateFusionScore(signal),
      weight: applySignalWeight(signal).weight,
    }))
    .sort((a, b) => b.fusionScore - a.fusionScore);

  const topSignals = rankedSignals.slice(0, 8);

  // ── Step 5: Cluster into narratives ───────────────────────────
  console.log("   [AGENT:editor] 🔗 Clustering approved signals into narrative groups...");
  const narrativeClusters = clusterSignals(rankedSignals);

  // ── Step 6: Generate story angles ─────────────────────────────
  console.log("   [AGENT:editor] 🎯 Generating story angles from approved signals...");
  const storyAngles = generateStoryAngles(topSignals, narrativeClusters);

  // ── Step 7: Build intelligence brief ──────────────────────────
  console.log("   [AGENT:editor] 📋 Building GCC Intelligence Signals brief...");
  const gccIntelligenceBrief = buildIntelligenceBrief(topSignals);

  // ── Compile output ───────────────────────────────────────────
  const fused = {
    fusedAt: new Date().toISOString(),
    dateContext: currentDate,
    runId,
    stats: {
      totalRaw: allRawSignals.length,
      validNormalized: stats.valid,
      gccFiltered: stats.filtered,
      invalidDropped: stats.invalid,
      editoriallyApproved: editorialSummary.included,
      editoriallyExcluded: editorialSummary.excluded,
      editoriallyDeferred: editorialSummary.deferred,
      topSignalsCount: topSignals.length,
      clustersCount: narrativeClusters.filter((c) => c.signalCount > 0).length,
      storyAnglesCount: storyAngles.length,
    },
    topSignals: topSignals.map(({ fusionScore, weight, ...signal }) => ({
      ...signal,
      fusionScore,
      weight,
    })),
    narrativeClusters: narrativeClusters.filter((c) => c.signalCount > 0),
    storyAngles,
    gccIntelligenceBrief,
    editorialSummary,
  };

  // ── Step 8: Mark editor agent complete ───────────────────────
  markAgentComplete("editor", ctx);

  // ── Step 9: Verify ALL agents completed ──────────────────────
  const allComplete = verifyAgentCompletion(runId, ["macro", "gcc", "risk", "editor"]);
  if (!allComplete) {
    console.warn(`   ⚠️  [AGENT:editor] Agent completion verification WARNING — some agents not marked complete`);
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log("✅ SIGNAL FUSION COMPLETE (Agent-Synchronized)");
  console.log(`   Run ID:             ${runId}`);
  console.log(`   All agents done:    ${allComplete}`);
  console.log(`   Editorially approved: ${editorialSummary.included}/${stats.valid}`);
  console.log(`   Top signals:        ${fused.stats.topSignalsCount}`);
  console.log(`   Active clusters:    ${fused.stats.clustersCount}`);
  console.log(`   Story angles:       ${fused.stats.storyAnglesCount}`);
  console.log("═══════════════════════════════════════════════\n");

  return fused;
}

/**
 * Format the fused intelligence output as a prompt injection block
 * for DeepSeek. This becomes the factual backbone of newsletter generation.
 *
 * @param {Object} fusedOutput - Output of fuseSignals()
 * @returns {string} Formatted signal context block
 */
export function formatSignalContext(fusedOutput) {
  if (!fusedOutput || !fusedOutput.topSignals || fusedOutput.topSignals.length === 0) {
    return "";
  }

  const formatSignalList = (signals) => {
    return signals
      .map(
        (s, i) =>
          `  ${i + 1}. [${s.impact}/${s.confidence.toFixed(2)}] ${s.region} — ${s.summary} (Source: ${s.source})`
      )
      .join("\n");
  };

  const macroSignals = fusedOutput.topSignals.filter((s) => s.signalType === "MACRO");
  const marketSignals = fusedOutput.topSignals.filter((s) => s.signalType === "MARKET");
  const geoSymbols = fusedOutput.topSignals.filter((s) => s.signalType === "GEO");
  const aiSignals = fusedOutput.topSignals.filter((s) => s.signalType === "AI");

  const storyAngles = (fusedOutput.storyAngles || [])
    .map((a, i) => `  ${i + 1}. [${a.strength.toFixed(1)}] ${a.angle}`)
    .join("\n");

  // Build the intelligence brief
  const brief = fusedOutput.gccIntelligenceBrief || {};
  const briefLines = [];
  if (brief.macro) briefLines.push(`   🏭 Top macro driver: ${brief.macro.summary}`);
  if (brief.market) briefLines.push(`   📈 Top market movement: ${brief.market.summary}`);
  if (brief.geo) briefLines.push(`   🌐 Top geopolitical shift: ${brief.geo.summary}`);
  if (brief.ai) briefLines.push(`   🤖 Top AI/tech catalyst: ${brief.ai.summary}`);

  return `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ 🧠 GCC INTELLIGENCE SIGNALS — Factual Backbone
┃ Generated: ${fusedOutput.fusedAt}
┃ Run ID: ${fusedOutput.runId || "N/A"}
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃
┃ 🔎 GCC INTELLIGENCE BRIEF (must appear as newsletter section):
${briefLines.map((l) => `┃ ${l}`).join("\n")}
┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ SIGNAL CONTEXT:
┃
┃ TOP MACRO SIGNALS:
${macroSignals.length > 0 ? formatSignalList(macroSignals) : "  (none)"}
┃
┃ TOP MARKET SIGNALS:
${marketSignals.length > 0 ? formatSignalList(marketSignals) : "  (none)"}
┃
┃ TOP GEOPOLITICAL SIGNALS:
${geoSymbols.length > 0 ? formatSignalList(geoSymbols) : "  (none)"}
┃
┃ TOP AI/TECH SIGNALS:
${aiSignals.length > 0 ? formatSignalList(aiSignals) : "  (none)"}
┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ NARRATIVE STORY ANGLES (derived from fused signals):
${storyAngles || "  (none)"}
┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSTRUCTIONS:
Generate the newsletter using ONLY these signals as the factual backbone.
Each newsletter section MUST be traceable to at least one signal above.
The "🔎 GCC Intelligence Signals" section MUST appear FIRST in the newsletter,
before all other sections, as the foundation layer of all narratives.
Follow the narrative order and priority ranking from the editorial frame.
`.trim();
}
