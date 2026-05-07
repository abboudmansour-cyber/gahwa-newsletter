#!/bin/bash
# /opt/gahwa/scripts/send_to_apps_script.sh
# Sends a JSON payload to the Apps Script webhook with WEBHOOK_SECRET auth.
# Usage: ./send_to_apps_script.sh <webapp_url> [json_file]
#   webapp_url: The deployed Apps Script web app URL
#   json_file:  Path to JSON payload (default: /opt/gahwa/output.json)

set -e

# Load environment variables
source /opt/gahwa/config.env

WEBAPP_URL="${1:-}"
JSON_FILE="${2:-/opt/gahwa/output.json}"

if [ -z "$WEBAPP_URL" ]; then
  echo "ERROR: Web App URL is required."
  echo "Usage: $0 <webapp_url> [json_file]"
  echo ""
  echo "Example:"
  echo "  $0 https://script.google.com/macros/s/ABC123/exec"
  exit 1
fi

if [ ! -f "$JSON_FILE" ]; then
  echo "ERROR: JSON file not found: $JSON_FILE"
  exit 1
fi

if [ -z "$WEBHOOK_SECRET" ]; then
  echo "ERROR: WEBHOOK_SECRET not set in /opt/gahwa/config.env"
  exit 1
fi

echo "Sending payload to Apps Script webhook..."

# Inject the auth_token into the JSON payload before sending
jq --arg token "$WEBHOOK_SECRET" '. + {auth_token: $token}' "$JSON_FILE" > payload.json

curl -L -X POST "$WEBAPP_URL" \
     -H "Content-Type: application/json" \
     -d @payload.json

rm payload.json

echo ""
echo "--- SYSTEM HEALTH REPORT ---"
echo "Disk Usage: $(du -sh /opt/gahwa)"
echo "Last 5 Cron Logs:"
tail -n 5 /opt/gahwa/logs/cron.log 2>/dev/null || echo "(no cron logs yet)"
echo "Clasp Status:"
clasp status 2>/dev/null || echo "(clasp not configured)"
echo "----------------------------"
