# The Gahwa — Newsletter Pipeline

## Architecture

```
Developer (edits code in GitHub web editor or Cursor)
        ↓
GitHub repo  ← source of truth for all code
        ↓
Hetzner VPS  ← deployment authority (persistent, authenticated)
        ↓
clasp push   ← runs FROM Hetzner, not from GitHub Actions
        ↓
Google Apps Script  ← runtime target
        ↓
Gmail / Drive / RSS pipeline executes
```

## Pipeline Segments

### 1. Hetzner Ignition (First-Time Setup)

SSH into your Hetzner VPS and run:

```bash
mkdir -p /opt/gahwa && cd /opt/gahwa && \
git clone https://github.com/[YOUR_USERNAME]/gahwa-newsletter.git . && \
chmod +x scripts/*.sh && \
./scripts/setup_hetzner.sh
```

This provisions Node.js, npm, clasp, and clones the repo to `/opt/gahwa`.

### 2. Headless Handshake (Google Auth)

The only time you interact with a browser is to grant the server "The Golden Ticket" (`.clasprc.json`).

```bash
clasp login --no-localhost
```

Copy the URL into your browser, authenticate with the Google account that owns the Apps Script project, and paste the resulting code back into the terminal.

### 3. Set & Forget Automation (Crontab)

Installs the 7:00 AM GCC daily deploy trigger:

```bash
(crontab -l 2>/dev/null; echo "0 7 * * * /bin/bash /opt/gahwa/scripts/deploy.sh >> /opt/gahwa/logs/cron.log 2>&1") | crontab -
```

### 4. GitHub-to-Hetzner Bridge (Actions YAML)

Every push to `main` triggers an SSH into Hetzner → `git pull` → `clasp push`. The workflow file lives at `.github/workflows/deploy.yml`.

### 5. GCC Market Brain (AI Prompt)

The `Claude.gs` prompt is optimized for the Gahwa Brief tone — Morning Brew energy for Saudi/GCC executives. Key directives:
- **Headlines**: Max 6 words, punchy (e.g., "Aramco's AI Pivot")
- **Why it Matters**: 1 sentence on macro GCC impact
- **Tone**: No passive voice, no fluff, business-wit
- **Focus**: KSA Vision 2030, UAE Fintech hubs, regional HORECA trends
- **Output**: Strict JSON following the GAHWA-R scoring framework

### 6. Emergency Deployment

If GitHub is down or you need to force a sync:

```bash
/bin/bash /opt/gahwa/scripts/deploy.sh
```

## Daily Editing Workflow

1. Edit any `.gs` file in the GitHub web editor (or Cursor)
2. Commit to `main`
3. GitHub Actions SSHes into Hetzner
4. Hetzner pulls latest `main` and runs `clasp push`
5. Google Apps Script is updated within ~60 seconds

## GitHub Secrets Required

Add these in GitHub repo **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `HETZNER_HOST` | Hetzner server IP or hostname |
| `HETZNER_USER` | SSH username (e.g. `root`) |
| `HETZNER_SSH_KEY` | Private SSH key for Hetzner access |

> **Note:** `clasp` authentication (`.clasprc.json`) lives on the Hetzner server **ONLY**. GitHub never sees or stores Google credentials.

## Important: Google Auth

- `.clasprc.json` lives on the Hetzner server **ONLY**
- It is gitignored and never committed to GitHub
- If the server is rebuilt, re-run `clasp login --no-localhost`

## Project Structure

```
gahwa-newsletter/
├── .github/workflows/deploy.yml   # GitHub Actions → SSH → Hetzner
├── scripts/
│   ├── setup_hetzner.sh            # One-time Hetzner provisioning
│   ├── deploy.sh                   # Pull + push script (runs on Hetzner)
│   └── clasp_push.py               # clasp push wrapper
├── templates/                      # Email templates
├── Code.gs                         # Main entry point
├── Claude.gs                       # AI API calls (GCC Market Brain prompt)
├── Parser.gs                       # RSS/email parsing
├── Utilities.gs                    # Helper functions
├── Render.gs                       # HTML rendering
├── Html.gs                         # HTML generation
├── Aggregatenewsletters.js         # Newsletter aggregation
├── appsscript.json                 # Apps Script manifest
├── .clasp.json                     # clasp project config (contains project ID)
└── .gitignore
```
