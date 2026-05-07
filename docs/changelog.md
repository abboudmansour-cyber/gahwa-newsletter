# Gahwa Newsletter — Changelog

> This file serves as the canonical record of all significant changes to the Gahwa Newsletter project.

---

## 2026-05-07

### Added
- Created `/docs` persistent memory system with 7 curated documentation files:
  - `architecture.md` — System architecture covering Hetzner, Apps Script, GitHub roles, AI generation pipeline, delivery flow, and local Mac dependency removal rationale
  - `editorial_style.md` — Editorial guide covering tone, pacing, style, Morning Brew inspirations, GCC audience expectations, headline rules, humor boundaries, formatting standards, and editorial constraints
  - `newsletter_prompt.md` — Master AI prompt template for DeepSeek, generation rules, output JSON schema, validation checks, dynamic context injection, and fallback behavior
  - `workflow.md` — Daily generation flow with timing, cron execution, step-by-step pipeline stages, weekly/monthly workflows, and manual override procedures
  - `deployment.md` — Hetzner setup (SSH, cron), GitHub Actions CI/CD, Apps Script clasp integration, rollback procedures, and monitoring
  - `gcc_topics.md` — 11 editorial categories (oil, sovereign wealth, GCC startups, AI, tourism, fintech, logistics, HORECA, geopolitics, public investment, regional trade) each with: why it matters, target tone, and example story angles
  - `changelog.md` — This file, for tracking all project changes over time
- Established `/docs` as the canonical project memory system for AI context preservation

### Changed
- Removed CRM concepts and SaaS architecture references from all docs
- Refocused `gcc_topics.md` from sub-topic lists to editorial guidance (why it matters, tone, story angles)
- Added "Local Mac Dependency Removal" section to `architecture.md` explaining the migration to Hetzner-only production
- Tightened all docs for conciseness and editorial workflow focus over software complexity
- Updated `.clasp.json` and clasp integration references to reflect stabilized deployment flow

### Fixed
- Eliminated duplicate information across docs; each file now has a single, non-overlapping purpose
- Removed CRM terminology and lead-tracking references to keep docs focused on newsletter engine identity

### Infrastructure
- Stabilized clasp integration for Apps Script deployment
- Documented recovered Apps Script files and their roles
- Established Hetzner orchestration as the sole production generation environment
- Moved away from local Mac dependency for live newsletter generation

---

## 2026-05-07 (Editorial Intelligence Layer)

### Added
- **`operator/core/editor.js` — Editorial Intelligence Engine**
  - Deterministic topic scoring system: 16 curated GCC topic profiles each with base scores (1–10), categories, and editorial justifications
  - Priority ranking: oil (9.5), Saudi policy (9.0), SWF moves (8.5), macro indicators (8.0), banking/regulation (7.5), geopolitics (7.5), AI/tech (7.0), startups (6.5), corporate earnings (6.0), fintech (5.5), tourism (5.0), logistics (4.5), public investment (4.5), HORECA (3.5), partnerships (2.5), generic tech (1.5)
  - Morning Brew–style narrative order: macro → policy → geopolitics → AI/tech → startups → sector deep dives → briefs
  - Breaking signal detection (4 HIGH signals, 0–4 MEDIUM depending on date)
  - Seasonal/calendar weight boosting (Hajj season, OPEC+ meetings, SWF annual reviews, trade data windows)
  - Day-of-week context awareness (Saudi work week: Sun–Thu)
  - `buildEditorialFrame()` — returns structured editorial frame with priorityRanking, narrativeOrder, breakingSignals, editorialDirective
  - `formatEditorialFrame()` — formats the frame as a prompt attachment string for DeepSeek injection
  - Zero AI/ML — fully deterministic rule-based system
- **Editorial frame integrated into operator.js pipeline**
  - `generatePlan()` now builds editorial frame before every DeepSeek call
  - Editorial frame is appended to the DeepSeek prompt as structured guidance
  - DeepSeek receives explicit editorial directive: "Follow this editorial ordering and prioritization when constructing the newsletter"

### Changed
- **`operator/operator.js`** — `generatePlan()` now runs editorial intelligence layer before DeepSeek call:
  - Step 1: `buildEditorialFrame(CURRENT_DATE)` generates deterministic topic ranking
  - Step 2: `formatEditorialFrame()` converts to structured prompt text
  - Step 3: Editorial frame appended to DeepSeek prompt with constrained ordering instruction
  - Pipeline log now includes: topic count, narrative slot count, breaking signal count

---

## 2026-05-07 (Idempotent Delivery Layer)

### Added
- **Idempotent Delivery Layer — production-grade duplicate protection**
  - `deliveryId` generation: `${job}-${date}-${gitCommitHash}` in `operator.js`, `daily-runner.js`, and `send_to_apps_script.sh`
  - All webhook payloads now include `deliveryId` for dedup tracking
  - Apps Script `Code.gs`: `isDuplicate()` guard at top of `doPost()` + `markDelivered()` after successful Gmail send
  - `classifyAppsScriptError()` in `operator.js` and `daily-runner.js` treats `"DUPLICATE_IGNORED"` as valid success (returns `null`)
  - `send_to_apps_script.sh`: HTTP 200 handler checks for `DUPLICATE_IGNORED` — treated as success
  - Delivery log records both `VALIDATED SUCCESS` and `DUPLICATE_IGNORED (idempotent)` statuses

### Changed
- **Deployment model migrated from SSH to event-driven webhook**

  - `.github/workflows/deploy.yml` — stripped all SSH/appleboy steps; now CI only
  - Deployment is triggered by GitHub webhook → Hetzner listener (port 3000)
  - `server.js` handles: event validation (push only), branch guard (main only), HMAC verification, git pull, operator execution, locking
  - `setup_hetzner.sh` — clarified SSH key is server-side only (not stored in CI)
  - All docs updated: `architecture.md`, `deployment.md`, `README.md`, `CHECKPOINT.md`, `workflow.md`, `master-context.md`
  - `env.hetzner.template` — added `GITHUB_WEBHOOK_SECRET` field for HMAC verification
  - The system is now fully event-driven: push → webhook → git pull → operator → Apps Script

### Removed
- All SSH-based deployment code from GitHub Actions
- `appleboy/ssh-action` references
- SSH key configuration steps from CI workflow
- `known_hosts` management from CI
- `HETZNER_SSH_KEY`, `HETZNER_HOST`, `HETZNER_USER` GitHub Secrets dependency

---

## 2026-05-07 (Auto-Recovery Layer)

### Added
- **`operator/logs/recovery-index.json` — Recovery Index**
  - Structured log of all failed/missing runs with: runId, date, job, status (FAILED/PARTIAL/MISSING_PUSH), reason, replayEligible flag, replayAttemptCount
  - Dedup by runId to prevent duplicate entries
  - Auto-trim to last 500 entries

- **`operator/core/recovery.js` — Recovery Index Manager**
  - `appendRecoveryEntry()` — indexes a failed run with dedup protection
  - `getEligibleReplays()` — filters replayEligible: true entries for processing
  - `incrementReplayAttempt()` — tracks attempt count; auto-disables at > 2 (replay loop guard)
  - `markAsReplayed()` / `markFailedReplay()` — lifecycle state transitions (RECOVERED / FAILED_PERMANENT)
  - `getPendingReplayCount()` — quick health check of pending recovery queue
  - `dedupIndex()` — cleanup utility for manual maintenance

- **`operator/core/replay-engine.js` — Automatic Replay Engine**
  - Reads recovery-index.json, filters replayEligible entries, rebuilds execution context (job, date, commit)
  - Spawns operator.js with `--replay` flag for each eligible run (up to 5 per cycle)
  - 2-minute timeout guard per replay to prevent runaway processes
  - Runs `ensureExecutionContext()` for deterministic path resolution
  - `enqueueReplay()` — one-call function to index + trigger immediate replay
  - Standalone entry point: `node core/replay-engine.js`

- **`operator/operator.js` — Safe Replay Mode (`--replay` flag)**
  - `const isReplay = process.argv.includes("--replay")` at module scope
  - Replay mode skips newsletter `generate_newsletter` step if `output/latest-newsletter.json` already exists
  - Re-uses stored JSON; only re-triggers push + validation steps
  - Visible "🔄 REPLAY MODE ACTIVE" banner in execution header

- **`operator/executor.js` — Post-Execution Failure Scanner**
  - `scanAndIndexFailures()` — runs after every failed execution
  - Scans `/logs/runs.json` for: failed runs, partial executions (missing step), and silent push failures (MISSING_PUSH detection)
  - Scans `/logs/failed.json` for any logged failures not yet indexed
  - Automatically calls `runReplayEngine()` after indexing failures

### Changed
- **Failures now self-recover**: every failed run is indexed in recovery-index.json, and the replay engine fires automatically within the same process
- **Replay loop guard prevents infinite retry**: max 2 replay attempts per failed run, then marked FAILED_PERMANENT
- **Delivery safety preserved**: replay mode uses idempotent deliveryId system — same (job, date, commit) = DUPLICATE_IGNORED at Apps Script layer

### System State (Post Auto-Recovery)
- deterministic execution ✔
- validated webhook ✔
- semantic response validation ✔
- idempotent delivery ✔
- automatic failure recovery ✔

---

## 2026-05-07 (Loop Isolation — Final Hardening)

### Added
- **`operator/core/state.js` — Global Execution State Lock**
  - Mutual exclusion: only ONE execution mode can run at a time (NORMAL / REPLAY / RECOVERY)
  - `acquireLock(mode, runId)` — acquires lock with mode-specific flags; refuses if any mode is active
  - `releaseLock()` — resets state to NORMAL; called in `finally` blocks for leak-safety
  - `isBlocked(mode)` / `isOperationBlocked(operation)` — fine-grained guard checks for entry points
  - `printModeBanner(mode)` — prints 🧠 NORMAL / 🔁 REPLAY / 🛠 RECOVERY at start of every run
  - `setState(partial)` — deep merge helper for runtime state updates
  - Persisted to `operator/runtime/state.json` (gitignored runtime artifact)

- **`operator/runtime/state.json` — Persistent State Artifact**
  - Schema: `{ mode, activeRunId, flags: { recoveryRunning, replayRunning } }`
  - Default: `{ mode: "NORMAL", activeRunId: "", flags: { recoveryRunning: false, replayRunning: false } }`
  - Auto-created by `ensureRuntimeDir()` on first read

### Changed
- **`operator/operator.js` — Mode banner + replay guard**
  - Imports `printModeBanner`, `MODES` from `./core/state.js`
  - Prints 🧠 MODE: NORMAL or 🔁 MODE: REPLAY banner on every run
  - Clear log: "⛔ Recovery hooks disabled — replay will not trigger recovery" in replay mode
  - Recovery hooks only triggered in NORMAL mode (replay → operator.js bypasses executor.js)

- **`operator/executor.js` — Lock acquisition + isolated recovery**
  - `runJob()` acquires NORMAL lock before spawning operator.js; releases on success
  - On failure: releases NORMAL lock BEFORE calling `scanAndIndexFailures()`
  - `scanAndIndexFailures()` acquires RECOVERY lock (mutual exclusion from replay/normal)
  - Critical deadlock fix: releases RECOVERY lock BEFORE calling `runReplayEngine()`
  - Uses `replayTriggered` flag to prevent lock theft in `finally` block
  - NORMAL lock release in failure path prevents cascading lock contention

- **`operator/core/replay-engine.js` — Lock acquisition in `runReplayEngine()`**
  - Acquires REPLAY lock at start; released in `finally` block
  - `printModeBanner(MODES.REPLAY, ...)` for observability
  - Blocked completely if another mode (NORMAL/RECOVERY) is holding the lock

### Strict Constraints Enforced
- ⛔ replay cannot trigger recovery (mode === REPLAY → operator.js disables recovery hooks)
- ⛔ recovery cannot trigger replay (RECOVERY lock released before REPLAY lock acquired)
- ⛔ normal execution is isolated (NORMAL lock prevents overlap with replay/recovery)
- ⛔ no recursive execution chains (mutual exclusion + replayTriggered flag)
- ⛔ deadlock prevention (explicit release of prior lock before acquiring next mode)

### Validated
- All 4 files pass `node -c` syntax validation
- All entry points (executor.js → state.js, replay-engine.js → state.js, operator.js → state.js)
- Lock lifecycle: acquire → work → release (enforced via try/finally)
- Lock transition: NORMAL → (failure) → RECOVERY → release → REPLAY → release

### System State (Post Loop Isolation)
- deterministic execution ✔
- validated webhook ✔
- semantic response validation ✔
- idempotent delivery ✔
- automatic failure recovery ✔
- loop isolation safety ✔
- no recursive reinforcement loops ✔
