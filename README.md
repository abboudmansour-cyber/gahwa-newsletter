# The Gahwa — Newsletter Pipeline

## Architecture

```
Developer (edits code in GitHub web editor or Cursor)
        ↓
GitHub repo  ← source of truth for all code
        ↓
GitHub Webhook (HTTP POST — no SSH)
        ↓
Hetzner VPS  ← deployment authority (persistent listener on port 3000)
        ↓
git pull origin main  ← triggered by webhook
        ↓
operator.js runs → DeepSeek API → newsletter JSON
        ↓
clasp push / HTTP POST to Apps Script
        ↓
Google Apps Script  ← runtime target
        ↓
Gmail / Drive / RSS pipeline executes
```

**No SSH from GitHub. No appleboy/SSH Actions. No SSH keys in CI.**

---

## Pipeline Segments

### 1. Hetzner Ignition (First-Time Setup)

SSH into your Hetzner VPS (direct access, not from CI) and run:

```bash
mkdir -p /opt/gahwa && cd /opt/gahwa && \
git clone https://github.com/[YOUR_USERNAME]/gahwa-newsletter.git . && \
chmod +x scripts/*.sh && \
./scripts/setup_hetzner.sh
```

This provisions Node.js, npm, clasp, the webhook listener daemon, and cron.

### 2. Headless Handshake (Google Auth)

The only time you interact with a browser is to grant the server "The Golden Ticket" (`.clasprc.json`).

```bash
clasp login --no-localhost
```

Copy the URL into your browser, authenticate with the Google account that owns the Apps Script project, and paste the resulting code back into the terminal.

### 3. Set & Forget Automation (Cron + Webhook)

- **Cron:** 7:00 AM daily trigger via local POST to the webhook listener.
- **Webhook:** Every push to `main` triggers an HTTP POST from GitHub to the Hetzner listener.
- The listener handles locking, git pull, operator execution, and logging.

### 4. GitHub-to-Hetzner Bridge (Webhook)

Every push to `main` sends a GitHub webhook → Hetzner listener → `git pull` → `operator.js` execution.

Configure the webhook in GitHub repo **Settings → Webhooks → Add webhook**:

| Field | Value |
|---|---|
| Payload URL | `http://<HETZNER_IP>:3000/webhook` |
| Content type | `application/json` |
| Secret | `GITHUB_WEBHOOK_SECRET` from `operator/.env` |
| Events | Just the push event |

### 5. GCC Market Brain (AI Prompt)

The `Claude.gs` prompt is optimized for the Gahwa Brief tone — Morning Brew energy for Saudi/GCC executives. Key directives:
- **Headlines**: Max 6 words, punchy (e.g., "Aramco's AI Pivot")
- **Why it Matters**: 1 sentence on macro GCC impact
- **Tone**: No passive voice, no fluff, business-wit
- **Focus**: KSA Vision 2030, UAE Fintech hubs, regional HORECA trends
- **Output**: Strict JSON following the GAHWA-R scoring framework

### 6. Emergency Deployment

If GitHub webhooks are unavailable or you need to force a sync:

```bash
# On the Hetzner VM directly:
cd /opt/gahwa-newsletter
git pull origin main
node operator/server.js --once --job=daily-newsletter
```

---

## Daily Editing Workflow

1. Edit any `.gs` or `.js` file in the GitHub web editor (or Cursor)
2. Commit to `main`
3. GitHub sends webhook to Hetzner listener
4. Hetzner pulls latest `main` and runs `operator.js`
5. Google Apps Script is updated within ~60 seconds

---

## GitHub Configuration

### Webhook (Required — Replaces SSH Deployment)

Configure in **Settings → Webhooks → Add webhook** as described above.

### GitHub Secrets (No Longer Needed for Deployment)

The following secrets were previously required for SSH deployment and are **now obsolete**:

~~`HETZNER_SSH_KEY`~~ — SSH private key for Hetzner (no longer in CI)
~~`HETZNER_HOST`~~ — Hetzner server IP (no longer in CI)
~~`HETZNER_USER`~~ — SSH username (no longer in CI)

These can be removed from GitHub Secrets. The Hetzner server now pulls code using its own deploy key.

> **Note:** `clasp` authentication (`.clasprc.json`) lives on the Hetzner server **ONLY**. GitHub never sees or stores Google credentials.

---

## Important: Google Auth

- `.clasprc.json` lives on the Hetzner server **ONLY**
- It is gitignored and never committed to GitHub
- If the server is rebuilt, re-run `clasp login --no-localhost`

---

## Project Structure

```
gahwa-newsletter/
├── .github/workflows/deploy.yml   # CI only (no SSH, no deploy)
├── scripts/
│   ├── setup_hetzner.sh            # One-time Hetzner provisioning
│   ├── deploy.sh                   # Newsletter generation orchestrator
│   └── clasp_push.py               # clasp push wrapper
├── operator/                       # Webhook listener & pipeline
│   ├── server.js                   # HTTP webhook listener (port 3000)
│   └── operator.js                 # AI generation pipeline
├── templates/                      # Email templates
├── scripts/                        # Apps Script source files
│   ├── Code.gs                     # Main entry point
│   ├── Claude.gs                   # AI API calls
│   ├── Parser.gs                   # RSS/email parsing
│   ├── Utilities.gs                # Helper functions
│   ├── Render.gs                   # HTML rendering
│   ├── Html.gs                     # HTML generation
│   ├── Aggregatenewsletters.js     # Newsletter aggregation
│   └── appsscript.json             # Apps Script manifest
├── docs/                           # Permanent memory system
└── .github/workflows/deploy.yml    # CI only workflow
```
