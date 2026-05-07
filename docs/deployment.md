# Gahwa Newsletter — Deployment Guide

> Last updated: 2026-05-07
> Deployment model: **Event-driven webhook (no SSH from GitHub)**

## Overview

Gahwa Newsletter uses a fully event-driven deployment model:

1. **GitHub push** → triggers webhook to Hetzner
2. **Hetzner VM** — Receives webhook, pulls code, runs AI generation
3. **Google Apps Script** — Rendering and delivery

**Key design decision:** GitHub Actions no longer SSHes into anything. Deployment is driven entirely by GitHub webhooks → Hetzner listener.

---

## Architecture

```
Developer pushes to main
        ↓
GitHub sends webhook (HTTP POST)
        ↓
Hetzner listener (port 3000) receives webhook
        ↓
Validates: push event + main branch + HMAC signature
        ↓
git pull origin main (deployment)
        ↓
Runs operator.js daily-newsletter
        ↓
Sends generated content to Apps Script
```

---

## Hetzner Setup

### Provisioning

The Hetzner VM is provisioned using `scripts/setup_hetzner.sh`:

```bash
# On the Hetzner VM
bash /opt/gahwa-newsletter/scripts/setup_hetzner.sh
```

This script:
1. Updates system packages
2. Installs Node.js, npm, git, curl, jq
3. Clones the repository from GitHub
4. Installs Node.js operator dependencies
5. Installs the `gahwa-listener` systemd service
6. Configures cron for daily 7:00 AM trigger
7. Sets up log rotation

### VM Specifications

| Spec | Value |
|---|---|
| Provider | Hetzner |
| Plan | CX22 (2 vCPU, 4 GB RAM) |
| Storage | 40 GB SSD |
| OS | Ubuntu 22.04 LTS |
| Cost | ~€5–8/month |
| Backup | Weekly snapshot (optional, ~€1/month) |

### Git Authentication on Hetzner

The Hetzner server needs **its own SSH deploy key** (not from GitHub Actions) to pull code:

```bash
# On the Hetzner VM
cd /opt/gahwa-newsletter
git remote set-url origin git@github.com:abboudmansour-cyber/gahwa-newsletter.git

# If no SSH key exists yet, generate one:
ssh-keygen -t ed25519 -C "gahwa-hetzner-deploy"
cat ~/.ssh/id_ed25519.pub
# → Add this key as a deploy key in GitHub repo Settings → Deploy Keys
```

### Cron Configuration

Cron triggers the local listener (not direct operator execution):

```
0 7 * * * curl -s -X POST http://127.0.0.1:3000/webhook \
  -H 'Content-Type: application/json' \
  -d '{"job":"daily-newsletter","trigger":"cron"}' \
  >> /opt/gahwa-newsletter/operator/logs/cron-daily.log 2>&1
```

---

## GitHub Webhook Configuration

### Webhook Setup

Configure in GitHub repo **Settings → Webhooks → Add webhook**:

| Field | Value |
|---|---|
| **Payload URL** | `http://<HETZNER_IP>:3000/webhook` |
| **Content type** | `application/json` |
| **Secret** | Match `GITHUB_WEBHOOK_SECRET` in `operator/.env` |
| **Events** | **Just the push event** (uncheck everything else) |
| **Active** | ✅ Yes |

### Webhook Payload Processing

When the server receives a push webhook:

1. **Validate event:** Must be `push` (other events like `ping` are ignored)
2. **Validate branch:** Must be `main` — pushes to other branches are silently ignored
3. **Verify signature:** HMAC-SHA256 against `GITHUB_WEBHOOK_SECRET`
4. **Acquire lock:** Prevents concurrent runs
5. **Git pull:** `git fetch origin main && git reset --hard origin/main`
6. **Run operator:** `node operator/operator.js daily-newsletter`
7. **Release lock**

### HMAC Signature Verification

The server validates every webhook payload using HMAC-SHA256:

```bash
# On Hetzner, generate a secret:
openssl rand -hex 32

# Set in operator/.env:
GITHUB_WEBHOOK_SECRET=your-32-byte-hex-secret

# Enter the same secret in GitHub:
# Repo Settings → Webhooks → (your webhook) → Secret
```

Without a configured secret, the server logs a warning and allows requests. For production, always set the secret.

---

## GitHub Actions (CI Only)

The workflow at `.github/workflows/deploy.yml` now does **NO deployment**. It only runs:

- Code checkout
- Dependency install (`npm ci`)
- Test suite (optional, continue-on-error)
- Module validation

**No SSH keys, no appleboy action, no known_hosts, no remote login.**

---

## Apps Script Integration

### Project Setup

The Apps Script project is managed using [clasp](https://github.com/google/clasp) (Command Line Apps Script Projects).

**Configuration files:**
- `.clasp.json` — Project configuration (script ID, root directory).
- `scripts/appsscript.json` — App manifest (OAuth scopes, runtime, timezone).

### Automated Push via Python

The `scripts/clasp_push.py` script automates the push process. It runs on the Hetzner VM (triggered by the operator pipeline):

```bash
cd /opt/gahwa-newsletter
python3 scripts/clasp_push.py
```

---

## Execution Daemon (Listener)

The `gahwa-listener.service` is a persistent systemd service listening on port 3000.

### Service Management

```bash
# View status
systemctl status gahwa-listener

# Restart after code update (if needed)
systemctl restart gahwa-listener

# View logs
journalctl -u gahwa-listener -f
tail -f /opt/gahwa-newsletter/operator/logs/listener-stdout.log
tail -f /opt/gahwa-newsletter/operator/logs/listener-stderr.log
```

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhook` | GitHub webhook receiver (triggers deployment + pipeline) |
| POST | `/trigger` | Alias for `/webhook` |
| GET | `/health` | Health check (lock status, log counts, uptime) |
| GET | `/status` | Execution status (lock, PID) |

### Manual Trigger

```bash
# Trigger the full pipeline
curl -X POST http://<HETZNER_IP>:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"job":"daily-newsletter"}'

# One-off execution (bypasses HTTP server)
node /opt/gahwa-newsletter/operator/server.js --once --job=daily-newsletter
```

---

## Safety & Reliability

| Feature | Description |
|---|---|
| **Execution Lock** | `/tmp/gahwa-lock.json` prevents concurrent runs (10-min TTL) |
| **Branch Guard** | Pushes to non-main branches are silently ignored |
| **Event Filter** | Only `push` events trigger deployment |
| **HMAC Verification** | Optional SHA-256 signature validation via `GITHUB_WEBHOOK_SECRET` |
| **Retry Mechanism** | Up to 2 retries with 10s delay on operator failure |
| **Dead Letter Queue** | Failed runs logged to `logs/failed.json` |
| **Lock Cleanup** | Lock ALWAYS released via `try/finally`, even on crash |
| **Trigger Logging** | All webhook receipts logged with pusher, commit, branch |
| **Invalid Payload Rejection** | Malformed JSON returns HTTP 400 |

---

## Rollback Procedure

If a deployment introduces issues:

```bash
# SSH into Hetzner (direct access, NOT from GitHub Actions)
ssh root@<hetzner-ip>

# Revert to the previous commit
cd /opt/gahwa-newsletter
git checkout <previous-stable-commit>

# Restart the listener
systemctl restart gahwa-listener
```

### Rollback Apps Script

```bash
# List deployments to find the previous version ID
clasp deployments

# Rollback to a specific version
clasp deploy --version-number <version> --description "Rollback to v<version>"
```

---

## Environment Variables

Configured in `/opt/gahwa-newsletter/operator/.env`:

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | API key for DeepSeek content generation |
| `APPS_SCRIPT_WEBHOOK_URL` | URL for pushing content to Apps Script |
| `WEBHOOK_SECRET` | Auth token for Apps Script webhook |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for GitHub webhook verification |
| `LISTENER_PORT` | Listener port (default: 3000) |

---

## Resulting Flow

```
GitHub push to main
        ↓
GitHub sends webhook POST → http://<hetzner>:3000/webhook
        ↓
server.js validates: push event + main branch + HMAC sig
        ↓
git fetch origin main && git reset --hard origin/main
        ↓
acquireLock() — prevent concurrent runs
        ↓
runJob("daily-newsletter") → spawns operator.js
        ↓
operator.js calls DeepSeek → generates newsletter JSON
        ↓
Pushes content to Apps Script webhook → email delivery
        ↓
releaseLock()
        ↓
Respond 200/500 to GitHub with full execution report
```

**No SSH from GitHub. No appleboy. No known_hosts. No secret SSH keys in CI.**
