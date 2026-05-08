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

# ── Generate webhook secret ──────────────────────────────────────────────
# Generate a random 24-byte hex key for WEBHOOK_SECRET
SECRET=$(openssl rand -hex 24)
echo "🔑 Generated WEBHOOK_SECRET: ${SECRET}"

# ── Configure .env ──────────────────────────────────────────────────────────
# Enable WEBHOOK_SECRET (commented out by default) and set it
# First check if APPS_SCRIPT_WEBHOOK_URL needs to be set
if grep -q "APPS_SCRIPT_WEBHOOK_URL=your-webhook-url" /opt/gahwa-newsletter/operator/.env 2>/dev/null; then
  echo "⚠️  APPS_SCRIPT_WEBHOOK_URL is not set. Edit operator/.env and add it."
  echo "   See operator/env.hetzner.template for reference."
fi

# Enable WEBHOOK_SECRET (it's REQUIRED — uncomment and set it)
sed -i "s/^# WEBHOOK_SECRET=.*/WEBHOOK_SECRET=${SECRET}/" /opt/gahwa-newsletter/operator/.env 2>/dev/null || true
sed -i "s/^WEBHOOK_SECRET=.*/WEBHOOK_SECRET=${SECRET}/" /opt/gahwa-newsletter/operator/.env 2>/dev/null || true
echo "✅ WEBHOOK_SECRET configured in operator/.env"

# ── Set up GitHub credentials ──────────────────────────────────────────────
# Generate SSH deploy key (no passphrase)
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "gahwa-operator" 2>/dev/null || true
echo ""
echo "============================================"
echo "🔑 SSH PUBLIC KEY (add to GitHub Deploy Keys)"
echo "============================================"
cat ~/.ssh/id_ed25519.pub
echo "============================================"
echo ""

# ── GitHub Credentials ──────────────────────────────────────────────────────
if [ -f /opt/gahwa-newsletter/operator/.env ]; then
  # Extract GIT_USER_NAME and GIT_USER_EMAIL from .env
  GIT_USER=$(grep "^GIT_USER_NAME=" /opt/gahwa-newsletter/operator/.env | cut -d= -f2)
  GIT_EMAIL=$(grep "^GIT_USER_EMAIL=" /opt/gahwa-newsletter/operator/.env | cut -d= -f2)

  git config --global user.name "${GIT_USER:-Gahwa Operator}"
  git config --global user.email "${GIT_EMAIL:-operator@gahwa.ai}"

  # Check for GitHub token (optional, SSH is preferred)
  GH_TOKEN=$(grep "^GITHUB_TOKEN=" /opt/gahwa-newsletter/operator/.env | cut -d= -f2)
  if [ -n "$GH_TOKEN" ] && [ "$GH_TOKEN" != "ghp_your-github-token-here" ]; then
    echo "✅ GitHub token configured in .env"
  fi
fi

# ── Apps Script (clasp) login ────────────────────────────────────────────────
echo ""
echo "📋 NEXT STEPS:"
echo "────────────────────────────────────────────────"
echo "1. Log in to Apps Script (required for clasp push):"
echo "   cd /opt/gahwa-newsletter && clasp login"
echo ""
echo "2. Push the Apps Script code:"
echo "   cd /opt/gahwa-newsletter && clasp push"
echo ""

# ── Setup systemd service for continuous operation ──────────────────────────
# Create a systemd timer to run daily at 7 AM AST
SYSTEMD_SERVICE="/etc/systemd/system/gahwa-daily.service"
if [ ! -f "$SYSTEMD_SERVICE" ]; then
  cat > "$SYSTEMD_SERVICE" << 'SERVICEEOF'
[Unit]
Description=Gahwa Daily Newsletter Generator
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/node /opt/gahwa-newsletter/operator/daily-runner.js
WorkingDirectory=/opt/gahwa-newsletter
Environment=NODE_ENV=production
User=root
Group=root

[Install]
WantedBy=multi-user.target
SERVICEEOF
  echo "✅ Systemd service created: gahwa-daily.service"
fi

SYSTEMD_TIMER="/etc/systemd/system/gahwa-daily.timer"
if [ ! -f "$SYSTEMD_TIMER" ]; then
  cat > "$SYSTEMD_TIMER" << 'TIMEREOF'
[Unit]
Description=Gahwa Daily Newsletter Timer — runs at 7 AM AST daily

[Timer]
OnCalendar=*-*-* 07:00:00 Asia/Riyadh
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF
  echo "✅ Systemd timer created: gahwa-daily.timer (7:00 AM AST daily)"
fi

systemctl daemon-reload 2>/dev/null || true
systemctl enable gahwa-daily.timer 2>/dev/null || true
systemctl start gahwa-daily.timer 2>/dev/null || true

# Legacy crontab fallback (for systems without systemd)
CRON_EXISTS=$(crontab -l 2>/dev/null | grep "daily-runner" || true)
if [ -z "$CRON_EXISTS" ]; then
  (crontab -l 2>/dev/null; echo "0 7 * * * cd /opt/gahwa-newsletter && /usr/bin/node /opt/gahwa-newsletter/operator/daily-runner.js >> /opt/gahwa-newsletter/operator/logs/cron.log 2>&1") | crontab -
  echo "✅ Crontab entry added (7:00 AM AST daily)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║           ✅ HETZNER SETUP COMPLETE                              ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "═══════════════════════════════════════════════"
echo "📋 SETUP SUMMARY"
echo "═══════════════════════════════════════════════"
echo ""
echo "📁 Project:  /opt/gahwa-newsletter"
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
echo "4. Verify systemd timer or crontab:"
echo "   systemctl status gahwa-daily.timer"
echo "   crontab -l"
echo ""
echo "5. For Apps Script webhook integration:"
echo "   - Deploy your Apps Script project as a Web App"
echo "   - Set APPS_SCRIPT_WEBHOOK_URL in /opt/gahwa-newsletter/operator/.env"
echo "   - Set WEBHOOK_SECRET in BOTH places:"
echo "     1. operator/.env (already done above)"
echo "     2. scripts/Code.gs (var secretToken = '<value>')"
echo "   - Redeploy the Apps Script project after updating Code.gs"
echo ""
echo "WEBHOOK_SECRET: $(grep WEBHOOK_SECRET /opt/gahwa-newsletter/operator/.env | cut -d= -f2)"
echo ""
echo "NOTE: Auth model is HEADER-BASED (Bearer token)."
echo "      WEBHOOK_SECRET is hardcoded in Code.gs — no PropertiesService dependency."
echo "      Run storeSecrets() only for DEEPSEEK_API_KEY and BEEHIIV_API_KEY (not for WEBHOOK_SECRET)."
echo ""
echo "=== Setup complete. The system will run autonomously at 7 AM daily. ==="
