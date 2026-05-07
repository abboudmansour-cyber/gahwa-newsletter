#!/bin/bash
# ============================================================
# deploy.sh — Gahwa Newsletter Pipeline Orchestrator
# ============================================================
# Stages:
#   generate  — AI content generation (DeepSeek)
#   push      — Deploy JSON to Apps Script webhook (email dispatch)
#   deploy    — Full pipeline: generate + push
#
# Environment-aware: works on local dev (Mac) and Hetzner VPS.
# ============================================================

set -euo pipefail

# ── DYNAMIC PATH DETECTION ──────────────────────────────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT" || { echo "❌ Failed to locate project root"; exit 1; }

# ── ENVIRONMENT LOGGING ─────────────────────────────────────────────────
echo "🤖 Gahwa Operator: Starting pipeline..."
echo "📍 Execution Path: $(pwd)"
echo ""

# ── EXECUTION LOGIC ─────────────────────────────────────────────────────
case "${1:-}" in
  "generate")
    echo "📰 Stage 3: AI Content Generation (DeepSeek)"
    echo "────────────────────────────────────────────────"
    python3 ./scripts/generate_newsletter.py
    echo ""
    echo "✅ Stage 3 complete — JSON ready at output/latest-newsletter.json"
    ;;

  "push")
    echo "🚀 Stage 5: Push to Apps Script (Email Dispatch)"
    echo "────────────────────────────────────────────────"

    # Pre-flight check: verify the environment has the webhook URL
    # Load .env to check availability before calling the script
    if [ -f "$PROJECT_ROOT/operator/.env" ]; then
      set -a
      source "$PROJECT_ROOT/operator/.env"
      set +a
    fi

    if [ -n "${APPS_SCRIPT_WEBHOOK_URL:-}" ]; then
      echo "   Webhook: $APPS_SCRIPT_WEBHOOK_URL"
      bash ./scripts/send_to_apps_script.sh "$APPS_SCRIPT_WEBHOOK_URL"
    else
      echo "   ⚠️  No APPS_SCRIPT_WEBHOOK_URL in environment — let send_to_apps_script.sh resolve it."
      bash ./scripts/send_to_apps_script.sh
    fi
    ;;

  "deploy"|"")
    echo "📰 Stage 3: AI Content Generation (DeepSeek)"
    echo "────────────────────────────────────────────────"
    python3 ./scripts/generate_newsletter.py
    echo ""

    echo "🚀 Stage 5: Push to Apps Script (Email Dispatch)"
    echo "────────────────────────────────────────────────"
    if [ -f "$PROJECT_ROOT/operator/.env" ]; then
      set -a
      source "$PROJECT_ROOT/operator/.env"
      set +a
    fi

    if [ -n "${APPS_SCRIPT_WEBHOOK_URL:-}" ]; then
      bash ./scripts/send_to_apps_script.sh "$APPS_SCRIPT_WEBHOOK_URL"
    else
      bash ./scripts/send_to_apps_script.sh
    fi
    ;;

  *)
    echo "❓ Usage: ./scripts/deploy.sh {generate|push|deploy}"
    echo ""
    echo "  generate  — Generate newsletter JSON via DeepSeek AI"
    echo "  push      — Send newsletter JSON to Apps Script webhook"
    echo "  deploy    — Full pipeline: generate + push"
    echo ""
    echo "  (no args also runs full 'deploy' pipeline)"
    exit 1
    ;;
esac

echo ""
echo "✅ Pipeline stage complete."

