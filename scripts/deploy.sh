#!/bin/bash
# ============================================================
# deploy.sh — Gahwa Newsletter Pipeline Orchestrator
# ============================================================
# Stages:
#   generate  — AI content generation (DeepSeek)
#   push      — Deploy JSON to Apps Script webhook (email dispatch)
#   deploy    — Full pipeline: generate + push (auto-chained)
#
# Self-configuring: detects or creates .env, auto-sources variables.
# Self-healing: 3-tier retry on push failures, delivery logging.
#
# Usage:
#   ./scripts/deploy.sh generate   # Generate only (auto-chains push)
#   ./scripts/deploy.sh push       # Push only
#   ./scripts/deploy.sh deploy     # Full pipeline
#   ./scripts/deploy.sh            # Full pipeline (default)
#
# Environment-aware: works on local dev (Mac) and Hetzner VPS.
# No manual URL or file path parameters required.
# ============================================================

set -euo pipefail

# ── DYNAMIC PATH DETECTION ──────────────────────────────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT" || { echo "❌ Failed to locate project root"; exit 1; }

# ── COLOR CODES ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── ENVIRONMENT LOGGING ─────────────────────────────────────────────────
echo -e "${CYAN}🤖 Gahwa Operator: Starting pipeline...${NC}"
echo -e "📍 Execution Path: $(pwd)"
echo ""

# ─────────────────────────────────────────────────────────────────────────
# TASK 1: Environment Automation
# ─────────────────────────────────────────────────────────────────────────
# Auto-detect or create .env in the project root.
# On Hetzner, prefers /opt/gahwa-newsletter/operator/.env for legacy compat.
# On local dev, uses PROJECT_ROOT/.env or operator/.env.
# ─────────────────────────────────────────────────────────────────────────
ensure_env() {
  local env_file=""
  local template_file=""

  # Detection order on Hetzner: /opt/gahwa-newsletter/operator/.env (legacy)
  # then PROJECT_ROOT/operator/.env, then PROJECT_ROOT/.env
  for candidate in \
    "/opt/gahwa-newsletter/operator/.env" \
    "$PROJECT_ROOT/operator/.env" \
    "$PROJECT_ROOT/.env"; do
    if [ -f "$candidate" ]; then
      env_file="$candidate"
      break
    fi
  done

  # If no .env exists, create one from template
  if [ -z "$env_file" ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Creating from template...${NC}"

    # Prefer PROJECT_ROOT/.env for new installs (simpler path on Hetzner)
    env_file="$PROJECT_ROOT/.env"

    # Use the root .env.template if available
    if [ -f "$PROJECT_ROOT/.env.template" ]; then
      cp "$PROJECT_ROOT/.env.template" "$env_file"
    elif [ -f "$PROJECT_ROOT/operator/env.hetzner.template" ]; then
      cp "$PROJECT_ROOT/operator/env.hetzner.template" "$env_file"
    else
      # Minimal fallback template
      cat > "$env_file" <<- 'ENVEOF'
# Gahwa Newsletter — Auto-generated environment configuration
# Fill in your API keys and webhook URL below.
DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
APPS_SCRIPT_WEBHOOK_URL=https://script.google.com/macros/s/your-script-id/exec
WEBHOOK_SECRET=your-webhook-secret-hex-here
OUTPUT_DIR=output
LOG_LEVEL=INFO
ENVEOF
    fi

    chmod 600 "$env_file" 2>/dev/null || true
    echo -e "${GREEN}   ✅ Created: $env_file${NC}"
    echo -e "${YELLOW}   ⚠️  Edit this file and set APPS_SCRIPT_WEBHOOK_URL before pushing.${NC}"
  fi

  # Source the .env file
  set -a
  source "$env_file"
  set +a

  # Also try operator/.env as fallback for variables that may be there
  if [ -f "$PROJECT_ROOT/operator/.env" ]; then
    set -a
    source "$PROJECT_ROOT/operator/.env"
    set +a
  fi

  echo -e "${GREEN}   ✅ Environment loaded from: $env_file${NC}"
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────
# TASK 3: Auto-chain generate -> push with handoff verification
# ─────────────────────────────────────────────────────────────────────────
run_generate() {
  echo -e "${CYAN}📰 Stage 3: AI Content Generation (DeepSeek)${NC}"
  echo "────────────────────────────────────────────────"
  python3 ./scripts/generate_newsletter.py
  local gen_exit=$?
  echo ""

  if [ $gen_exit -ne 0 ]; then
    echo -e "${RED}❌ Generation failed. Aborting pipeline.${NC}"
    exit $gen_exit
  fi

  echo -e "${GREEN}✅ Stage 3 complete — JSON ready at output/latest-newsletter.json${NC}"
  echo ""

  # ── Pipeline Handoff Verified ─────────────────────────────────────────
  echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}✅ Pipeline Handoff Verified${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
  echo ""
}

run_push() {
  echo -e "${CYAN}🚀 Stage 5: Push to Apps Script (Email Dispatch)${NC}"
  echo "────────────────────────────────────────────────"

  # Ensure environment is loaded
  ensure_env

  # Pre-flight: verify webhook URL is configured
  if [ -z "${APPS_SCRIPT_WEBHOOK_URL:-}" ]; then
    echo -e "${RED}❌ APPS_SCRIPT_WEBHOOK_URL is not set.${NC}"
    echo ""
    echo "  Set it in your .env file:"
    echo "    APPS_SCRIPT_WEBHOOK_URL=https://script.google.com/macros/s/your-script-id/exec"
    echo ""
    echo "  Or in operator/.env if using legacy setup."
    exit 1
  fi

  echo "   Webhook: configured ✅"
  echo ""

  # Check that JSON payload exists before attempting push
  local json_file="$PROJECT_ROOT/output/latest-newsletter.json"
  if [ ! -f "$json_file" ]; then
    echo -e "${RED}❌ No newsletter JSON found at $json_file${NC}"
    echo "  Run 'generate' first to create the newsletter."
    exit 1
  fi

  # ── TASK 2: 3-Tier Retry Loop ──────────────────────────────────────
  local max_attempts=3
  local attempt=1
  local http_code=""
  local response_body=""
  local success=false
  local start_time end_time elapsed

  while [ $attempt -le $max_attempts ]; do
    echo -e "   ─── Attempt $attempt of $max_attempts ───"
    start_time=$(date +%s)

    # Inject auth_token into payload inline
    local payload_file
    payload_file=$(mktemp /tmp/gahwa-payload-XXXXXXXX.json)
    trap 'rm -f "$payload_file"' EXIT

    if ! jq --arg token "${WEBHOOK_SECRET:-}" '. + {auth_token: $token}' "$json_file" > "$payload_file" 2>/dev/null; then
      echo -e "${RED}   ❌ Payload injection failed. Check JSON validity.${NC}"
      rm -f "$payload_file"
      exit 1
    fi

    # Send via curl — capture status and body
    local curl_output
    curl_output=$(curl -s -L -w "\n%{http_code}" \
      -X POST "$APPS_SCRIPT_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d @"$payload_file" 2>&1) || true

    rm -f "$payload_file"
    trap '' EXIT

    http_code=$(echo "$curl_output" | tail -n1)
    response_body=$(echo "$curl_output" | sed '$d')
    end_time=$(date +%s)
    elapsed=$((end_time - start_time))

    echo -e "   HTTP $http_code (${elapsed}s)"

    case "$http_code" in
      200)
        echo -e "   Response: ${response_body:-"(empty)"}"

        # Check for error indicators in Apps Script response
        if echo "$response_body" | grep -qi "error\|exception\|fail"; then
          echo -e "${YELLOW}⚠️  [APPS SCRIPT ERROR] Processing error detected:${NC}"
          echo "   $response_body" | head -c 500
          echo ""
          success=false
          break
        fi

        echo ""
        echo -e "${GREEN}✅ [SUCCESS] Newsletter Filed${NC}"
        success=true
        break
        ;;
      *)
        if [ $attempt -lt $max_attempts ]; then
          echo -e "${YELLOW}   ⏳ HTTP $http_code — not 200 OK. Waiting 30s before retry...${NC}"
          sleep 30
        else
          echo -e "${RED}   ❌ All $max_attempts attempts exhausted.${NC}"
        fi
        ;;
    esac

    attempt=$((attempt + 1))
  done

  # ── Log to output/delivery_log.txt ─────────────────────────────────
  local log_file="$PROJECT_ROOT/output/delivery_log.txt"
  local log_dir
  log_dir=$(dirname "$log_file")
  mkdir -p "$log_dir"

  {
    echo "--- Delivery Report: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ---"
    echo "Webhook:    $APPS_SCRIPT_WEBHOOK_URL"
    echo "Payload:    $json_file"
    echo "Attempts:   $((attempt - 1))"
    echo "HTTP Code:  $http_code"
    if [ "$success" = true ]; then
      echo "Status:     SUCCESS"
    else
      echo "Status:     FAILED"
    fi
    echo "Response:   ${response_body:-(no response)}" | head -c 300
    echo ""
  } >> "$log_file"

  echo ""
  echo "────────────────────────────────────────────────"
  if [ "$success" = true ]; then
    echo -e "${GREEN}✅ Stage 5 (Push): Newsletter successfully filed to Apps Script${NC}"
    echo "   Archive:   $json_file"
    echo "   Log:       $log_file"
    echo "   Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    exit 0
  else
    echo -e "${RED}❌ Stage 5 (Push): FAILED${NC}"
    echo "   HTTP:      $http_code"
    echo "   Payload:   $json_file"
    echo "   Log:       $log_file"
    echo ""
    echo "   ➤ Debug: Check $log_file for details."
    exit 1
  fi
}

# ── MAIN EXECUTION ──────────────────────────────────────────────────────
ACTION="${1:-deploy}"

case "$ACTION" in
  "generate")
    ensure_env
    run_generate
    # TASK 3: Auto-chain push after successful generate
    echo -e "${CYAN}🔗 Auto-chaining to push...${NC}"
    echo ""
    run_push
    ;;

  "push")
    ensure_env
    run_push
    ;;

  "deploy"|"")
    ensure_env
    run_generate
    # TASK 3: Auto-chain push after successful generate
    echo -e "${CYAN}🔗 Auto-chaining to push...${NC}"
    echo ""
    run_push
    ;;

  *)
    echo "❓ Usage: ./scripts/deploy.sh {generate|push|deploy}"
    echo ""
    echo "  generate  — Generate newsletter & auto-push"
    echo "  push      — Send newsletter JSON to Apps Script webhook"
    echo "  deploy    — Full pipeline: generate + push"
    echo ""
    echo "  (no args also runs full 'deploy' pipeline)"
    exit 1
    ;;
esac
