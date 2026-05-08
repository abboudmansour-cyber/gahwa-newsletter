#!/bin/bash
# send_to_apps_script.sh — Sends JSON payload to Apps Script webhook.
# Uses dynamic pathing: works on both local dev and Hetzner VPS.
# Features:
#   - Environment-aware URL resolution (env var + CLI arg)
#   - Self-healing: 3 retry attempts with 30s fixed wait on non-200
#   - Response capture and structured status logging
#   - "Success: Newsletter Filed" on 200 OK
#   - Delivery log written to output/delivery_log.txt
# Usage: ./send_to_apps_script.sh [webapp_url] [json_file]
#   webapp_url: The deployed Apps Script web app URL (optional if APPS_SCRIPT_WEBHOOK_URL is set)
#   json_file:  Path to JSON payload (default: output/latest-newsletter.json)

set -euo pipefail

# ── Dynamic Project Root Detection ──────────────────────────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT" || { echo "❌ Failed to locate project root"; exit 1; }

# ── Load environment variables ──────────────────────────────────────────────
ENV_LOADED=false
for env_candidate in "$PROJECT_ROOT/operator/.env" "/opt/gahwa-newsletter/operator/.env" "/opt/gahwa/config.env"; do
  if [ -f "$env_candidate" ]; then
    set -a
    source "$env_candidate"
    set +a
    ENV_LOADED=true
    break
  fi
done

if [ "$ENV_LOADED" = false ]; then
  echo "❌ [CONFIG MISSING] No .env or config.env found. Checked:"
  echo "   - $PROJECT_ROOT/operator/.env"
  echo "   - /opt/gahwa-newsletter/operator/.env"
  echo "   - /opt/gahwa/config.env"
  echo ""
  echo "  → Copy operator/env.hetzner.template to operator/.env and fill in values."
  exit 1
fi

# ── Resolve Webhook URL ─────────────────────────────────────────────────────
# Priority: CLI arg > APPS_SCRIPT_WEBHOOK_URL env var
WEBAPP_URL="${1:-${APPS_SCRIPT_WEBHOOK_URL:-}}"
JSON_FILE="${2:-$PROJECT_ROOT/output/latest-newsletter.json}"

if [ -z "$WEBAPP_URL" ]; then
  echo "❌ [CONFIG MISSING] APPS_SCRIPT_WEBHOOK_URL is not set."
  echo ""
  echo "  Set it in operator/.env or pass as first argument:"
  echo "    $0 https://script.google.com/macros/s/ABC123/exec"
  echo ""
  echo "  Example .env entry:"
  echo "    APPS_SCRIPT_WEBHOOK_URL=https://script.google.com/macros/s/your-script-id/exec"
  echo ""
  echo "  See operator/env.hetzner.template for the full configuration reference."
  exit 1
fi

# Strict validation: reject library URLs — only Web App /exec URLs are valid
if [[ ! "$WEBAPP_URL" == */macros/s/* ]]; then
  echo "❌ [INVALID WEBHOOK] URL must be a Web App /exec endpoint:"
  echo "   Got:      $WEBAPP_URL"
  echo ""
  echo "   Expected: https://script.google.com/macros/s/ABC123/exec"
  echo ""
  echo "   Library URLs (/macros/library/...) are NOT valid for doPost."
  exit 1
fi


if [ ! -f "$JSON_FILE" ]; then
  echo "❌ [FILE NOT FOUND] JSON payload missing: $JSON_FILE"
  echo "  Run the generation step first to create the newsletter."
  echo "  Example: python3 ./scripts/generate_newsletter.py"
  exit 1
fi

if [ -z "${WEBHOOK_SECRET:-}" ]; then
  echo "⚠  WEBHOOK_SECRET not set — sending without signature verification"
fi

# ── Determine auth header (X-Gahwa-Webhook-Secret only) ────────────────────
# Custom header to avoid Google's auth proxy intercepting standard headers.
AUTH_HEADER=""
if [ -n "${WEBHOOK_SECRET:-}" ]; then
  AUTH_HEADER="-H \"X-Gahwa-Webhook-Secret: ${WEBHOOK_SECRET}\""
fi
echo "🚀 Gahwa Newsletter — Push to Apps Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   Webhook: configured ✅"
echo "   Payload: $JSON_FILE"
echo "   Auth:    HEADER-BASED"
echo ""

# ── Inject deliveryId for idempotent delivery ────────────────────────────────
PAYLOAD_FILE=$(mktemp /tmp/gahwa-payload-XXXXXXXX.json)
trap 'rm -f "$PAYLOAD_FILE"' EXIT

cp "$JSON_FILE" "$PAYLOAD_FILE"

DELIVERY_ID="${JOB_NAME:-daily-newsletter}-$(date +%Y-%m-%d)-$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
if ! jq --arg did "$DELIVERY_ID" '. + {deliveryId: $did}' "$PAYLOAD_FILE" > "${PAYLOAD_FILE}.tmp"; then
  echo "⚠  Warning: Could not inject deliveryId"
else
  mv "${PAYLOAD_FILE}.tmp" "$PAYLOAD_FILE"
fi
echo "   🆔 Delivery ID: $DELIVERY_ID"
echo ""

# ── Send with retry logic (3-tier, 30s fixed wait) ─────────────────────────
MAX_ATTEMPTS=3
ATTEMPT=1
SUCCESS=false
HTTP_CODE=""
RESPONSE_BODY=""

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
  echo "─── Attempt $ATTEMPT of $MAX_ATTEMPTS ───"

  # Capture both response body and HTTP status code in one call
  # Use -w for status code on the last line, -s for silent mode
  CURL_OUTPUT=$(eval curl -s -L -w "\\n%{http_code}" \
    -X POST "$WEBAPP_URL" \
    -H "Content-Type: application/json" \
    $AUTH_HEADER \
    -d @"$PAYLOAD_FILE" 2>&1) || true

  # Extract HTTP status code (last line after splitting)
  HTTP_CODE=$(echo "$CURL_OUTPUT" | tail -n1)
  # Extract response body (everything except the last line)
  RESPONSE_BODY=$(echo "$CURL_OUTPUT" | sed '$d')

  echo "   HTTP $HTTP_CODE"

  case "$HTTP_CODE" in
    200)
      echo "   Response: ${RESPONSE_BODY:-"(empty response)"}"

      # DUPLICATE_IGNORED is a valid idempotent response — treat as success
      if echo "$RESPONSE_BODY" | grep -q "DUPLICATE_IGNORED"; then
        echo ""
        echo "⏭️  [DUPLICATE] Already delivered — deliveryId $DELIVERY_ID"
        echo "✅ [SUCCESS] Newsletter already sent (idempotent guard)"
        SUCCESS=true
        break
      fi

      # Check for error indicators in the Apps Script response body
      if echo "$RESPONSE_BODY" | grep -qi "error\|exception\|fail"; then
        echo ""
        echo "⚠️  [APPS SCRIPT ERROR] Rendering or processing error detected:"
        echo "   $RESPONSE_BODY" | head -c 500
        echo ""
        echo "   This is a critical failure — check Apps Script execution logs." >&2
        SUCCESS=false
        break
      fi

      echo ""
      echo "✅ [SUCCESS] Newsletter Filed"
      SUCCESS=true
      break
      ;;
    429)
      WAIT=$((ATTEMPT * 5))
      echo "   ⏳ Rate limited. Waiting ${WAIT}s before retry..."
      sleep "$WAIT"
      ;;
    502|503)
      WAIT=$((2 ** ATTEMPT * 3))
      echo "   ⏳ Service temporarily unavailable ($HTTP_CODE). Waiting ${WAIT}s..."
      sleep "$WAIT"
      ;;
    401|403)
      echo "❌ [AUTH ERROR] Apps Script rejected the request (HTTP $HTTP_CODE)"
      echo "   Response: ${RESPONSE_BODY:-"(empty)"}"
      echo ""
      echo "   Fix: WEBHOOK_SECRET must match in both places:"
      echo "     1. operator/.env"
      echo "     2. scripts/Code.gs → secretToken constant"
      echo ""
      echo "   Auth model: HEADER-BASED only (no PropertiesService dependency)"
      echo "   Run \`openssl rand -hex 24\` to generate a new secret, then update both locations."
      SUCCESS=false
      break
      ;;
    000)
      WAIT=$((2 ** ATTEMPT * 2))
      echo "   ⏳ Connection error (curl exit code). Network may be down. Waiting ${WAIT}s..."
      sleep "$WAIT"
      ;;
    *)
      echo "   Response: ${RESPONSE_BODY:-"(empty)"}"
      if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
        echo "   ⏳ HTTP $HTTP_CODE — not 200 OK. Waiting 30s before retry..."
        sleep 30
      else
        echo "❌ [FAILED] All $MAX_ATTEMPTS attempts exhausted."
      fi
      ;;
  esac

  ATTEMPT=$((ATTEMPT + 1))
done

# ── Log final status to output/delivery_log.txt ─────────────────────────────
LOG_FILE="$PROJECT_ROOT/output/delivery_log.txt"
mkdir -p "$(dirname "$LOG_FILE")"
{
  echo ""
  echo "--- Delivery Report: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ---"
  echo "Webhook:    $WEBAPP_URL"
  echo "Payload:    $JSON_FILE"
  echo "Attempts:   $((ATTEMPT - 1))"
  echo "HTTP Code:  $HTTP_CODE"
  if [ "$SUCCESS" = true ]; then
    echo "Status:     SUCCESS"
  else
    echo "Status:     FAILED"
  fi
  echo "Response:   ${RESPONSE_BODY:-(no response)}" | head -c 300
} >> "$LOG_FILE"

# ── Final status summary ────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$SUCCESS" = true ]; then
  echo "✅ Stage 5 (Push): Newsletter successfully filed to Apps Script"
  echo "   Archive:  $JSON_FILE"
  echo "   Log:      $LOG_FILE"
  echo "   Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  exit 0
else
  echo "❌ Stage 5 (Push): FAILED"
  echo "   HTTP:     $HTTP_CODE"
  echo "   URL:      $WEBAPP_URL"
  echo "   Payload:  $JSON_FILE"
  echo "   Log:      $LOG_FILE"
  echo "   Response: ${RESPONSE_BODY:-(no response)}" | head -c 300
  echo ""
  echo "   ➤ Debug: Check $LOG_FILE for full details."
  exit 1
fi
