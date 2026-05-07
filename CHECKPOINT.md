# THE GAHWA — Project Checkpoint

> **Last Updated:** 2026-05-07 15:09 AST  
> **Maintainer:** Cline (VS Code / Cursor Agent)  
> **Purpose:** Milestone tracker for cross-AI handoff (share this file with Gemini to sync context)

---

## Project Identity

- **Name:** The Gahwa Newsletter Pipeline (a.k.a. STARTUP SCOUT OS v5)
- **Tagline:** "The Gulf Brief — A Premium Daily Brew of Gulf Insight"
- **Mission:** Automated daily GCC business intelligence newsletter
- **Runtime:** Google Apps Script (deployed via Hetzner VPS → clasp)
- **AI Backend:** DeepSeek v4 (Anthropic-compatible endpoint)

---

## ✅ Latest Milestone — 2026-05-07

**Completed:** Full project inventory & summary compilation

All 14 source files have been read, analyzed, and documented. The complete project context has been captured, covering:

- 7 core Apps Script files (Code, Claude, Parser, Utilities, Render, Html, Aggregatenewsletters)
- 3 deployment scripts (deploy.sh, setup_hetzner.sh, send_to_apps_script.sh)
- 1 Python utility (clasp_push.py)
- 1 GitHub Actions CI/CD workflow
- 3 test files (mockTest.gs, test_lead_tracking_api.py, test_deepseek_dryrun.py)
- 1 output brief (redcloud_raid_insight.md)
- Config files (.clasp.json, .clinerules, appsscript.json, .gitignore)

**Key deliverables from this milestone:**
- Comprehensive project summary delivered to user
- This CHECKPOINT.md file created for cross-AI handoff

---

## 📋 Pipeline Overview

```
6:00 AM  → aggregateNewsletters() — Build Intel Dump (20 RSS categories + Gmail)
9:00 AM  → runScoutStep1() — Extract signals via DeepSeek Flash
Auto     → runScoutStep2() — Score + Rank signals (GAHWA-R framework) → Part 1
Auto     → runScoutStep3() — Generate Parts 2-7 (Themes, Viral, Startup, etc.)
Auto     → runScoutStep4() — Build HTML + Email via Gmail
11:00 AM → dailyHealthCheck() — Verify delivery
Saturday → runWeeklyRollup() + consolidateWeeklyIntel()
2:00 AM  → cleanupTempDocs()
```

### GAHWA-R Scoring Framework
| Dimension | Weight |
|-----------|--------|
| GCC Proximity | 30% |
| Actionability | 20% |
| Human Interest | 15% |
| Why Today | 20% |
| Autonomy/Novelty | 15% |
| **Score out of** | **25** |

---

## 🏗️ Architecture

```mermaid
Developer → GitHub → Hetzner VPS (git pull + clasp push) → Google Apps Script → Gmail/Drive/RSS
```

- **Source of truth:** GitHub repo `gahwa-newsletter`
- **Deployment authority:** Hetzner VPS (`/opt/gahwa`)
- **Runtime target:** Google Apps Script (script ID: `1s9_k1zGgRgCzxWRLtjzoPVAPEKUuCQ9GL7PofLPkRQKqTtdLAteL6sY5`)
- **CI/CD:** GitHub Actions → SSH → Hetzner → `git pull` → `clasp push`

---

## 🔧 Key Files

| File | Role |
|------|------|
| `scripts/Code.gs` | Pipeline orchestrator (4 steps + weekly + health) |
| `scripts/Claude.gs` | DeepSeek API wrapper + all AI prompts + webhook handler |
| `scripts/Parser.gs` | Pure text parsing (no GAS deps) |
| `scripts/Utilities.gs` | Secrets, logging, Drive/Doc, email, triggers, state mgmt |
| `scripts/Render.gs` | HTML section renderers + SVG visual builders |
| `scripts/Html.gs` | Bundled templates (2550 lines: Scout + Gahwa CSS/rendering) |
| `scripts/Aggregatenewsletters.js` | RSS (20 categories) + Gmail aggregator |
| `scripts/appsscript.json` | GAS manifest (Asia/Riyadh, V8 runtime) |
| `.github/workflows/deploy.yml` | GitHub Actions → SSH deploy |
| `tests/mockTest.gs` | Webhook test harness (5 test cases) |
| `tests/test_deepseek_dryrun.py` | DeepSeek endpoint connectivity test |
| `tests/test_lead_tracking_api.py` | CRM leads API audit (8 leads) |
| `output/redcloud_raid_insight.md` | Executive brief on RAID FMCG framework |

---

## 🧠 AI Model Config

- **Fast model:** `deepseek-v4-flash` (max_tokens: 8000) — extraction
- **Smart model:** `deepseek-v4-pro` (max_tokens: 8096) — scoring + content gen
- **Endpoint:** `https://api.deepseek.com/anthropic/v1/messages`
- **Auth header:** `x-api-key` (Anthropic-compatible)
- **API key stored in:** PropertiesService (`SECRET_DEEPSEEK_API_KEY`)

---

## 🚧 Known Limitations / Status

| Item | Status |
|------|--------|
| Beehiiv posting | ⛔ Disabled (Posts API requires Enterprise plan) |
| Scout internal HTML | 🚫 Deactivated (Phase 2: public Gahwa output only) |
| Gmail delivery | ✅ Active |
| Weekly rollup | ✅ Active |
| Webhook auth | ✅ Tested (5 test cases passing) |
| Pipeline retry logic | ✅ Max 2 attempts per step |
| Continuation triggers | ✅ Handles 6-min GAS limit |

---

## 🗺️ Next Steps / Backlog

*(To be filled as new milestones are planned)*

---

## Handoff Notes for Gemini

This file is designed to be shared with Gemini (or any other AI) to provide instant context on the project. The key things to know:

1. **This is a Google Apps Script project** — all `.gs` files run in the GAS runtime
2. **Deployment is via Hetzner** — not direct from GitHub
3. **The AI is DeepSeek v4** — not Claude (despite the `callClaude` function naming)
4. **The scoring is GAHWA-R** — 5 dimensions, weighted, out of 25
5. **The audience is Saudi/GCC executives** — tone is "Morning Brew energy meets regional intelligence"
6. **Branding is dual** — "STARTUP SCOUT" (internal) / "THE GAHWA" (public subscriber-facing)
