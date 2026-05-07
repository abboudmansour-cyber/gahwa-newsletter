# Gahwa Newsletter — Deployment Guide

> Last updated: 2026-05-07

## Overview

Gahwa Newsletter uses a three-layer deployment strategy:
1. **Hetzner VM** — Compute and AI generation
2. **Google Apps Script** — Rendering and delivery
3. **GitHub Actions** — CI/CD automation

This document covers the setup, configuration, and deployment steps for each layer.

---

## Hetzner Setup

### Provisioning

The Hetzner VM is provisioned using `scripts/setup_hetzner.sh`. This script:

1. Updates the system packages.
2. Installs Python 3, pip, git, curl, and jq.
3. Clones the repository from GitHub.
4. Sets up Python virtual environment and installs dependencies.
5. Configures cron jobs for daily generation.
6. Sets up log rotation for newsletter generation logs.

**To provision a new VM:**

```bash
# SSH into the Hetzner VM
ssh root@<hetzner-ip>

# Run the setup script
bash /home/user/gahwa-newsletter/scripts/setup_hetzner.sh
```

### VM Specifications

| Spec | Value |
|---|---|
| Provider | Hetzner |
| Plan | CX22 (2 vCPU, 4 GB RAM) |
| Storage | 40 GB SSD |
| OS | Ubuntu 22.04 LTS |
| Cost | ~€5–8/month |
| Backup | Weekly snapshot (optional, ~€1/month) |

### SSH Key Management

- SSH keys are used for all access (password authentication disabled).
- The deployment SSH key is stored as a GitHub secret (`HETZNER_SSH_KEY`).
- No persistent secrets are stored on the VM filesystem.
- API keys are injected as environment variables at runtime.

### Cron Configuration

Cron is configured at `/etc/cron.d/gahwa-newsletter`:

```
30 5 * * 1-6 root /home/user/gahwa-newsletter/scripts/deploy.sh generate >> /var/log/gahwa.log 2>&1
```

To modify: SSH into the VM and edit the file directly, then update this document.

---

## GitHub Integration

### Repository Configuration

The repository at `gahwa-newsletter` is the single source of truth. All deployment artifacts originate from the `main` branch.

### GitHub Secrets

The following secrets must be configured in the repository:

| Secret | Purpose |
|---|---|
| `HETZNER_SSH_KEY` | SSH private key for Hetzner VM access |
| `HETZNER_HOST` | IP address or hostname of Hetzner VM |
| `HETZNER_USER` | SSH username (typically `root` or `user`) |
| `APPS_SCRIPT_TOKEN` | Access token for Apps Script API |
| `DEEPSEEK_API_KEY` | API key for DeepSeek content generation |
| `CLASP_JSON` | Content of `.clasp.json` for Apps Script push |

### GitHub Actions Workflow

The CI/CD pipeline is defined in `.github/workflows/deploy.yml`:

**Trigger:** Push to `main` branch.

**Workflow stages:**
1. Checkout repository.
2. Install dependencies.
3. Run tests (`tests/test_deepseek_dryrun.py`, `tests/test_lead_tracking_api.py`).
4. Deploy scripts to Hetzner VM (rsync via SSH).
5. Push Apps Script changes using clasp (`clasp_push.py`).
6. Verify deployment health.

### Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Production-ready code. All deployments from here. |
| `develop` | Feature development and testing. |
| `feature/*` | Individual feature branches. |

---

## Apps Script Integration

### Project Setup

The Apps Script project is managed using [clasp](https://github.com/google/clasp) (Command Line Apps Script Projects).

**Configuration files:**
- `.clasp.json` — Project configuration (script ID, root directory).
- `scripts/appsscript.json` — App manifest (OAuth scopes, runtime, timezone).

### OAuth Scopes

Defined in `appsscript.json`:

```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```

### clasp Usage

**Common commands:**

```bash
# Login to Google Account
clasp login

# Create a new Apps Script project
clasp create --type webapp --title "Gahwa Newsletter"

# Push local changes to Apps Script
clasp push

# Pull remote changes locally
clasp pull

# Open the Apps Script project in a browser
clasp open

# Deploy a new version
clasp deploy --description "v1.2.3 - Updated render logic"
```

### Automated Push via Python

The `scripts/clasp_push.py` script automates the push process:

```bash
python3 scripts/clasp_push.py
```

This script:
1. Validates the `.clasp.json` configuration.
2. Runs `clasp push` to sync local scripts to Apps Script.
3. Creates a new deployment version.
4. Verifies the deployment is active.

### Web App Deployment

The Apps Script project is deployed as a Web App to receive generated newsletter content:

- **Execute as**: Me (the script owner)
- **Who has access**: Anyone (authenticated requests with token)

The Web App URL is set as the `APPS_SCRIPT_URL` in the Hetzner VM environment.

---

## Deployment Steps

### Full Deployment (Git → Hetzner + Apps Script)

1. **Push code changes** to `main` on GitHub.
   ```bash
   git checkout main
   git merge develop
   git push origin main
   ```

2. **GitHub Actions** automatically triggers:
   - Runs test suite.
   - RSyncs scripts to Hetzner VM.
   - Runs `clasp_push.py` to update Apps Script.

3. **Verify deployment**:
   - Check GitHub Actions log for success.
   - SSH into Hetzner and verify script versions.
   - Run a test generation: `./scripts/deploy.sh generate --test`

### Hetzner-Only Deployment

If only the generation pipeline changes (no Apps Script changes):

```bash
# From local machine
./scripts/deploy.sh --hetzner-only
```

Or manually via SSH:
```bash
ssh root@<hetzner-ip>
cd /home/user/gahwa-newsletter
git pull origin main
./scripts/setup_hetzner.sh --update-only
```

### Apps Script-Only Deployment

If only rendering/delivery logic changes (no generation changes):

```bash
# From local machine
./scripts/deploy.sh --apps-script-only
```

Or manually:
```bash
python3 scripts/clasp_push.py
```

### Initial Setup for New Developers

```bash
# 1. Clone the repository
git clone git@github.com:yourusername/gahwa-newsletter.git
cd gahwa-newsletter

# 2. Install clasp globally
npm install -g @google/clasp

# 3. Login to Google
clasp login

# 4. Pull the existing Apps Script project
clasp pull

# 5. Verify by running a test
python3 -m pytest tests/test_deepseek_dryrun.py
```

---

## Rollback Procedure

If a deployment introduces issues:

### Rollback Hetzner VM
```bash
ssh root@<hetzner-ip>
# Revert to the previous commit
cd /home/user/gahwa-newsletter
git checkout <previous-stable-commit>
# Restart cron or manually run generation
```

### Rollback Apps Script
```bash
# List deployments to find the previous version ID
clasp deployments

# Rollback to a specific version
clasp deploy --version-number <version> --description "Rollback to v<version>"
```

---

## Monitoring & Health Checks

### Logging

- **Generation logs**: `/var/log/gahwa.log` on Hetzner VM
- **Delivery logs**: Google Sheets (referenced by `Utilities.gs`)
- **GitHub Actions logs**: Available in the Actions tab on GitHub

### Health Check Endpoints

The Apps Script web app exposes a health check endpoint:

```
GET <APPS_SCRIPT_URL>/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-05-07T06:00:00Z",
  "last_generation": "2026-05-06",
  "edition_count": 141
}
```

### Alerting

- Generation failures trigger an email alert to the admin.
- CI/CD pipeline failures send a notification via GitHub.
- Monthly log review for systemic issues.
