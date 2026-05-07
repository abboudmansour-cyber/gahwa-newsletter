# Gahwa Newsletter — Architecture

> Last updated: 2026-05-07
> Deployment model: **Event-driven webhook (no SSH from GitHub)**

## Overview

Gahwa Newsletter is an AI-powered GCC business newsletter engine, inspired by Morning Brew. It automates the generation, rendering, and delivery of a daily B2B newsletter focused on Saudi Arabian and GCC markets.

The architecture follows a lean editorial pipeline with three core infrastructure layers:

1. **AI Generation** — DeepSeek via Hetzner
2. **Rendering & Delivery** — Google Apps Script
3. **Orchestration** — GitHub (source of truth) + Webhook-driven deployment

---

## Hetzner Role

Hetzner provides the compute layer for running AI generation workloads.

- A Linux VM hosts the newsletter generation scripts and the webhook listener daemon.
- The VM runs a persistent systemd service (`gahwa-listener.service`) on port 3000.
- Pushes to GitHub trigger a webhook → server pulls latest code → runs operator.
- A cron job at 7:00 AM AST also triggers the pipeline via local POST.
- Python scripts orchestrate calls to the DeepSeek API for content generation.
- The VM is lightweight (CX22 or equivalent), costing ~€5–8/month.
- No database is hosted on Hetzner; output is pushed directly to Apps Script.
- The VM has its own SSH deploy key (for `git pull`), configured separately from CI.

**Key scripts running on Hetzner:**
- `scripts/setup_hetzner.sh` — Initial VM provisioning
- `scripts/deploy.sh` — Newsletter generation orchestration
- `scripts/send_to_apps_script.sh` — Pushing generated content to Apps Script

---

## Apps Script Role

Google Apps Script handles the rendering, templating, and email delivery layer.

- **Code.gs** — Main entry point for newsletter generation and email dispatch.
- **Claude.gs** — Handles AI prompt assembly and API communication with DeepSeek.
- **Render.gs** — HTML rendering engine that converts structured JSON into branded newsletter HTML.
- **Parser.gs** — Parses raw AI output into structured newsletter sections.
- **Html.gs** — HTML templates and styling for the newsletter output.
- **Utilities.gs** — Shared helper functions (date formatting, validation, logging).
- **Aggregatenewsletters.js** — Client-side aggregation logic for newsletter assembly.
- **appsscript.json** — Apps Script manifest defining OAuth scopes and runtime config.

**Delivery flow:**
1. Apps Script receives generated newsletter JSON via HTTP POST.
2. `Parser.gs` validates and structures the content.
3. `Render.gs` compiles the HTML email using templates from `Html.gs`.
4. The compiled HTML is sent via Gmail SMTP (MailApp or GmailApp).

---

## GitHub Role

GitHub serves as the source of truth and triggers deployment via webhooks.

- All scripts, templates, and configuration live in the repository.
- Pushes to `main` trigger a GitHub webhook → Hetzner listener → code pull + pipeline execution.
- No SSH keys are stored in GitHub for deployment. No appleboy/SSH actions.
- The `/docs` directory acts as the project's permanent memory system.
- `.clinerules` defines AI behavior and editorial constraints.

**Repository structure:**
```
gahwa-newsletter/
├── .clinerules              # AI behavioral rules
├── .clasp.json              # Apps Script clasp config
├── scripts/                 # Core application scripts
│   ├── Code.gs
│   ├── Claude.gs
│   ├── Render.gs
│   ├── Parser.gs
│   ├── Html.gs
│   ├── Utilities.gs
│   ├── Aggregatenewsletters.js
│   ├── appsscript.json
│   ├── deploy.sh
│   ├── setup_hetzner.sh
│   ├── send_to_apps_script.sh
│   └── clasp_push.py
├── templates/               # Newsletter templates
├── tests/                   # Test suite
│   ├── mockTest.gs
│   ├── test_deepseek_dryrun.py
│   └── test_lead_tracking_api.py
├── output/                  # Generated output artifacts
│   └── redcloud_raid_insight.md
└── docs/                    # Permanent memory system
    ├── architecture.md
    ├── editorial_style.md
    ├── newsletter_prompt.md
    ├── gcc_topics.md
    ├── workflow.md
    ├── deployment.md
    └── changelog.md
```

---

## AI Generation Pipeline

The content generation pipeline operates in three stages:

### Stage 1: Topic Selection
- The AI (Claude/DeepSeek) selects relevant GCC topics from the curated list (`gcc_topics.md`).
- Topics are weighted by current relevance, seasonality, and market events.

### Stage 2: Content Generation
- The master prompt (`newsletter_prompt.md`) is loaded and hydrated with current context.
- DeepSeek API is called from the Hetzner VM using Node.js.
- The AI generates structured JSON output adhering to editorial rules (`editorial_style.md`).

### Stage 3: Parsing & Validation
- Raw JSON output is parsed by `Parser.gs`.
- Content is validated against schema constraints.
- Failed validations trigger regeneration with corrected parameters.

---

## Execution Daemon (Webhook-Driven Deployment)

All execution triggers (GitHub webhooks, cron) route through a persistent **systemd service** (`gahwa-listener.service`) that provides deployment and reliability:

```
GitHub push ──▶ Webhook POST ──▶ gahwa-listener.service (port 3000)
                                      │
                                      ├── Validate: push event + main branch + HMAC sig
                                      ├── git fetch origin main && git reset --hard origin/main
                                      ├── acquireLock() — anti-duplicate
                                      ├── runJob("daily-newsletter") → spawns operator.js
                                      ├── operator.js → DeepSeek → Apps Script
                                      └── releaseLock()

Cron (7 AM) ──▶ Local POST ──────────┘
```

**8 reliability guarantees:**
1. **Execution Lock** — Prevents concurrent runs via `/tmp/gahwa-lock.json` (10 min TTL)
2. **Event Validation** — Only `push` events trigger deployment (not ping, not issues)
3. **Branch Guard** — Non-main branch pushes are silently ignored
4. **Webhook Security** — HMAC-SHA256 signature verification via `GITHUB_WEBHOOK_SECRET`
5. **Retry Mechanism** — Up to 2 retries with 10s delay on failure
6. **Dead Letter Queue** — Failures logged to `logs/failed.json`
7. **Success Log** — Successful runs logged to `logs/success.json`
8. **Lock Cleanup** — Lock ALWAYS released via `try/finally`, even on crash

---

## Delivery Flow

1. **GitHub Push** → Developer pushes to `main` → GitHub sends webhook to Hetzner.
2. **Webhook Received** → Listener validates event type, branch, and HMAC signature.
3. **Code Pull** → `git fetch origin main && git reset --hard origin/main` (deployment).
4. **Lock Acquired** → Prevents concurrent runs.
5. **Generation** → `operator.js` calls DeepSeek API to generate structured newsletter JSON.
6. **Push** → Generated JSON is sent to Apps Script via `pushToAppsScript()`.
7. **Render** → `Parser.gs` structures the content; `Render.gs` builds the HTML email.
8. **Send** → Email is dispatched to the subscriber list via Google Workspace (Gmail).
9. **Log** → Listener logs success to `success.json` or failure to `failed.json`.
10. **Lock Release** → Lock ALWAYS released, even on execution failure.

---

## Local Mac Dependency Removal

The architecture intentionally eliminates reliance on a local macOS development machine for production generation. Here's why and how:

### Why It Was Removed
- **Reliability** — The pipeline no longer depends on a personal machine being powered on and connected at 5:30 AM daily.
- **Scale** — Generation can run independently regardless of developer availability or network status.
- **Consistency** — Hetzner provides a predictable, repeatable environment vs. a local Mac with fluctuating conditions (sleep, updates, network drops).
- **Team access** — Any authorized team member can trigger generation or debug issues via SSH without needing physical access to a specific machine.
- **Cost** — A €5–8/month Hetzner VM replaces the need for a dedicated always-on Mac Mini or equivalent hardware.

### How It Was Achieved
1. All generation scripts were migrated from local execution to the Hetzner VM.
2. Cron replaced manual triggering (e.g., `npm run generate` on a dev machine).
3. GitHub webhooks replace SSH-based CI/CD for deployment.
4. Apps Script web app receives content directly from Hetzner — no local relay server needed.
5. Development remains on local machines; production runs fully event-driven (GitHub webhook → Hetzner → Apps Script).

### Current Local Mac Role
- Development and testing only.
- Dry-run testing of generation scripts before pushing to production.
- Editing prompts, editorial rules, and configuration files.
- No live production dependency.

---

## Architecture Diagram (Text)

```
Developer pushes to main
        │
        ▼
┌──────────────────┐      ┌──────────────────┐
│   GitHub         │─────▶│   Hetzner VM     │
│  (Source of Truth)│     │  (Webhook Svr)   │
│  No SSH deploy   │      │  Port 3000       │
└──────────────────┘      └────────┬─────────┘
                                   │
                                   ▼
                          ┌──────────────────┐
                          │  git pull origin  │
                          │  main (deploy)    │
                          └────────┬─────────┘
                                   │
                                   ▼
                          ┌──────────────────┐     ┌──────────────────┐
                          │  operator.js      │────▶│  DeepSeek API    │
                          │  (AI Generation)  │     │  (Content Gen)   │
                          └────────┬─────────┘     └──────────────────┘
                                   │
                                   ▼
                          ┌──────────────────┐     ┌──────────────────┐
                          │  Apps Script     │────▶│  Gmail /         │
                          │  (Render + Send) │     │  Subscribers     │
                          └──────────────────┘     └──────────────────┘
```
