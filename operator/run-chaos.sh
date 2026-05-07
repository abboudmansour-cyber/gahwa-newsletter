#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# run-chaos.sh — Gahwa Failure Injection Test Suite Entry Point
#
# Usage:
#   bash operator/run-chaos.sh            # Run all 5 test phases
#   bash operator/run-chaos.sh --quick     # Run tests with minimal output
#
# ══════════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   💥 GAHWA CHAOS ENGINE                                ║"
echo "║   Failure Injection Resilience Validation Suite        ║"
echo "║   $(date '+%Y-%m-%d %H:%M:%S')                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

cd "$PROJECT_ROOT"

# ── Check Node.js ─────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌ ERROR: Node.js is not installed"
  exit 1
fi

NODE_VER=$(node --version 2>/dev/null || echo "unknown")
echo "   Node.js: $NODE_VER"
echo "   Project: $PROJECT_ROOT"
echo ""

# ── Ensure logs directory exists ─────────────────────────────────────────
mkdir -p "$SCRIPT_DIR/logs"

# ── Run the chaos test suite ─────────────────────────────────────────────
echo "🚀 Launching chaos test suite..."
echo ""

node "$SCRIPT_DIR/chaos-runner.js"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ Chaos test suite completed"
else
  echo "⚠️ Chaos test suite exited with code $EXIT_CODE"
fi

echo "   Results: operator/logs/chaos-results.json"
echo ""

exit $EXIT_CODE
