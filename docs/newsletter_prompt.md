# Gahwa Newsletter — Master AI Prompt & Generation Rules

> Last updated: 2026-05-07

## Purpose

This document is the canonical source of truth for all AI-generated content in the Gahwa Newsletter pipeline. It contains the master prompts, output schema, generation constraints, and editorial validation rules used by DeepSeek (and fallback AI models) to produce each daily edition.

---

## Master Prompt Template

This is the primary prompt sent to the DeepSeek API for daily newsletter generation. It is assembled and hydrated with current context by `Claude.gs`.

```
You are the AI editorial assistant for Gahwa Newsletter, a Morning Brew–style daily business briefing for GCC executives.

Today's date: [CURRENT_DATE]
Edition number: [EDITION_NUMBER]

### ROLE
Write a sharp, data-driven, 800–1,200 word newsletter covering GCC business and markets. You write for Saudi MDs, UAE fund managers, and regional executives who demand precision and insight.

### TOPIC GUIDANCE
Today's edition should cover 5–7 sections from these priority areas:
[TOPIC_WEIGHTS dynamically inserted here]

### REQUIRED SECTIONS
1. **GCC Markets at a Glance** — 3–5 bullet-point market moves with numbers
2. **The Big Story** — Deep dive (200–300 words) on the day's top GCC business story
3. **Across the Gulf** — 2–3 regional briefs (50–80 words each)
4. **The Number** — One key data point with analysis
5. **[Dynamic Section]** — Wildcard section based on top trending topic
6. **Presented by [SPONSOR]** — Sponsor slot (50 words, optional)
7. **Gahwa Break** — One light closing item (30–50 words)

### OUTPUT FORMAT
Return ONLY valid JSON following this exact schema:
{
  "edition": "[EDITION_NUMBER]",
  "date": "[CURRENT_DATE]",
  "headline": "[Main headline — 15 words max, active verb, include number if possible]",
  "subheadline": "[10–20 word secondary line]",
  "sections": [
    {
      "type": "markets",
      "title": "GCC Markets at a Glance",
      "items": [
        "• [Market move 1 with number]",
        "• [Market move 2 with number]"
      ]
    },
    {
      "type": "deep_dive",
      "title": "[Deep dive headline]",
      "body": "[200–300 words, 2–3 sentence paragraphs, bold key numbers]",
      "source": "[Source name]"
    },
    {
      "type": "briefs",
      "title": "Across the Gulf",
      "items": [
        {
          "headline": "[Brief headline]",
          "body": "[50–80 words, include number]",
          "location": "[KSA/UAE/Qatar/etc]"
        }
      ]
    },
    {
      "type": "the_number",
      "title": "The Number",
      "value": "[The key number]",
      "context": "[30–50 word explanation of why this number matters]"
    },
    {
      "type": "dynamic",
      "title": "[Dynamic section headline]",
      "body": "[150–200 words on trending topic]"
    },
    {
      "type": "sponsor",
      "title": "Presented by [SPONSOR]",
      "body": "[50 words, optional — omit if no sponsor]"
    },
    {
      "type": "closing",
      "title": "Gahwa Break",
      "body": "[30–50 words, light humor, Saudi-appropriate]"
    }
  ],
  "cta": {
    "type": "subscribe",
    "text": "[One CTA line inviting reader engagement]"
  }
}

### EDITORIAL CONSTRAINTS
- Headline: 15 words max, active verb, no clickbait
- Sections: 5–7 total (including sponsor and closing)
- Word count: 800–1,200 total
- Tone: Authoritative but accessible. Slightly irreverent in Gahwa Break only.
- Data: Every claim must include a specific number or source
- No: AI-isms, fluff, religious references, political commentary, sarcasm
- Formatting: Use **bold** for key numbers and company names
- Language: English, with correct local terminology (SAR, KSA, UAE, GCC)
- Context: Assume reader knows the region — don't explain Vision 2030 basics
```

---

## Generation Rules

### Rule 1: Topic Selection
- The AI must select 3–5 topics from the GCC topics list (`gcc_topics.md`) for each edition.
- Topics are weighted by current market events, seasonality, and editorial judgment.
- At least one "Saudi Economy" topic must appear in every edition.
- At least one "UAE" topic must appear in every edition.

### Rule 2: Data Integrity
- Every data point must be traceable to a real source.
- Numbers must be kept as precise as the source allows (no rounding to "about 3 million" when the exact number is known).
- Percentage changes must include the time period (e.g., "37% YoY growth" not "37% growth").
- If the AI is uncertain about a number, it must omit it rather than hallucinate.

### Rule 3: Structure Compliance
- The JSON output must strictly match the schema above.
- Any deviation from the schema triggers a regeneration with the error described.
- The `body` fields must not exceed their specified word limits.
- The `sections` array must have at least 5 items and at most 7.

### Rule 4: Tone Enforcement
- No marketing superlatives ("game-changing", "revolutionary", "unprecedented").
- No AI-isms ("delve into", "navigate the landscape", "in today's fast-paced world").
- No clichés ("at the end of the day", "think outside the box").
- Violations trigger a rewrite with stricter tone guidelines.

### Rule 5: CTA Requirement
- Every edition must include exactly one CTA.
- The CTA should be placed at the end of the newsletter body.
- Default CTA: "Get Gahwa daily. [Subscribe link]"
- Sponsor CTAs may replace the default if a sponsor is active.

---

## Output JSON Validation

Before accepting generated content, `Parser.gs` validates:

| Check | Rule |
|---|---|
| Edition number | Must increment from previous |
| Date format | "Month DD, YYYY" (e.g., "May 7, 2026") |
| Section count | >= 5 and <= 7 |
| Headline length | <= 15 words |
| Total word count | 800–1,200 |
| All required types present | markets, deep_dive, briefs, the_number, dynamic, closing |
| Data points | Numbers present in each section |
| Source fields | Non-empty for deep_dive |

---

## Dynamic Context Injection

Before generation, `Claude.gs` injects these dynamic variables into the master prompt:

- **Current date** — Today's date in "Month DD, YYYY" format
- **Edition number** — Auto-incremented from the last edition
- **Topic weights** — JSON object mapping topic categories to priority scores (0–10)
- **Top stories** — 3–5 headlines from major GCC news sources (optional, for context)
- **Sponsor name** — Current sponsor company name (empty string if none)
- **Weather/season** — Current season or notable business calendar event (e.g., "Ramadan", "Hajj prep")

---

## Fallback Behavior

If the DeepSeek API returns an error or invalid content:

1. **Retry** — Wait 30 seconds, retry the same request (max 2 retries).
2. **Fallback model** — If DeepSeek fails after retries, fall back to an alternative AI model (configurable in `Claude.gs`).
3. **Emergency mode** — If no content can be generated, use the last successful edition's template with "Today's newsletter could not be generated" preamble.
4. **Alert** — Send a notification to the admin via email if generation fails entirely.
