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

## 2026-05-07 (Later)

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
