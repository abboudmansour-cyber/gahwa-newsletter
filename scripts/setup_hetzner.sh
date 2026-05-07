#!/bin/bash
set -e

echo "=== Hetzner Setup for The Gahwa (Daily Autopilot) ==="

# Usage: ./setup_hetzner.sh [github-username]
# If no username provided, prompt for it
GITHUB_USER="${1:-}"
if [ -z "$GITHUB_USER" ]; then
  read -p "Enter your GitHub username: " GITHUB_USER
fi

if [ -z "$GITHUB_USER" ]; then
  echo "ERROR: GitHub username is required."
  echo "Usage: $0 <github-username>"
  exit 1
fi

REPO_URL="https://github.com/${GITHUB_USER}/gahwa-newsletter.git"

# Install dependencies
apt-get update -qq
apt-get install -y nodejs npm git curl jq

# Install clasp globally
npm install -g @google/clasp

# Create directories
mkdir -p /opt/gahwa/logs
mkdir -p /opt/gahwa-newsletter/operator/output
mkdir -p /opt/gahwa-newsletter/operator/logs

# Clone the repo
if [ -d "/opt/gahwa-newsletter/.git" ]; then
  echo "Repo already exists at /opt/gahwa-newsletter — pulling latest..."
  cd /opt/gahwa-newsletter
  git pull origin main
elif [ -d "/opt/gahwa/.git" ]; then
  echo "Repo found at legacy /opt/gahwa — migrating to /opt/gahwa-newsletter..."
  cd /opt/gahwa
  git remote set-url origin "${REPO_URL}"
  git pull origin main || true
  cd /opt/gahwa-newsletter 2>/dev/null || {
    git clone "${REPO_URL}" /opt/gahwa-newsletter
  }
  # Migrate any existing configs
  if [ -f /opt/gahwa/config.env ]; then
    cp /opt/gahwa/config.env /opt/gahwa-newsletter/operator/.env
  fi
else
  echo "Cloning ${REPO_URL}..."
  git clone "${REPO_URL}" /opt/gahwa-newsletter
  cd /opt/gahwa-newsletter
fi

# Install Node dependencies for operator
cd /opt/gahwa-newsletter/operator
npm install

# Make scripts executable
chmod +x /opt/gahwa-newsletter/scripts/*.sh

# ── Production Hardening ──────────────────────────────────────────────

# 1. Log rotation for /opt/gahwa-newsletter/operator/logs
cat > /etc/logrotate.d/gahwa << 'LOGEOF'
/opt/gahwa-newsletter/operator/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 root root
}
LOGEOF
echo "✅ Logrotate config installed"

# 2. Secure environment file
if [ -f /opt/gahwa-newsletter/operator/.env ]; then
  chmod 600 /opt/gahwa-newsletter/operator/.env
  echo "✅ Existing .env secured"
else
  cp /opt/gahwa-newsletter/operator/env.hetzner.template /opt/gahwa-newsletter/operator/.env
  chmod 600 /opt/gahwa-newsletter/operator/.env
  echo "⚠️  WARNING: Created .env from template. EDIT IT NOW with real values:"
  echo "   vi /opt/gahwa-newsletter/operator/.env"
fi

# 3. Generate unique Webhook Secret (if not already set)
if grep -q "your-webhook-secret" /opt/gahwa-newsletter/operator/.env 2>/dev/null; then
  SECRET=$(openssl rand -hex 24)
  sed -i "s/WEBHOOK_SECRET=.*/WEBHOOK_SECRET=${SECRET}/" /opt/gahwa-newsletter/operator/.env
  echo "✅ Webhook Secret generated: ${SECRET}"
fi

# 4. SSH Key setup for GitHub push
if [ ! -f ~/.ssh/id_ed25519 ]; then
  echo "🔑 Generating SSH key for GitHub deploy..."
  ssh-keygen -t ed25519 -C "gahwa-hetzner-$(hostname)" -f ~/.ssh/id_ed25519 -N ""
  echo ""
  echo "⚠️  ADD THIS SSH KEY TO YOUR GITHUB DEPLOY KEYS:"
  cat ~/.ssh/id_ed25519.pub
  echo ""
  echo "   Go to: https://github.com/${GITHUB_USER}/gahwa-newsletter/settings/keys"
  echo "   Add as deploy key with write access."
else
  echo "✅ SSH key exists at ~/.ssh/id_ed25519"
fi

# 5. Configure git for the repo
cd /opt/gahwa-newsletter
git config user.email "gahwa-bot@hetzner.local"
git config user.name "Gahwa Daily Bot"
git remote set-url origin git@github.com:${GITHUB_USER}/gahwa-newsletter.git

# ── Cron Installation ──────────────────────────────────────────────────

echo ""
echo "=== Installing Daily Cron ==="

# Remove any old cron entries
(crontab -l 2>/dev/null | grep -v "gahwa-newsletter" | grep -v "daily-runner" | grep -v "operator.js") | crontab - 2>/dev/null || true

# Install new cron: runs at 7:00 AM Saudi time (UTC+3)
CRON_LINE="0 7 * * * cd /opt/gahwa-newsletter && /usr/bin/node /opt/gahwa-newsletter/operator/daily-runner.js >> /opt/gahwa-newsletter/operator/logs/cron-daily.log 2>&1"

(crontab -l 2>/dev/null; echo "${CRON_LINE}") | crontab -

echo "✅ Cron installed: 0 7 * * * (7:00 AM daily)"
echo "   Command: cd /opt/gahwa-newsletter && node operator/daily-runner.js"

# ── Test Config File ───────────────────────────────────────────────────

# Create a test config file that the daily-runner can use for validation
cat > /opt/gahwa-newsletter/operator/output/.test-config.json << 'TESTEOF'
{
  "test": true,
  "config_path": "/opt/gahwa-newsletter/operator/.env",
  "node_version": "20+",
  "scripts": [
    "operator/daily-runner.js",
    "operator/deepseek.js",
    "operator/github.js",
    "operator/operator.js"
  ]
}
TESTEOF

echo "✅ Test config written"

# ── Final Summary ──────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         GAHWA DAILY AUTOPILOT — SETUP COMPLETE              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "REPO:    /opt/gahwa-newsletter"
echo "OUTPUT:  /opt/gahwa-newsletter/operator/output/latest-newsletter.json"
echo "LOGS:    /opt/gahwa-newsletter/operator/logs/daily-errors.log"
echo "CRON:    0 7 * * * (7:00 AM AST)"
echo ""
echo "REQUIRED MANUAL STEPS:"
echo ""
echo "1. EDIT .env with your real API keys:"
echo "   vi /opt/gahwa-newsletter/operator/.env"
echo ""
echo "2. Add SSH deploy key to GitHub:"
echo "   cat ~/.ssh/id_ed25519.pub"
echo "   → https://github.com/${GITHUB_USER}/gahwa-newsletter/settings/keys"
echo ""
echo "3. Test the pipeline:"
echo "   cd /opt/gahwa-newsletter && node operator/daily-runner.js --dry-run"
echo ""
echo "4. Verify crontab:"
echo "   crontab -l"
echo ""
echo "5. For Apps Script webhook integration:"
echo "   - Deploy your Apps Script project as a Web App"
echo "   - Set APPS_SCRIPT_WEBHOOK_URL in /opt/gahwa-newsletter/operator/.env"
echo "   - Run storeSecrets() in Apps Script with WEBHOOK_SECRET value below"
echo ""
echo "WEBHOOK_SECRET: $(grep WEBHOOK_SECRET /opt/gahwa-newsletter/operator/.env | cut -d= -f2)"
echo ""
echo "=== Setup complete. The system will run autonomously at 7 AM daily. ==="
