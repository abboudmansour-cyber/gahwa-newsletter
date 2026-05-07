#!/bin/bash
set -e

echo "=== Hetzner Setup for The Gahwa ==="

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
apt-get install -y nodejs npm git

# Install clasp globally
npm install -g @google/clasp

# Create logs directory
mkdir -p /opt/gahwa/logs

# Clone the repo
if [ -d "/opt/gahwa/.git" ]; then
  echo "Repo already exists at /opt/gahwa — pulling latest..."
  cd /opt/gahwa
  git pull origin main
else
  echo "Cloning ${REPO_URL}..."
  git clone "${REPO_URL}" /opt/gahwa
  cd /opt/gahwa
fi

# Make scripts executable
chmod +x scripts/*.sh

# ── Production Hardening ──────────────────────────────────────────────

# 1. Log rotation for /opt/gahwa/logs
cat > /etc/logrotate.d/gahwa << 'LOGEOF'
/opt/gahwa/logs/*.log {
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
touch /opt/gahwa/config.env
chmod 600 /opt/gahwa/config.env

# 3. Generate unique Webhook Secret
echo "WEBHOOK_SECRET=$(openssl rand -hex 24)" >> /opt/gahwa/config.env
echo "✅ Webhook Secret generated and stored in /opt/gahwa/config.env"

echo ""
echo "=== Setup complete ==="
echo ""
echo "NEXT STEPS (manual):"
echo "1. Run: clasp login --no-localhost"
echo "   Follow the URL, authenticate with Google, paste the token back"
echo "2. Verify: cat ~/.clasprc.json (should contain tokens)"
echo "3. Test deploy: cd /opt/gahwa && python3 scripts/clasp_push.py"
echo "4. If deploy works, copy ~/.clasprc.json contents for safekeeping"
echo ""
echo "CRONTAB (optional — enables 7:00 AM daily deploy):"
echo "  (crontab -l 2>/dev/null; echo \"0 7 * * * /bin/bash /opt/gahwa/scripts/deploy.sh >> /opt/gahwa/logs/cron.log 2>&1\") | crontab -"
echo ""
echo "WEBHOOK SECRET (for Apps Script doPost):"
echo "  Run storeSecrets() in Apps Script editor and paste this value:"
echo "  $(grep WEBHOOK_SECRET /opt/gahwa/config.env | cut -d= -f2)"
