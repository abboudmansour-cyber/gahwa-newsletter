/**
 * prompt-format-enforcer.js — Gahwa Atomic Execution Standard Enforcer v2.0
 *
 * Validates that a Cline prompt follows the full 10-section Gahwa Atomic
 * Execution Standard BEFORE it is executed. If the prompt lacks required
 * sections, the enforcer rejects it and returns a structured error report.
 *
 * Sections Validated:
 *   0. HEADER (MANDATORY)             — SYSTEM/MODE/STRICT MODE/NO PARTIAL IMPLEMENTATION
 *   1. OBJECTIVE (NO AMBIGUITY)       — Concrete goal, no vague wording
 *   2. REQUIRED ARTIFACTS              — Files, functions, logs, broken hooks
 *   3. IMPLEMENTATION BOUNDARIES       — Hard constraints
 *   4. IMPLEMENTATION TASKS (STEP LIST) — Deterministic step list
 *   5. VALIDATION LAYER                — CHECK block
 *   6. COMPLETENESS REPORT             — JSON schema
 *   7. AUTO-RECOVERY RULE              — Retry mode spec
 *   8. DIFF GUARANTEE                  — Output requirement
 *   9. FINAL SYSTEM BEHAVIOR CONTRACT  — Traceability contract
 *
 * Validation Levels:
 *   - STRICT: All 10 sections required, artifacts must be non-empty
 *   - NORMAL: All 10 sections required, artifacts may be empty
 *   - LENIENT: Sections 0+1+2+5+6 required, others optional
 *
 * @module prompt-format-enforcer
 */

// ── Gahwa Atomic Execution Standard v2.0 Section Detection ──────────────────
// Each section supports multiple heading patterns:
//   - "⚡ 0. HEADER (MANDATORY)"
//   - "# 0. HEADER"
//   - "HEADER (MANDATORY)"
//   - "## HEADER"

const SECTION_PATTERNS = {
  HEADER: [
    /#+\s*.*?0\.?\s*HEADER/i,
    /HEADER\s*\(MANDATORY\)/i,
    /SYSTEM:\s*Gahwa\s*Operator/i,
    /MODE:\s*Atomic\s*Execution/i,
    /STRICT\s+MODE:\s*ON/i,
    /NO\s+PARTIAL\s+IMPLEMENTATION:\s*TRUE/i,
  ],
  OBJECTIVE: [
    /#+\s*.*?1\.?\s*OBJECTIVE/i,
    /#+\s*OBJECTIVE\s*\(NO\s+AMBIGUITY\)/i,
    /##\s*OBJECTIVE/i,
    /OBJECTIVE\s*\(NO\s+AMBIGUITY\)/,
  ],
  REQUIRED_ARTIFACTS: [
    /#+\s*.*?2\.?\s*REQUIRED\s+ARTIFACTS/i,
    /#+\s*REQUIRED\s+ARTIFACTS/i,
    /##\s*REQUIRED\s+ARTIFACTS/i,
    /REQUIRED\s+ARTIFACTS\s*\(THE\s+CONTRACT\)/,
    /FILES\s+REQUIRED:/,
  ],
  IMPLEMENTATION_BOUNDARIES: [
    /#+\s*.*?3\.?\s*IMPLEMENTATION\s+BOUNDARIES/i,
    /#+\s*IMPLEMENTATION\s+BOUNDARIES/i,
    /##\s*IMPLEMENTATION\s+BOUNDARIES/i,
  ],
  IMPLEMENTATION_TASKS: [
    /#+\s*.*?4\.?\s*IMPLEMENTATION\s+TASKS/i,
    /#+\s*IMPLEMENTATION\s+TASKS/i,
    /##\s*IMPLEMENTATION\s+TASKS/i,
    /IMPLEMENTATION\s+TASKS\s*\(STEP\s+LIST\)/,
    /STEP\s+LIST/i,
  ],
  VALIDATION_LAYER: [
    /#+\s*.*?5\.?\s*VALIDATION\s+LAYER/i,
    /#+\s*VALIDATION\s+LAYER/i,
    /##\s*VALIDATION\s+LAYER/i,
    /VALIDATION\s+LAYER\s*\(NON-NEGOTIABLE\)/,
    /CHECK:/,
  ],
  COMPLETENESS_REPORT: [
    /#+\s*.*?6\.?\s*COMPLETENESS\s+REPORT/i,
    /#+\s*COMPLETENESS\s+REPORT/i,
    /##\s*COMPLETENESS\s+REPORT/i,
    /COMPLETENESS\s+REPORT\s*\(FORCED\s+OUTPUT\)/,
  ],
  AUTO_RECOVERY: [
    /#+\s*.*?7\.?\s*AUTO-RECOVERY/i,
    /#+\s*AUTO-RECOVERY\s+RULE/i,
    /##\s*AUTO-RECOVERY/i,
    /AUTO-RECOVERY\s+RULE/,
    /RETRY\s+MODE:/,
  ],
  DIFF_GUARANTEE: [
    /#+\s*.*?8\.?\s*DIFF\s+GUARANTEE/i,
    /#+\s*DIFF\s+GUARANTEE/i,
    /##\s*DIFF\s+GUARANTEE/i,
    /DIFF\s+GUARANTEE\s*\(NEW\s+CRITICAL\s+LAYER\)/,
    /OUTPUT\s+REQUIREMENT:/,
  ],
  BEHAVIOR_CONTRACT: [
    /#+\s*.*?9\.?\s*FINAL\s+SYSTEM\s+BEHAVIOR/i,
    /#+\s*FINAL\s+SYSTEM\s+BEHAVIOR\s+CONTRACT/i,
    /##\s*FINAL\s+SYSTEM\s+BEHAVIOR/i,
    /FINAL\s+SYSTEM\s+BEHAVIOR\s+CONTRACT/,
    /every\s+feature\s+must\s+map\s+to\s+a\s+file/i,
  ],
};

// ── Artifact Detection Patterns ────────────────────────────────────────────────

const ARTIFACT_PATTERNS = {
  files: [
    /FILES\s+REQUIRED:/i,
    /FILES?:/i,
    /file\s*creation/i,
    /expected\s*files/i,
  ],
  functions: [
    /FUNCTIONS\s+REQUIRED:/i,
    /FUNCTIONS?:/i,
    /function\s*definition/i,
    /expected\s*functions/i,
  ],
  logs: [
    /LOGS\s+REQUIRED:/i,
    /LOGS?:/i,
    /log\s*artifact/i,
    /expected\s*logs/i,
  ],
  behaviors: [
    /BEHAVIOR:/i,
    /behavioral/i,
    /expected\s*behaviors/i,
  ],
  brokenHooks: [
    /BROKEN\s+HOOKS/i,
    /hooks?\s+check/i,
    /hook\s+integration/i,
  ],
};

const RULE_PATTERNS = {
  noRefactoring: [/no\s*refactoring/i, /do\s*not\s*modify\s*existing\s*architecture/i],
  noRemove: [/no\s*removing/i, /do\s*not\s*remove/i, /no\s*delet/i],
  additiveOnly: [/only\s*additive/i, /additive\s*only/i, /only\s*extend/i],
  noDeps: [/no\s*new\s*(?:external\s*)?dependenc/i],
  noSigChange: [/no\s*modifying\s*(?:existing\s*)?function\s*signature/i],
  noRename: [/no\s*renaming/i],
  keepInterfaces: [/keep\s*interfaces?\s*unchanged/i],
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Validate that a prompt string follows the Gahwa Atomic Execution Standard v2.0.
 *
 * @param {string} promptText - The full prompt text to validate
 * @param {object} [options] - Validation options
 * @param {'STRICT'|'NORMAL'|'LENIENT'} [options.level='NORMAL'] - Validation strictness
 * @param {boolean} [options.allowEmptyArtifacts=false] - Allow empty artifact lists
 * @returns {object} Validation result
 */
export function enforcePromptFormat(promptText, options = {}) {
  const {
    level = 'NORMAL',
    allowEmptyArtifacts = false,
  } = options;

  if (!promptText || typeof promptText !== 'string') {
    return {
      valid: false,
      level,
      sections: {},
      errors: ['No prompt text provided'],
      warnings: [],
      score: 0,
      version: '2.0',
    };
  }

  console.log(`\n📐 [FORMAT-ENFORCER v2.0] Validating prompt structure (${level} mode)`);

  // ── Detect which sections are present ──────────────────────────────────
  const sections = detectSections(promptText);

  // ── Detect artifacts within the artifacts section ──────────────────────
  const artifacts = detectArtifacts(promptText);
  const rules = detectRules(promptText);

  // ── Build error and warning lists ──────────────────────────────────────
  const errors = [];
  const warnings = [];

  // Check required sections based on level
  const requiredSections = getRequiredSections(level);
  for (const section of requiredSections) {
    const sectionEntry = sections[section.key];
    if (!sectionEntry || !sectionEntry.found) {
      errors.push(`Missing required section: "${section.name}" — add section to the prompt`);
    }
  }

  // Check artifact completeness
  if (sections.REQUIRED_ARTIFACTS?.found) {
    if (!allowEmptyArtifacts) {
      if (!artifacts.files && !artifacts.functions && !artifacts.logs && !artifacts.behaviors) {
        warnings.push('REQUIRED ARTIFACTS section found but no specific artifact types detected (FILES REQUIRED, FUNCTIONS REQUIRED, LOGS REQUIRED, BROKEN HOOKS CHECK)');
      }
    }
  }

  // Check for artifact content
  if (artifacts.files && artifacts.files.length === 0) {
    warnings.push('FILES REQUIRED section found but no file paths listed');
  }
  if (artifacts.functions && artifacts.functions.length === 0) {
    warnings.push('FUNCTIONS REQUIRED section found but no function names listed');
  }

  // Check implementation boundaries
  if (!sections.IMPLEMENTATION_BOUNDARIES?.found && level === 'STRICT') {
    warnings.push('IMPLEMENTATION BOUNDARIES section missing — add it to prevent accidental refactoring');
  }

  // Check rules content
  if (sections.IMPLEMENTATION_BOUNDARIES?.found) {
    if (!rules.noRefactoring) {
      warnings.push('Consider adding "Do NOT modify existing architecture" rule');
    }
    if (!rules.additiveOnly) {
      warnings.push('Consider adding "Only extend current pipeline" rule');
    }
    if (!rules.noDeps) {
      warnings.push('Consider adding "Do NOT introduce new external services" rule');
    }
  }

  // Check validation layer has CHECK block
  if (sections.VALIDATION_LAYER?.found) {
    if (!promptText.includes('CHECK:')) {
      warnings.push('VALIDATION LAYER section found but missing "CHECK:" block with concrete verifications');
    }
  }

  // Check completeness report has JSON schema
  if (sections.COMPLETENESS_REPORT?.found) {
    if (!promptText.includes('"status"') && !promptText.includes("'status'")) {
      warnings.push('COMPLETENESS REPORT section found but missing JSON "status" field schema');
    }
    if (!promptText.includes('"brokenHooks"') && !promptText.includes("'brokenHooks'")) {
      warnings.push('COMPLETENESS REPORT section should include "brokenHooks" field for hook integrity tracking');
    }
  }

  // Check diff guarantee has output requirement
  if (sections.DIFF_GUARANTEE?.found) {
    if (!promptText.includes('OUTPUT REQUIREMENT')) {
      warnings.push('DIFF GUARANTEE section found but missing "OUTPUT REQUIREMENT:" block');
    }
  }

  // ── Calculate format score ────────────────────────────────────────────
  const score = calculateFormatScore(sections, artifacts, rules, errors, warnings);

  // ── Build result ──────────────────────────────────────────────────────
  const valid = errors.length === 0;
  const result = {
    valid,
    level,
    version: '2.0',
    score,
    sections: {
      HEADER: sections.HEADER?.found || false,
      OBJECTIVE: sections.OBJECTIVE?.found || false,
      REQUIRED_ARTIFACTS: sections.REQUIRED_ARTIFACTS?.found || false,
      IMPLEMENTATION_BOUNDARIES: sections.IMPLEMENTATION_BOUNDARIES?.found || false,
      IMPLEMENTATION_TASKS: sections.IMPLEMENTATION_TASKS?.found || false,
      VALIDATION_LAYER: sections.VALIDATION_LAYER?.found || false,
      COMPLETENESS_REPORT: sections.COMPLETENESS_REPORT?.found || false,
      AUTO_RECOVERY: sections.AUTO_RECOVERY?.found || false,
      DIFF_GUARANTEE: sections.DIFF_GUARANTEE?.found || false,
      BEHAVIOR_CONTRACT: sections.BEHAVIOR_CONTRACT?.found || false,
    },
    artifacts,
    rules,
    errors,
    warnings,
    verdict: valid ? 'PASS' : 'FAIL',
    instruction: valid
      ? 'Prompt format accepted — proceed with execution'
      : `Prompt format rejected — fix ${errors.length} error(s) before execution`,
  };

  printEnforcerReport(result);

  return result;
}

/**
 * Convenience wrapper: validate and throw if invalid.
 *
 * @param {string} promptText
 * @param {object} [options]
 * @throws {Error} If prompt format is invalid
 * @returns {object} Validation result
 */
export function enforceOrThrow(promptText, options = {}) {
  const result = enforcePromptFormat(promptText, options);
  if (!result.valid) {
    const errorMsg = `[FORMAT-ENFORCER v2.0] Prompt rejected: ${result.errors.join('; ')}`;
    console.error(`\n⛔ ${errorMsg}`);
    throw new Error(errorMsg);
  }
  return result;
}

/**
 * Get the format enforcer version.
 * @returns {string}
 */
export function getEnforcerVersion() {
  return '2.0.0';
}

// ── Internal Detection Logic ──────────────────────────────────────────────────

/**
 * Detect which sections are present in the prompt.
 */
function detectSections(text) {
  const found = {};

  for (const [sectionKey, patterns] of Object.entries(SECTION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        found[sectionKey] = {
          found: true,
          matchedBy: pattern.source,
        };
        break;
      }
    }
    if (!found[sectionKey]) {
      found[sectionKey] = { found: false, matchedBy: null };
    }
  }

  return found;
}

/**
 * Detect which artifact types are defined in the artifacts section.
 * Also attempts to extract specific file/function names.
 */
function detectArtifacts(text) {
  const result = {
    files: null,
    functions: null,
    logs: null,
    behaviors: null,
    brokenHooks: null,
  };

  // Detect artifact type presence
  for (const [type, patterns] of Object.entries(ARTIFACT_PATTERNS)) {
    result[type] = patterns.some((p) => p.test(text));
  }

  // Try to extract specific file paths (lines starting with - after FILES REQUIRED: header)
  const filesSection = extractListAfterHeader(text, /FILES\s+REQUIRED:/i);
  if (filesSection) {
    const filePaths = filesSection
      .map((l) => l.replace(/^-\s*/, '').trim())
      .filter((l) => l.length > 0 && (l.includes('/') || l.includes('.')));
    if (filePaths.length > 0) {
      result.filePaths = filePaths;
    }
  } else {
    // Fallback: try FILES:
    const filesSectionAlt = extractListAfterHeader(text, /FILES?:/i);
    if (filesSectionAlt) {
      const filePaths = filesSectionAlt
        .map((l) => l.replace(/^-\s*/, '').trim())
        .filter((l) => l.length > 0 && (l.includes('/') || l.includes('.')));
      if (filePaths.length > 0) {
        result.filePaths = filePaths;
      }
    }
  }

  // Try to extract specific function names
  const funcsSection = extractListAfterHeader(text, /FUNCTIONS\s+REQUIRED:/i);
  if (funcsSection) {
    const funcNames = funcsSection
      .map((l) => l.replace(/^-\s*/, '').replace(/\(\)$/, '').trim())
      .filter((l) => l.length > 0 && /^[a-zA-Z_$]/.test(l));
    if (funcNames.length > 0) {
      result.functionNames = funcNames;
    }
  } else {
    // Fallback: try FUNCTIONS:
    const funcsSectionAlt = extractListAfterHeader(text, /FUNCTIONS?:/i);
    if (funcsSectionAlt) {
      const funcNames = funcsSectionAlt
        .map((l) => l.replace(/^-\s*/, '').replace(/\(\)$/, '').trim())
        .filter((l) => l.length > 0 && /^[a-zA-Z_$]/.test(l));
      if (funcNames.length > 0) {
        result.functionNames = funcNames;
      }
    }
  }

  return result;
}

/**
 * Detect which implementation rules are present.
 */
function detectRules(text) {
  const result = {
    noRefactoring: false,
    noRemove: false,
    additiveOnly: false,
    noDeps: false,
    noSigChange: false,
    noRename: false,
    keepInterfaces: false,
  };

  for (const [ruleKey, patterns] of Object.entries(RULE_PATTERNS)) {
    result[ruleKey] = patterns.some((p) => p.test(text));
  }

  return result;
}

/**
 * Extract a bulleted list that follows a header pattern.
 */
function extractListAfterHeader(text, headerPattern) {
  const lines = text.split('\n');
  let inSection = false;
  const items = [];

  for (const line of lines) {
    if (headerPattern.test(line)) {
      inSection = true;
      continue;
    }

    if (inSection) {
      // Stop at next section header or empty line after content
      if (/^#{1,3}\s/.test(line) || /^[A-Z]+\s*\(/.test(line)) {
        break;
      }
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        items.push(line.trim());
      } else if (line.trim() === '' && items.length > 0) {
        // Empty line after collecting items — could be end
        continue;
      } else if (line.trim() !== '' && !line.trim().startsWith('-')) {
        // Non-bullet content after section — could still be part of it
        if (items.length > 0) break;
      }
    }
  }

  return items.length > 0 ? items : null;
}

/**
 * Get the set of required sections for a given validation level.
 * Returns an array of { key, name, numeral } objects.
 */
function getRequiredSections(level) {
  const allSections = [
    { key: 'HEADER',                name: '0. HEADER (MANDATORY)',                        numeral: '0' },
    { key: 'OBJECTIVE',             name: '1. OBJECTIVE (NO AMBIGUITY)',                   numeral: '1' },
    { key: 'REQUIRED_ARTIFACTS',    name: '2. REQUIRED ARTIFACTS (THE CONTRACT)',          numeral: '2' },
    { key: 'IMPLEMENTATION_BOUNDARIES', name: '3. IMPLEMENTATION BOUNDARIES',              numeral: '3' },
    { key: 'IMPLEMENTATION_TASKS',  name: '4. IMPLEMENTATION TASKS (STEP LIST)',          numeral: '4' },
    { key: 'VALIDATION_LAYER',      name: '5. VALIDATION LAYER (NON-NEGOTIABLE)',          numeral: '5' },
    { key: 'COMPLETENESS_REPORT',   name: '6. COMPLETENESS REPORT (FORCED OUTPUT)',        numeral: '6' },
    { key: 'AUTO_RECOVERY',         name: '7. AUTO-RECOVERY RULE',                        numeral: '7' },
    { key: 'DIFF_GUARANTEE',        name: '8. DIFF GUARANTEE (NEW CRITICAL LAYER)',        numeral: '8' },
    { key: 'BEHAVIOR_CONTRACT',     name: '9. FINAL SYSTEM BEHAVIOR CONTRACT',            numeral: '9' },
  ];

  switch (level) {
    case 'STRICT':
      return allSections;
    case 'NORMAL':
      return allSections;
    case 'LENIENT':
      return allSections.filter((s) =>
        ['HEADER', 'OBJECTIVE', 'REQUIRED_ARTIFACTS', 'VALIDATION_LAYER', 'COMPLETENESS_REPORT'].includes(s.key)
      );
    default:
      return allSections;
  }
}

/**
 * Calculate a percentage score for how well the prompt follows the atomic format.
 */
function calculateFormatScore(sections, artifacts, rules, errors, warnings) {
  let score = 0;
  const totalWeight = 100;

  // Section presence: 50% of score (5 points each for 10 sections)
  const sectionWeight = 50 / Object.keys(SECTION_PATTERNS).length;
  for (const [, section] of Object.entries(sections)) {
    if (section.found) score += sectionWeight;
  }

  // Artifact completeness: 20% of score
  const artifactWeight = 4;
  if (artifacts.files) score += artifactWeight;
  if (artifacts.functions) score += artifactWeight;
  if (artifacts.logs) score += artifactWeight;
  if (artifacts.behaviors) score += artifactWeight;
  if (artifacts.brokenHooks) score += artifactWeight;

  // Rules completeness: 15% of score
  const ruleWeight = 2;
  for (const [, found] of Object.entries(rules)) {
    if (found) score += ruleWeight;
  }

  // Deduct for errors
  score -= errors.length * 10;
  // Deduct for warnings
  score -= warnings.length * 2;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Print the enforcer report to console.
 */
function printEnforcerReport(result) {
  const icon = result.valid ? '✅' : '⛔';
  console.log(`\n╔══════════════════════════════════════════════════`);
  console.log(`║ ${icon} FORMAT ENFORCER REPORT v${result.version}`);
  console.log(`║ Level:   ${result.level}`);
  console.log(`║ Score:   ${result.score}/100`);
  console.log(`║ Verdict: ${result.verdict}`);
  console.log(`╚══════════════════════════════════════════════════\n`);

  console.log(`📋 Sections (Gahwa Atomic Execution Standard v2.0):`);
  for (const [section, found] of Object.entries(result.sections)) {
    const icon = found ? '✅' : '⬜';
    console.log(`   ${icon} ${formatSectionName(section)}`);
  }

  if (result.errors.length > 0) {
    console.log(`\n❌ ERRORS (${result.errors.length}):`);
    result.errors.forEach((e) => console.log(`   • ${e}`));
  }

  if (result.warnings.length > 0) {
    console.log(`\n⚠️  WARNINGS (${result.warnings.length}):`);
    result.warnings.forEach((w) => console.log(`   • ${w}`));
  }

  console.log(`\n📊 Verdict: ${result.verdict} — ${result.instruction}\n`);
}

/**
 * Convert section enum to human-readable name.
 */
function formatSectionName(key) {
  const names = {
    HEADER: '0. HEADER (MANDATORY)',
    OBJECTIVE: '1. OBJECTIVE (NO AMBIGUITY)',
    REQUIRED_ARTIFACTS: '2. REQUIRED ARTIFACTS (THE CONTRACT)',
    IMPLEMENTATION_BOUNDARIES: '3. IMPLEMENTATION BOUNDARIES',
    IMPLEMENTATION_TASKS: '4. IMPLEMENTATION TASKS (STEP LIST)',
    VALIDATION_LAYER: '5. VALIDATION LAYER (NON-NEGOTIABLE)',
    COMPLETENESS_REPORT: '6. COMPLETENESS REPORT (FORCED OUTPUT)',
    AUTO_RECOVERY: '7. AUTO-RECOVERY RULE',
    DIFF_GUARANTEE: '8. DIFF GUARANTEE',
    BEHAVIOR_CONTRACT: '9. FINAL SYSTEM BEHAVIOR CONTRACT',
  };
  return names[key] || key;
}
