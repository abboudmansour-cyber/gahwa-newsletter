# GAHWA — Self-Healing Newsroom Engine (Final Architecture)

## High-Level System Design

```
                ┌──────────────────────┐
                │   operator.js        │
                │ (Entry Orchestrator) │
                └─────────┬────────────┘
                          │
                          ▼
        ┌────────────────────────────────┐
        │      Execution Engine         │
        │   (core/executor.js)          │
        └─────────┬────────────────────┘
                  │
      ┌───────────┼──────────────────────┐
      ▼           ▼                      ▼
┌─────────┐  ┌────────────┐     ┌──────────────┐
│ DeepSeek│  │ Git Layer  │     │ Runtime Layer│
│ Planning │  │ State S/M │     │ Validation   │
└─────────┘  └────────────┘     └──────────────┘
                  │
                  ▼
        ┌──────────────────────┐
        │ Step Execution Loop  │
        └─────────┬────────────┘
                  │
      ┌───────────┼───────────────┐
      ▼           ▼               ▼
┌──────────┐ ┌────────────┐ ┌──────────────┐
│ Evaluator│ │ Feedback   │ │ Recovery     │
│ (rules)  │ │ Memory     │ │ Engine       │
└──────────┘ └────────────┘ └──────────────┘
                  │
                  ▼
        ┌──────────────────────┐
        │ Apps Script Delivery │
        │ (doPost pipeline)    │
        └──────────────────────┘
```

## Core Layers

### 1. Orchestration Layer

**`/operator/operator.js`**

Responsibilities:
- Receives job (e.g., `daily-newsletter`)
- Triggers execution engine via `core/executor.js`
- Ensures replay mode is respected
- Calls truth verification after execution
- Manages self-optimization loop

### 2. Execution Engine

**`/operator/core/executor.js`**

Responsibilities:
- Step-by-step execution through git state machine
- Calls git snapshot layer per step
- Calls evaluator after run
- Triggers recovery engine if needed
- Provides pipeline lifecycle management

### 3. Git State Machine (NEW Core)

**`/operator/core/git-state-machine.js`**

Replaces the old "just commit code" behavior.

Tracks:
- `beforeCommit` — HEAD hash before a step executes
- `afterCommit` — HEAD hash after a step executes
- `diff` per step — structured file changes
- `stepCommitMap` — step name → commit hash lookup

Every run is fully replayable: given any runId, you can reconstruct the exact state before/after each step. Failed steps can be replayed by checking out the `beforeCommit`.

### 4. DeepSeek Planner

**`/operator/core/llmGateway.js`**

Constrained by:
- Atomic prompt format (see `docs/atomic_prompt_template.md`)
- Strict JSON schema validation
- Retry limiter (max 2 attempts)

### 5. Evaluation System

**`/operator/core/evaluator.js`**

Rule-based scoring engine:
- NO AI evaluation — pure deterministic rules
- Produces structured metrics only

Outputs: `clarity`, `gcc_relevance`, `market_depth`, `readability`, `overall`

### 6. Feedback Memory Loop

**`/operator/core/feedback.js`**

Responsibilities:
- Stores last 100 runs in `logs/feedback.json`
- Delegates prompt evolution to `prompt-evolver.js`
- Delegates improvement hint construction to `prompt-evolver.js`

### 7. Prompt Evolution Engine

**`/operator/core/prompt-evolver.js`**

Rules:
- If same weakness appears across 3 consecutive runs → update prompt (creates new version)
- Otherwise keep stable — never rewrite on single weak runs
- NEVER rewrite structure — only append improvement instructions
- Maintains versioned prompt files in `prompts/` directory

### 8. Recovery Engine

**`/operator/core/replay-engine.js`**

Upgraded to use git state machine:
- Reads `execution-state.json` to find last FAILED step
- Uses `git-state-machine.js` for pre-step commit targeting
- `git checkout <preStepCommit>` to reset to pre-failure state
- Only replays the failed step
- Re-commits with traceable message

### 9. Delivery Layer (Apps Script)

**`/scripts/Code.gs`** (Google Apps Script)

Enforces:
- `doPost(e)` only entry point
- Idempotency via `deliveryId` field
- Response validation (HTML detection — catches HTML error pages disguised as HTTP 200)

## File Structure (Final)

```
operator/
  core/
    executor.js              # Execution engine (core orchestrator)
    evaluator.js              # Rule-based scoring engine
    feedback.js               # Feedback memory loop (delegates to prompt-evolver)
    recovery.js               # Recovery index management
    replay-engine.js          # Git-driven replay engine
    git-state-machine.js      # Git-backed state machine (step→commit mapping)
    git-snapshot.js           # Low-level git snapshot utilities
    prompt-evolver.js         # Prompt evolution engine (versioned prompts)
    llmGateway.js             # DeepSeek planner (atomic prompt → strict JSON)
    step-executor.js          # (Legacy — replaced by git-state-machine.js)
    editor.js                 # Editorial frame builder
    fusion-engine.js          # Signal fusion engine
    insight-synthesizer.js    # Strategic insight synthesis
    scenario-engine.js        # Scenario generation
    signal-normalizer.js      # Signal normalization
    optimizer.js              # Self-optimization engine
    truth-evaluator.js        # Truth verification
    state.js                  # Loop isolation (mode locks)
    runtime.js                # Runtime context
    lock.js                   # Lock primitives
    logger.js                 # Run logging
    retry.js                  # Retry logic
    security.js               # Security validation
    validate-env.js           # Environment validation
    prompt-auditor.js         # Prompt structure audit
    diff-guard.js             # Diff guard protocol
    prompt-format-enforcer.js # Atomic format enforcer
    prompt-generator.js       # Prompt generator
    prompt-spec-mapper.js     # Prompt spec mapper
    prompt-completeness-checker.js  # Completeness validation
    traceability-matcher.js   # Traceability verification
    validator.js              # General validator
    fault.js                  # Fault injection
    signals/                  # Signal modules
      macro.js
      markets.js
      geopolitics.js
      ai_tech.js
  logs/
    runs.json                 # Run history
    feedback.json             # Feedback store (last 100 entries)
    execution-state.json      # Git state machine state
    recovery-index.json       # Recovery index
    failed.json               # Failed run log
    success.json              # Success run log
    feedback.json             # Feedback memory
    editorial-decisions.json  # Editorial decisions log
    rejected-stories.json     # Rejected story log
    optimization-log.json     # Optimization history
    truth-log.json            # Truth verification log
    insights.json             # Insight synthesis log
    scenarios.json            # Scenario generation log
    execution-map.json        # Execution map log
    prompt-execution-audit.json  # Prompt audit log
  prompts/
    newsletter_prompt_v1.md   # Current prompt (v1)
    newsletter_prompt_v2.md   # Evolved prompt (created by prompt-evolver.js)
  operator.js                 # Entry orchestrator
  executor.js                 # Pipeline orchestration brain (spawns operator.js)
  daily-runner.js             # Daily cron runner
  scheduler.js                # Clock-based job scheduler
  server.js                   # HTTP server
  memory.js                   # Newsletter history memory
  evaluator.js                # Legacy evaluator (see core/evaluator.js)
```

## System Behavior

### BEFORE (Old System)

```
Prompt → Execution → Assume success → Logs
```

❌ Silent failures
❌ Partial execution  
❌ Webhook mismatches
❌ Skipped steps

### AFTER (This Architecture)

```
Prompt
→ Atomic execution
→ Git snapshot per step
→ Evaluation
→ Feedback memory update
→ Recovery if needed
→ Delivery validation
→ Prompt evolution (optional)
```

✔ Fully traceable — every step maps to a git commit
✔ Replayable — git checkout + re-run any failed step
✔ Self-correcting — auto-recovery on failure detection
✔ State-aware — git-backed execution state
✔ No silent failure — truth verification catches mismatches

## Execution Flow

### Normal Run

1. `operator/executor.js` generates runId, acquires NORMAL lock
2. Spawns `operator.js` as child process
3. `operator.js`:
   a. Generates plan from DeepSeek via `llmGateway` (atomic prompt)
   b. Executes plan steps through `core/git-state-machine.js`
      - Each step: snapshot → execute → snapshot → auto-commit
   c. Generates newsletter content via signal fusion + editorial frame
   d. Evaluates output via `core/evaluator.js`
   e. Processes feedback via `core/feedback.js` (stores to feedback.json)
   f. Runs optimization via `core/optimizer.js`
   g. Checks prompt evolution via `core/prompt-evolver.js`
   h. Delivers to Apps Script webhook with idempotent deliveryId
4. `executor.js` performs truth verification
5. On failure: `scanAndIndexFailures()` → auto-recovery via `replay-engine.js`

### Replay Run

1. `replay-engine.js` reads execution-state.json, finds last FAILED step
2. `git checkout <preStepCommit>` — resets to pre-failure state
3. Spawns `operator.js --replay` to re-execute only the failed step
4. Re-commits with traceable message
5. Updates execution-state.json

### Prompt Evolution

1. Feedback is stored in `feedback.json` with weakness tags
2. If same weakness appears across 3 consecutive runs → `prompt-evolver.js` creates new prompt version
3. New prompt version appends targeted improvement instructions (never rewrites structure)
4. DeepSeek receives improvement hint on next run

## Design Principles

1. **Stateful** — Every execution is git-versioned and fully traceable
2. **Replayable** — Any failed step can be replayed from its pre-execution git state
3. **Self-Healing** — Auto-recovery on failure; auto-evolution on recurring weaknesses
4. **Deterministic** — Rule-based evaluation, no AI feedback loops
5. **Isolated** — Mode locks prevent overlapping execution (NORMAL/REPLAY/RECOVERY)
6. **Single Responsibility** — Each core module has one job
7. **No Silent Failure** — Truth verification validates against external sources

## Future Considerations

- **Distributed Run Ledger (Event Sourcing)** — Full replay of entire system history with time-travel debugging
- **Per-Topic Performance Analytics** — GCC intelligence scoring over time per sub-topic
- **Multi-Newsletter Support** — Extend to support multiple newsletter types
