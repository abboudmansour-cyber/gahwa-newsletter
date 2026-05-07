# THE GAHWA — Project Checkpoint

> **Last Updated:** 2026-05-07 19:37 AST  
> **Maintainer:** Cline (VS Code / Cursor Agent)  
> **Purpose:** Milestone tracker for cross-AI handoff (share this file with Gemini to sync context)

---

## Project Identity

- **Name:** The Gahwa Newsletter Pipeline (a.k.a. STARTUP SCOUT OS v5)
- **Tagline:** "The Gulf Brief — A Premium Daily Brew of Gulf Insight"
- **Mission:** Automated daily GCC business intelligence newsletter
- **Runtime:** Google Apps Script (deployed via Hetzner VPS → clasp)
- **AI Backend:** DeepSeek v4 (Anthropic-compatible endpoint)
- **Deployment Model:** Event-driven webhook (no SSH from GitHub)

---

## ✅ Latest Milestone — 2026-05-07

**Completed:** Migration to event-driven webhook deployment

All SSH-based deployment has been removed from GitHub Actions. The system now uses:
- **GitHub Webhook** → Hetzner Listener (port 3000)
- **No SSH keys in CI** — never stored in GitHub Secrets
- **No appleboy/SSH Actions** — the deploy workflow is CI-only
- **git pull** is executed by the Hetzner listener on webhook receipt

### What Changed

| Before | After |
|--------|-------|
| GitHub Actions SSHes into Hetzner | GitHub sends HTTP webhook |
| SSH keys stored in GitHub Secrets | No SSH keys in CI (Hetzner has own deploy key) |
| appleboy/ssh-action used for deploy | Pure webhook → `git fetch origin main` + `git reset --hard origin/main` |
| Workflow ran `git pull` via SSH | Listener runs `git pull` locally on webhook |
| SSH key config & known_hosts in CI | HMAC signature verification in server.js |
| Multiple GitHub Secrets for SSH | Zero GitHub Secrets for infrastructure |

---

## 🏗️ Architecture

```mermaid
Developer → GitHub → Webhook → Hetzner VPS (git pull + run operator) → Google Apps Script → Gmail/Drive/RSS
```

- **Source of truth:** GitHub repo `gahwa-newsletter`
- **Deployment authority:** Hetzner VPS (`/opt/gahwa-newsletter`)
- **Trigger mechanism:** GitHub webhook (HTTP POST, no SSH)
- **Runtime target:** Google Apps Script (script ID: `1s9_k1zGgRgCzxWRLtjzoPVAPEKUuCQ9GL7PofLPkRQKqTtdLAteL6sY5`)
- **CI/CD:** GitHub Actions → CI tests only → Webhook → Hetzner → `git pull` → operator

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
| `.github/workflows/deploy.yml` | CI only (no SSH deploy) |
| `operator/server.js` | Webhook listener (event-driven deployment) |
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
| Event-driven deploy | ✅ No SSH from GitHub |

---

## 🗺️ Next Steps / Backlog

*(To be filled as new milestones are planned)*

---

## Handoff Notes for Gemini

This file is designed to be shared with Gemini (or any other AI) to provide instant context on the project. The key things to know:

1. **This is a Google Apps Script project** — all `.gs` files run in the GAS runtime
2. **Deployment is via Hetzner** — triggered by GitHub webhook, not direct from GitHub Actions
3. **No SSH from GitHub** — deployment is event-driven via HTTP webhook
4. **The AI is DeepSeek v4** — not Claude (despite the `callClaude` function naming)
5. **The scoring is GAHWA-R** — 5 dimensions, weighted, out of 25
6. **The audience is Saudi/GCC executives** — tone is "Morning Brew energy meets regional intelligence"
7. **Branding is dual** — "STARTUP SCOUT" (internal) / "THE GAHWA" (public subscriber-facing)
