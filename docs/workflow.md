# Gahwa Newsletter — Workflow

> Last updated: 2026-05-07

## Overview

The Gahwa Newsletter generation workflow is a fully automated daily pipeline that runs from content generation to subscriber delivery without manual intervention. This document describes every stage of the workflow.

---

## Daily Generation Flow

The newsletter is generated once per day, targeting delivery by 7:00 AM Saudi Arabia Standard Time (SAST, UTC+3).

### Timeline

| Time (SAST) | Stage | Component | Description |
|---|---|---|---|
| 7:00 AM | Trigger | Hetzner cron | Cron initiates generation via local webhook POST |
| 7:01 AM | Prompt Assembly | `Claude.gs` / Python | Dynamic context injected into master prompt |
| 7:02 AM | AI Generation | DeepSeek API | Content generated via API call |
| 7:05 AM | Validation | Python / `Parser.gs` | JSON validated against schema |
| 7:06 AM | Push to Apps Script | `send_to_apps_script.sh` | Validated JSON sent to Apps Script |
| 7:08 AM | HTML Rendering | `Render.gs` + `Html.gs` | JSON compiled into HTML email |
| 7:09 AM | Delivery | `Code.gs` | Email sent to subscriber list |
| 7:10 AM | Logging | `Utilities.gs` | Delivery status logged |

---

## Step-by-Step Workflow

### 1. Cron Execution

The Hetzner VM has a cron job that sends a local POST to the webhook listener:

```
0 7 * * * curl -s -X POST http://127.0.0.1:3000/webhook \
  -H 'Content-Type: application/json' \
  -d '{"job":"daily-newsletter","trigger":"cron"}' \
  >> /opt/gahwa-newsletter/operator/logs/cron-daily.log 2>&1
```

- Runs daily at 7:00 AM SAST.
- The listener handles locking, git pull (if needed), and operator execution.
- This is the same endpoint that receives GitHub webhooks on push events.

### 2. Prompt Assembly

`Claude.gs` (or its Python equivalent on Hetzner) performs prompt assembly:

1. Loads the master prompt template from `newsletter_prompt.md`.
2. Injects dynamic context: current date, edition number, topic weights, top stories.
3. Hydrates any sponsor information.
4. Prepares the final prompt string for API submission.

### 3. AI Generation

The assembled prompt is sent to the DeepSeek API:

```
POST https://api.deepseek.com/v1/chat/completions
```

- **Model**: deepseek-chat (or configured model)
- **Temperature**: 0.7 (balances creativity with consistency)
- **Max tokens**: 4,096
- **Response format**: JSON mode enabled

**Error handling:**
- API timeout: 60 seconds. Retry after 30 seconds (max 2 retries).
- Invalid JSON response: Re-request with stricter schema enforcement.
- Empty response: Fallback to alternative model.

### 4. Validation

The raw AI output is validated by the Python script on Hetzner:

1. Parse JSON response.
2. Check all required fields exist.
3. Validate word counts and section counts.
4. Check data consistency (numbers present, sources cited).
5. If validation fails → regeneration with error feedback.
6. If validation passes → save to `output/` directory.

### 5. Push to Apps Script

Validated content is pushed to Google Apps Script via HTTP:

```bash
./scripts/send_to_apps_script.sh output/YYYY-MM-DD-edition.json
```

This script:
1. Reads the JSON file.
2. Sends it as a POST request to the Apps Script web app URL.
3. Confirms receipt with a 200 response.
4. Logs the push status.

**Apps Script web app endpoint** (defined in `Code.gs`):
```
function doPost(e) {
  const content = JSON.parse(e.postData.contents);
  // Validate, store, and queue for rendering
}
```

### 6. HTML Rendering

Inside Apps Script, `Render.gs` and `Html.gs` handle rendering:

1. `Parser.gs` parses the received JSON into structured objects.
2. `Render.gs` maps each section type to its HTML template.
3. Templates from `Html.gs` are hydrated with section content.
4. The complete HTML document is assembled (header, body sections, footer).
5. Plain text alternative is generated for email clients that don't support HTML.

### 7. Email Delivery

`Code.gs` handles final delivery:

```
GmailApp.sendEmail(
  recipient,
  subject,
  plainTextBody,
  {
    htmlBody: htmlBody,
    from: "gahwa@yourdomain.com",
    name: "Gahwa Newsletter"
  }
);
```

- Recipient list is stored in Google Sheets or as a script property.
- Each recipient gets a personalized (but identical content) email.
- Delivery failures are logged but do not halt the batch.

### 8. Logging

`Utilities.gs` writes delivery metrics to a logging spreadsheet:

| Field | Description |
|---|---|
| Date | Delivery date |
| Edition | Edition number |
| Recipients | Number of successful sends |
| Failures | Number of failed sends |
| Generation Time | Total pipeline duration |
| AI Model | Model used for generation |

---

## Weekly / Monthly Workflows

### Sunday (No Edition)
No cron runs on Sunday. The day is reserved for:
- Pipeline maintenance and testing
- Content calendar planning for the week ahead
- Metadata updates (topic weights, sponsor pipeline)

### Monthly Review
- Analytics review: open rates, click-through rates, subscriber growth
- Topic weight adjustments based on performance data
- Prompt refinement based on editorial quality assessment
- Infrastructure maintenance (VM updates, script updates)

### Quarterly Refresh
- Full editorial style review
- Topic taxonomy audit
- Sponsor pipeline review
- Deployment pipeline health check

---

## Manual Override

If pipeline automation fails, manual generation can be triggered:

```bash
# Generate a single edition manually
./scripts/deploy.sh generate --edition 142

# Push existing content to Apps Script
./scripts/send_to_apps_script.sh output/cached-edition.json

# Regenerate if content was rejected
./scripts/deploy.sh regenerate --reason "schema validation failed"
```

Manual overrides require direct SSH access to the Hetzner VM (not from CI) and are logged in `changelog.md`.
