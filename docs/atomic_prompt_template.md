# 🧱 GAHWA ATOMIC EXECUTION STANDARD (MASTER FORMAT)

**Version:** 2.0  
**Purpose:** Transform every Cline run into a deterministic, non-skippable, verifiable, resumable, diff-safe, audit-ready execution engine.  
**Sections:** 0–9 (10-section contract)

Use this as the **ONLY** prompt structure going forward for system changes.

---

## ⚡ 0. HEADER (MANDATORY)

Every prompt starts with:

```
SYSTEM: Gahwa Operator
MODE: Atomic Execution
STRICT MODE: ON
NO PARTIAL IMPLEMENTATION: TRUE
```

This is the execution contract preamble. If absent → enforcement fails.

---

## 🎯 1. OBJECTIVE (NO AMBIGUITY)

State exactly what the system must do.

**Good:**
```
Add a scenario generation engine that produces structured GCC macro scenarios from existing insights.
Implement doPost webhook that validates HMAC signatures before processing.
Create traceability-matcher.js that maps every feature to a file, every file to a function.
```

**Rules:**
- no "enhance", "improve", "optimize"
- only verbs: add / create / implement / integrate / fix

---

## 📦 2. REQUIRED ARTIFACTS (THE CONTRACT)

**This is the MOST IMPORTANT part.**

```yaml
FILES REQUIRED:
  - operator/core/traceability-matcher.js
  - operator/logs/execution-map.json

FUNCTIONS REQUIRED:
  - mapFeatureToFile()
  - verifyExecutorReachability()

LOGS REQUIRED:
  - operator/logs/execution-map.json

BROKEN HOOKS CHECK:
  - operator/core/prompt-format-enforcer.js exports enforcePromptFormat
  - operator/core/prompt-generator.js exports generateAtomicPrompt
  - operator/audit-runner.js all commands functional
```

✔ This becomes your execution checklist

---

## 🧠 3. IMPLEMENTATION BOUNDARIES

Hard constraints:

```
* Do NOT modify existing architecture
* Do NOT delete existing modules
* Do NOT introduce new external services
* Only extend current pipeline
* Keep interfaces unchanged
* Do NOT modify function signatures of existing exports
* Do NOT rename existing files or modules
```

---

## 🔧 4. IMPLEMENTATION TASKS (STEP LIST)

Break work into deterministic steps:

1. Create file X
2. Add function Y
3. Hook into executor.js
4. Append logs to runs.json

**No narrative explanations. Only actions.**

---

## 🧪 5. VALIDATION LAYER (NON-NEGOTIABLE)

After implementation, system MUST run checks:

```
CHECK:
  - file existence validation
  - function grep validation
  - runtime import test
  - log write test
  - hook integration test
  - executor reachability test
```

---

## 📊 6. COMPLETENESS REPORT (FORCED OUTPUT)

Cline MUST return:

```json
{
  "status": "COMPLETE | INCOMPLETE",
  "missingFiles": [],
  "missingFunctions": [],
  "brokenHooks": [],
  "executionScore": 0-100
}
```

If anything is missing → system is FAILED, not "done".

---

## 🔁 7. AUTO-RECOVERY RULE

If INCOMPLETE:

```
RETRY MODE:
  - Only implement missing items from REQUIRED ARTIFACTS
  - Do NOT repeat completed work
  - After retry, re-validate completeness
  - If still incomplete → escalate with notes
```

---

## 🧾 8. DIFF GUARANTEE (NEW CRITICAL LAYER)

Add this to every prompt:

```
OUTPUT REQUIREMENT:
  - list all created files
  - list all modified files
  - list all new functions added
  - list all hooks attached
```

This eliminates silent edits.

---

## 🧠 9. FINAL SYSTEM BEHAVIOR CONTRACT

At the end of every run:

```
* system must be fully traceable
* every feature must map to a file
* every file must map to a function
* every function must be reachable from executor
```

---

## 🔗 Integration with Existing System

| Component | Role |
|-----------|------|
| `prompt-format-enforcer.js` | Validates prompt structure **BEFORE** execution (10 sections) |
| `prompt-spec-mapper.js` | Parses prompt to extract expected artifacts |
| `prompt-completeness-checker.js` | Verifies artifacts exist **AFTER** execution (includes brokenHooks) |
| `prompt-auditor.js` | Orchestrates, blocks, generates retry prompts |
| `diff-guard.js` | Git-based diff tracking for auditable changes |
| `prompt-generator.js` | Generates atomic-format prompts from structured params (10 sections) |
| `traceability-matcher.js` | Maps feature → file → function → executor reachability |
| `audit-runner.js` | CLI interface for all of the above |

---

## ✅ Example: Fully Formed Gahwa Atomic Prompt

```markdown
SYSTEM: Gahwa Operator
MODE: Atomic Execution
STRICT MODE: ON
NO PARTIAL IMPLEMENTATION: TRUE

# 🎯 1. OBJECTIVE (NO AMBIGUITY)
Create traceability-matcher.js that maps every feature to a file, every file to a function, and verifies executor reachability.

# 📦 2. REQUIRED ARTIFACTS (THE CONTRACT)
FILES REQUIRED:
  - operator/core/traceability-matcher.js
  - operator/logs/execution-map.json
FUNCTIONS REQUIRED:
  - mapFeatureToFile()
  - verifyExecutorReachability()
  - buildTraceabilityMap()
LOGS REQUIRED:
  - operator/logs/execution-map.json

# 🧠 3. IMPLEMENTATION BOUNDARIES
* Do NOT modify existing architecture
* Do NOT delete existing modules
* Only extend current pipeline
* Keep interfaces unchanged

# 🔧 4. IMPLEMENTATION TASKS (STEP LIST)
1. Create operator/core/traceability-matcher.js with 3 exported functions
2. Create operator/logs/execution-map.json with initial empty array
3. Add --traceability command to operator/audit-runner.js
4. Export traceability-matcher from operator/core/validator.js

# 🧪 5. VALIDATION LAYER (NON-NEGOTIABLE)
CHECK:
  - operator/core/traceability-matcher.js exists
  - operator/logs/execution-map.json exists
  - function "mapFeatureToFile" found via grep
  - function "verifyExecutorReachability" found via grep
  - function "buildTraceabilityMap" found via grep
  - import test: node -e "import('./operator/core/traceability-matcher.js')"
  - audit-runner --traceability runs without error

# 📊 6. COMPLETENESS REPORT (FORCED OUTPUT)
{ "status": "COMPLETE", "missingFiles": [], "missingFunctions": [], "brokenHooks": [], "executionScore": 100 }

# 🔁 7. AUTO-RECOVERY RULE
If incomplete: retry only missing items. Do NOT reimplement working parts.

# 🧾 8. DIFF GUARANTEE
OUTPUT REQUIREMENT:
  - list all created files
  - list all modified files
  - list all new functions added
  - list all hooks attached

# 🧠 9. FINAL SYSTEM BEHAVIOR CONTRACT
* system must be fully traceable
* every feature must map to a file
* every file must map to a function
* every function must be reachable from executor
```

---

## 🚫 Blocking Behavior

If a prompt execution scores < 100/100:

- The **next prompt is blocked** by `prompt-auditor.js`
- A **retry prompt** is automatically generated (only missing items)
- The `audit-runner.js --retry` command outputs the retry prompt
- The block can only be bypassed with `force: true`

---

## 📊 Diff-Guarded Execution

For fully auditable pipelines:

**Before:** Record git HEAD hash, snapshot file tree  
**After:** Compare git diff, report changed/added/untouched files, function-level changes

Diff Guard Verdict: **PASS** if no protected files modified, all expected changes present.

---

## 🚨 Warning Signs Your Prompt Is Not Atomic

| Symptom | Fix |
|---------|-----|
| No HEADER block | Add SYSTEM/MODE/STRICT MODE/NO PARTIAL IMPLEMENTATION |
| Vague objective like "improve X" | Replace with concrete deliverable |
| No file paths listed | Add REQUIRED ARTIFACTS section |
| No function names | Add function names to artifacts |
| No validation step | Add CHECK section |
| No completeness output requirement | Add COMPLETENESS REPORT section |
| No diff guarantee | Add DIFF GUARANTEE section |
| No traceability contract | Add FINAL SYSTEM BEHAVIOR CONTRACT |
| "Do your best" language | Remove — replace with explicit spec |
