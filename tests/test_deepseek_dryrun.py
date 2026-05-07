#!/usr/bin/env python3
"""
Dry-run test for the DeepSeek Anthropic-compatible endpoint.
Validates connectivity, authentication, and response format
without modifying any actual newsletter logic or data.

Usage:
    python3 tests/test_deepseek_dryrun.py

Environment:
    DEEPSEEK_API_KEY must be set (or you'll be prompted)
"""

import json
import os
import sys
import urllib.request
import urllib.error

# ── Configuration ──────────────────────────────────────────────────────────
BASE_URL  = "https://api.deepseek.com/anthropic/v1/messages"
MODEL     = "deepseek-v4-pro"
API_KEY   = os.environ.get(
    "DEEPSEEK_API_KEY",
    "1s9_k1zGgRgCzxWRLtjzoPVAPEKUuCQ9GL7PofLPkRQKqTtdLAteL6sY5"
)

# ── Test payload (simple, keeps prompt structure untouched) ────────────────
PAYLOAD = {
    "model": MODEL,
    "max_tokens": 100,
    "messages": [
        {
            "role": "user",
            "content": "Say hello in one word."
        }
    ]
}

# ── Anthropic-compatible headers ───────────────────────────────────────────
HEADERS = {
    "x-api-key": API_KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
}


def run_dryrun() -> int:
    """Execute the dry-run and print results."""
    print("=" * 70)
    print("  DEEPSEEK ANTHROPIC-COMPATIBLE ENDPOINT — DRY RUN")
    print("=" * 70)
    print(f"\n  Endpoint : {BASE_URL}")
    print(f"  Model    : {MODEL}")
    print(f"  Prompt   : \"Say hello in one word.\"")
    print(f"  Max Tokens: 100")
    print()

    # ── Step 1: Serialize payload ──────────────────────────────────────────
    try:
        data = json.dumps(PAYLOAD).encode("utf-8")
        print("  [1/4] ✅ Payload serialized successfully")
    except (TypeError, ValueError) as e:
        print(f"  [1/4] ❌ Payload serialization failed: {e}")
        return 1

    # ── Step 2: Send request ───────────────────────────────────────────────
    req = urllib.request.Request(
        BASE_URL,
        data=data,
        headers=HEADERS,
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        print(f"  [2/4] ✅ Request sent — HTTP {resp.getcode()}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  [2/4] ❌ HTTP {e.code}: {e.reason}")
        print(f"         Body: {body[:500]}")
        return 1
    except urllib.error.URLError as e:
        print(f"  [2/4] ❌ Connection failed: {e.reason}")
        return 1

    # ── Step 3: Parse response ─────────────────────────────────────────────
    status = resp.getcode()
    try:
        body = resp.read().decode("utf-8")
        result = json.loads(body)
        print(f"  [3/4] ✅ HTTP {status} — JSON parsed successfully")
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        print(f"  [3/4] ❌ Response parse failed: {e}")
        print(f"         Raw: {body[:500]}")
        return 1

    # ── Step 4: Validate Anthropic response structure ──────────────────────
    has_content = "content" in result and isinstance(result["content"], list)
    has_text_block = False
    text = ""

    if has_content:
        for block in result["content"]:
            if block.get("type") == "text" and block.get("text"):
                has_text_block = True
                text = block["text"]
                break

    if status == 200 and has_content and has_text_block:
        print(f"  [4/4] ✅ Valid Anthropic response structure")
        print(f"\n  ── Response ────────────────────────────────────────")
        print(f"  {text}")
        print(f"  ─────────────────────────────────────────────────────")
    else:
        print(f"  [4/4] ❌ Unexpected response structure")
        print(f"         Status : {status}")
        print(f"         Keys   : {list(result.keys())}")
        print(f"         Raw    : {json.dumps(result, indent=2)[:500]}")
        return 1

    # ── Token usage (optional) ─────────────────────────────────────────────
    usage = result.get("usage", {})
    if usage:
        print(f"\n  Token Usage:")
        print(f"    Input tokens : {usage.get('input_tokens', 'N/A')}")
        print(f"    Output tokens: {usage.get('output_tokens', 'N/A')}")

    print(f"\n{'=' * 70}")
    print("  ✅ DRY RUN COMPLETE — Endpoint is healthy")
    print(f"{'=' * 70}\n")
    return 0


if __name__ == "__main__":
    sys.exit(run_dryrun())
