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

## [YYYY-MM-DD]

<!-- 
Template for new entries:
### Added
- 

### Changed
- 

### Fixed
- 

### Removed
- 
-->
