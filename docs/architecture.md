# Gahwa Newsletter — Architecture

> Last updated: 2026-05-07

## Overview

Gahwa Newsletter is an AI-powered GCC business newsletter engine, inspired by Morning Brew. It automates the generation, rendering, and delivery of a daily B2B newsletter focused on Saudi Arabian and GCC markets.

The architecture follows a lean editorial pipeline with three core infrastructure layers:

1. **AI Generation** — DeepSeek via Hetzner
2. **Rendering & Delivery** — Google Apps Script
3. **Orchestration & Storage** — GitHub

---

## Hetzner Role

Hetzner provides the compute layer for running AI generation workloads.

- A Linux VM hosts the newsletter generation scripts.
- The VM runs scheduled cron jobs to trigger daily newsletter generation.
- Python scripts orchestrate calls to the DeepSeek API for content generation.
- The VM is lightweight (CX22 or equivalent), costing ~€5–8/month.
- No database is hosted on Hetzner; output is pushed directly to Apps Script.
- SSH keys are used for secure access; no persistent secrets are stored on disk.

**Key scripts running on Hetzner:**
- `scripts/setup_hetzner.sh` — Initial VM provisioning
- `scripts/deploy.sh` — Deployment orchestration
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

GitHub serves as the source of truth, CI/CD pipeline, and collaboration layer.

- All scripts, templates, and configuration live in the repository.
- GitHub Actions (`.github/workflows/deploy.yml`) automates deployment.
- Changes to `main` trigger automatic deployment to Hetzner and Apps Script.
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
- DeepSeek API is called from the Hetzner VM using Python.
- The AI generates structured JSON output adhering to editorial rules (`editorial_style.md`).

### Stage 3: Parsing & Validation
- Raw JSON output is parsed by `Parser.gs`.
- Content is validated against schema constraints.
- Failed validations trigger regeneration with corrected parameters.

---

## Delivery Flow

1. **Cron Trigger** → Hetzner VM cron job fires at scheduled time (e.g., 6:00 AM SAST).
2. **Generation** → Python script calls DeepSeek API with the master prompt.
3. **Push** → Generated JSON is sent to Apps Script via `send_to_apps_script.sh`.
4. **Render** → `Parser.gs` structures the content; `Render.gs` builds the HTML email.
5. **Send** → Email is dispatched to the subscriber list via Google Workspace (Gmail).
6. **Log** → Delivery status and metrics are logged for performance tracking.

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
3. GitHub Actions handles CI/CD from a central location, not a local workstation.
4. Apps Script web app receives content directly from Hetzner — no local relay server needed.
5. Development remains on local machines; production runs fully serverless (Hetzner + Apps Script + GitHub).

### Current Local Mac Role
- Development and testing only.
- Dry-run testing of generation scripts before pushing to production.
- Editing prompts, editorial rules, and configuration files.
- No live production dependency.

---

## Architecture Diagram (Text)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Hetzner VM │────▶│  DeepSeek    │────▶│  Apps Script     │
│  (Cron Job)  │     │  API (AI)    │     │  (Render + Send) │
└──────────────┘     └──────────────┘     └────────┬─────────┘
                                                   │
                                                   ▼
                                           ┌──────────────────┐
                                           │  Gmail /         │
                                           │  Subscribers     │
                                           └──────────────────┘
                           ┌──────────────────────────────────────┐
                           │         GitHub (Source of Truth)     │
                           │  ┌──────┐ ┌──────┐ ┌─────────────┐  │
                           │  │Actions│ │Scripts│ │  /docs      │  │
                           │  └──────┘ └──────┘ └─────────────┘  │
                           └──────────────────────────────────────┘
```
