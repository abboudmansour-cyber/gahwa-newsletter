#!/usr/bin/env python3
"""
generate_newsletter.py — Stage 2: AI Content Generation (DeepSeek)

Generates the GCC Morning Brief newsletter by calling the DeepSeek API,
validates the output against the strict JSON schema, and saves the result
to /output/latest-newsletter.json.

Usage:
    python3 scripts/generate_newsletter.py          # Normal run
    python3 scripts/generate_newsletter.py --dry-run # Test run, no file saved

Part of the Gahwa Newsletter autonomous pipeline.
Designed for both local dev and Hetzner VPS production.
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import date
from pathlib import Path

# ── Dynamic Project Root Detection ───────────────────────────────────────────
# Works whether called from project root or via scripts/deploy.sh
SCRIPT_DIR = Path(__file__).resolve().parent       # scripts/
PROJECT_ROOT = SCRIPT_DIR.parent                    # gahwa-newsletter/
OUTPUT_DIR = PROJECT_ROOT / "output"
ENV_FILE = PROJECT_ROOT / "operator" / ".env"

# ── Configuration ────────────────────────────────────────────────────────────
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"
MAX_TOKENS = 4096
TEMPERATURE = 0.7

TODAY = date.today().isoformat()  # YYYY-MM-DD

# ── Schema ───────────────────────────────────────────────────────────────────
REQUIRED_NEWSLETTER_KEYS = {"date", "title", "sections"}
REQUIRED_SECTION_KEYS = {"headline", "summary", "insight"}
MIN_SECTIONS = 5
MAX_SECTIONS = 8


def load_env():
    """Load DEEPSEEK_API_KEY from operator/.env file."""
    if not ENV_FILE.exists():
        print(f"❌ Environment file not found: {ENV_FILE}")
        print("   Copy operator/env.hetzner.template to operator/.env and add your API key.")
        sys.exit(1)

    api_key = None
    with open(ENV_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if line.startswith("DEEPSEEK_API_KEY="):
                api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                break

    if not api_key or api_key.startswith("sk-your"):
        print("❌ DEEPSEEK_API_KEY is not set in operator/.env")
        sys.exit(1)

    return api_key


def build_prompt() -> str:
    """Build the newsletter generation prompt."""
    return f"""Generate today's GCC Morning Brief newsletter.

TODAY'S DATE: {TODAY}

OUTPUT FORMAT — Return ONLY valid JSON following this exact schema:
{{
  "date": "{TODAY}",
  "title": "GCC Morning Brief",
  "sections": [
    {{
      "headline": "[Headline 1 — max 15 words]",
      "summary": "[2-3 sentence summary of this section]",
      "insight": "[1-2 sentence key insight or what this means]"
    }}
  ]
}}

CONTENT REQUIREMENTS:
- Minimum {MIN_SECTIONS} sections, maximum {MAX_SECTIONS} sections
- Each section must have: headline, summary, and insight
- Cover GCC markets, Saudi economy, UAE business, regional fintech, and energy
- Be data-driven: include specific numbers, percentages, and market data
- Tone: authoritative, direct, professional — suitable for GCC executives

EXAMPLE SECTION:
{{
  "headline": "Saudi non-oil GDP grows 4.5% in Q1",
  "summary": "Saudi Arabia's non-oil GDP expanded 4.5% year-on-year in Q1 2026, driven by tourism, logistics, and manufacturing as Vision 2030 diversification gains momentum.",
  "insight": "The continued strength in non-oil sectors signals resilience against global oil price volatility and reinforces investor confidence in the Kingdom's economic transformation."
}}

Return ONLY valid JSON — no markdown, no code fences, no extra text."""


def call_deepseek(api_key: str, prompt: str) -> dict:
    """Call DeepSeek API and return the parsed JSON response."""
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "You are a GCC market intelligence analyst. Output ONLY valid JSON."},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
    }

    req = urllib.request.Request(
        DEEPSEEK_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            response_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"❌ DeepSeek API HTTP Error: {e.code} {e.reason}")
        print(f"   Response: {e.read().decode('utf-8')}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"❌ DeepSeek API connection error: {e.reason}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"❌ Failed to parse API response: {e}")
        sys.exit(1)

    content = response_data.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not content:
        print("❌ DeepSeek returned empty content")
        sys.exit(1)

    # Strip markdown code fences if present
    content = content.strip()
    if content.startswith("```"):
        # Remove opening fence
        content = content.split("\n", 1)[-1] if "\n" in content else content[3:]
        # Remove closing fence
        if content.endswith("```"):
            content = content[:-3].strip()
        elif "```" in content:
            content = content.rsplit("```", 1)[0].strip()

    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        print(f"❌ Failed to parse DeepSeek response as JSON: {e}")
        print(f"   Raw response (first 500 chars): {content[:500]}")
        sys.exit(1)


def validate_schema(newsletter: dict) -> list:
    """
    Validate the newsletter against the strict JSON schema.
    Returns a list of error messages (empty list = valid).
    """
    errors = []

    if not isinstance(newsletter, dict):
        return ["Response is not a JSON object"]

    # Check top-level keys
    missing = REQUIRED_NEWSLETTER_KEYS - set(newsletter.keys())
    if missing:
        errors.append(f"Missing top-level keys: {', '.join(sorted(missing))}")

    if not isinstance(newsletter.get("sections"), list):
        errors.append('"sections" must be an array')
        return errors

    sections = newsletter["sections"]
    if len(sections) < MIN_SECTIONS:
        errors.append(f"sections has {len(sections)} items — minimum is {MIN_SECTIONS}")
    if len(sections) > MAX_SECTIONS:
        errors.append(f"sections has {len(sections)} items — maximum is {MAX_SECTIONS}")

    for i, section in enumerate(sections):
        if not isinstance(section, dict):
            errors.append(f"sections[{i}]: not an object")
            continue
        missing_keys = REQUIRED_SECTION_KEYS - set(section.keys())
        if missing_keys:
            errors.append(f"sections[{i}]: missing keys: {', '.join(sorted(missing_keys))}")
        for key in REQUIRED_SECTION_KEYS:
            val = section.get(key, "")
            if not isinstance(val, str) or not val.strip():
                errors.append(f"sections[{i}].{key}: must be a non-empty string")

    return errors


def run(is_dry_run: bool = False):
    """Main generation pipeline."""
    print("=" * 60)
    print("📰 Gahwa Newsletter — Stage 2: AI Generation (DeepSeek)")
    print(f"   Date:    {TODAY}")
    print(f"   Output:  {OUTPUT_DIR / 'latest-newsletter.json'}")
    if is_dry_run:
        print("   [DRY RUN MODE — No files will be written]")
    print("=" * 60)

    # ── Step 1: Load API key ─────────────────────────────────────────────
    print("\n🔑 Loading API key...")
    api_key = load_env()
    print("   ✅ DEEPSEEK_API_KEY found")

    # ── Step 2: Build prompt ─────────────────────────────────────────────
    print("\n📝 Building generation prompt...")
    prompt = build_prompt()

    # ── Step 3: Call DeepSeek API ────────────────────────────────────────
    print("\n🤖 Calling DeepSeek API...")
    newsletter = call_deepseek(api_key, prompt)
    print(f"   ✅ Response received ({len(json.dumps(newsletter))} bytes)")

    # ── Step 4: Validate schema ──────────────────────────────────────────
    print("\n🔍 Validating schema...")
    errors = validate_schema(newsletter)
    if errors:
        print("   ❌ Validation failed:")
        for err in errors:
            print(f"      • {err}")
        print("\n   ❌ Newsletter generation failed validation")
        sys.exit(1)
    print(f"   ✅ Valid — {len(newsletter['sections'])} sections")

    # ── Step 5: Save to output directory ─────────────────────────────────
    print(f"\n💾 Saving to {OUTPUT_DIR / 'latest-newsletter.json'}...")
    if not is_dry_run:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = OUTPUT_DIR / "latest-newsletter.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(newsletter, f, indent=2, ensure_ascii=False)
        print(f"   ✅ File saved ({output_path.stat().st_size} bytes)")
    else:
        print("   ⏭️  (skipped — dry run)")

    # ── Summary ──────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("✅ GENERATION COMPLETE")
    print(f"   Date:     {TODAY}")
    print(f"   Sections: {len(newsletter['sections'])}")
    print(f"   File:     {OUTPUT_DIR / 'latest-newsletter.json'}")
    print("=" * 60)


if __name__ == "__main__":
    is_dry_run = "--dry-run" in sys.argv
    run(is_dry_run)
