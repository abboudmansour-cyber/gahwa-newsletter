#!/usr/bin/env node

/**
 * sync-drive.js — Google Drive sync layer for Gahwa Newsletter
 *
 * Builds a master context file and syncs it to the GAHWA_MASTER_CONTEXT
 * Google Drive folder. This acts as the external AI-readable "memory layer"
 * for Gemini (and other AI tools).
 *
 * Usage:
 *   node operator/sync-drive.js
 *
 * Authentication (in order of precedence):
 *   1. Service account JSON key at operator/gdrive-service-account.json
 *   2. OAuth refresh token from .env (GDRIVE_REFRESH_TOKEN + GDRIVE_CLIENT_ID + GDRIVE_CLIENT_SECRET)
 *
 * Environment variables (optional when using service account):
 *   GDRIVE_REFRESH_TOKEN  — OAuth refresh token
 *   GDRIVE_CLIENT_ID      — OAuth client ID
 *   GDRIVE_CLIENT_SECRET  — OAuth client secret
 *
 * @module sync-drive
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { google } from "googleapis";

// ── Path setup ──────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const OUTPUT_DIR = path.join(__dirname, "output");
const MASTER_CONTEXT_FILE = path.join(OUTPUT_DIR, "master-context.md");
const SERVICE_ACCOUNT_KEY = path.join(__dirname, "gdrive-service-account.json");

const DRIVE_FOLDER_NAME = "GAHWA_MASTER_CONTEXT";

// ── Logging helpers ──────────────────────────────────────────────────────

function logInfo(msg) {
  console.log(`  ℹ️  ${msg}`);
}

function logSuccess(msg) {
  console.log(`  ✅ ${msg}`);
}

function logWarn(msg) {
  console.warn(`  ⚠️  ${msg}`);
}

function logError(msg) {
  console.error(`  ❌ ${msg}`);
}

// ── File reading helpers ────────────────────────────────────────────────

/**
 * Read a file if it exists, return null otherwise.
 */
function readFileIfExists(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content;
  } catch {
    return null;
  }
}

/**
 * Find the latest markdown file in a directory matching a pattern.
 */
function findLatestMarkdown(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    const mdFiles = files
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({
        name: f,
        path: path.join(dirPath, f),
        mtime: fs.statSync(path.join(dirPath, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (mdFiles.length > 0) {
      const content = fs.readFileSync(mdFiles[0].path, "utf-8");
      return {
        filename: mdFiles[0].name,
        content,
        path: mdFiles[0].path,
        size: content.length,
      };
    }
  } catch {
    // directory doesn't exist or is empty
  }
  return null;
}

/**
 * List all markdown files in the /output directory sorted by recency.
 */
function listOutputMarkdownFiles() {
  try {
    const outputPath = path.resolve(PROJECT_ROOT, "output");
    const files = fs.readdirSync(outputPath);
    return files
      .filter((f) => f.endsWith(".md") || f.endsWith(".json"))
      .map((f) => ({
        name: f,
        path: path.join(outputPath, f),
        mtime: fs.statSync(path.join(outputPath, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

// ── SECTION 1: Build Master Context ─────────────────────────────────────

/**
 * Build the complete master context markdown document.
 * Deterministic — always produces the same output for the same source files.
 */
function buildMasterContext() {
  const timestamp = new Date().toISOString();

  const sections = [];

  // ── Header ───────────────────────────────────────────────────────────
  sections.push(`# GAHWA NEWSLETTER — MASTER CONTEXT

> **Generated:** ${timestamp}
> **Purpose:** External AI-readable memory layer for Gemini and other AI tools
> **Source:** Local repository at \`/Users/AM/Documents/gahwa-newsletter\`
> **System of Record:** GitHub (abboudmansour-cyber/gahwa-newsletter)
> **Sync Target:** Google Drive folder \`GAHWA_MASTER_CONTEXT\`
`);

  // ── Section 1: Project Overview ──────────────────────────────────────
  sections.push(`## 1. PROJECT OVERVIEW

**Name:** The Gahwa Newsletter Pipeline (a.k.a. STARTUP SCOUT OS v5)
**Tagline:** "The Gulf Brief — A Premium Daily Brew of Gulf Insight"
**Mission:** Automated daily GCC business intelligence newsletter for Saudi/GCC executives
**Runtime:** Google Apps Script (deployed via Hetzner VPS → clasp)
**AI Backend:** DeepSeek v4 (Anthropic-compatible endpoint)
**Brand:** "THE GAHWA" (public subscriber-facing) / "STARTUP SCOUT" (internal)

### Key Stats & Context
- **GCC Inventory Gap:** $8.7–9.4B in misallocated FMCG inventory across the Kingdom
- **Audience:** Saudi MDs, CEOs, FMCG executives
- **Tone:** "Morning Brew energy meets regional intelligence" — direct, data-driven, authoritative
- **Delivery:** Daily via Gmail (Monday–Saturday), no Sunday edition

### GAHWA-R Scoring Framework
| Dimension | Weight |
|-----------|--------|
| GCC Proximity | 30% |
| Actionability | 20% |
| Human Interest | 15% |
| Why Today | 20% |
| Autonomy/Novelty | 15% |
| **Score out of** | **25** |
`);

  // ── Section 2: Current Architecture ──────────────────────────────────
  sections.push(`## 2. CURRENT ARCHITECTURE

### System Map
\`\`\`
Developer → GitHub → Hetzner VPS (git pull + clasp push) → Google Apps Script → Gmail/Drive/RSS
\`\`\`

### Layer 1: AI Generation (Hetzner VPS)
- **Compute:** Hetzner Linux VM (CX22, ~€5–8/month)
- **Scheduler:** Cron job at \`/etc/cron.d/gahwa-newsletter\` (6:00 AM SAST, Mon–Sat)
- **AI Model:** DeepSeek v4 via \`https://api.deepseek.com/anthropic/v1/messages\`
- **Fast model:** \`deepseek-v4-flash\` (max_tokens: 8000) — extraction
- **Smart model:** \`deepseek-v4-pro\` (max_tokens: 8096) — scoring + content gen
- **Local operator scripts:** \`operator/daily-runner.js\`, \`operator/operator.js\`, \`operator/deepseek.js\`
- **Sync layer:** \`operator/sync-drive.js\` — builds + uploads master context to Google Drive

### Layer 2: Rendering & Delivery (Google Apps Script)
- **Script ID:** \`1s9_k1zGgRgCzxWRLtjzoPVAPEKUuCQ9GL7PofLPkRQKqTtdLAteL6sY5\`
- **Key files:**
  - \`scripts/Code.gs\` — Pipeline orchestrator (4 steps + weekly + health)
  - \`scripts/Claude.gs\` — DeepSeek API wrapper + AI prompts + webhook handler
  - \`scripts/Parser.gs\` — Pure text parsing
  - \`scripts/Utilities.gs\` — Secrets, logging, Drive/Doc, email, triggers, state mgmt
  - \`scripts/Render.gs\` — HTML section renderers + SVG visual builders
  - \`scripts/Html.gs\` — Bundled templates (2550 lines: Scout + Gahwa CSS/rendering)
  - \`scripts/Aggregatenewsletters.js\` — RSS (20 categories) + Gmail aggregator
  - \`scripts/appsscript.json\` — GAS manifest (Asia/Riyadh, V8 runtime)

### Layer 3: Orchestration & Storage (GitHub)
- **Repository:** \`abboudmansour-cyber/gahwa-newsletter\`
- **CI/CD:** \`.github/workflows/deploy.yml\` — GitHub Actions → SSH → Hetzner → clasp push
- **Docs memory system:** \`/docs\` directory with 7 curated files
- **Operator scripts:** \`/operator\` directory with autonomous execution engine

### Layer 4: External Memory (Google Drive)
- **Folder:** \`GAHWA_MASTER_CONTEXT\`
- **Purpose:** Continuously updated context file for AI tools (Gemini, etc.)
- **Mechanism:** \`operator/sync-drive.js\` overwrites file on each run
`);

  // ── Section 3: Latest System State ──────────────────────────────────
  const checkpoint = readFileIfExists(
    path.resolve(PROJECT_ROOT, "CHECKPOINT.md")
  );

  if (checkpoint) {
    sections.push(`## 3. LATEST SYSTEM STATE

The following checkpoint data reflects the most recent milestone and project status:

${checkpoint}
`);
  } else {
    sections.push(`## 3. LATEST SYSTEM STATE

*No CHECKPOINT.md found — system state not available.*
`);
  }

  // ── Section 4: Latest Newsletter Output ─────────────────────────────
  sections.push(`## 4. LATEST NEWSLETTER OUTPUT

`);

  // Check operator/output first
  const operatorOutputFile = findLatestMarkdown(OUTPUT_DIR);
  if (operatorOutputFile && operatorOutputFile.filename !== "master-context.md") {
    sections.push(`**Source:** \`operator/output/${operatorOutputFile.filename}\`
**Size:** ${operatorOutputFile.size} bytes
**Last modified:** ${new Date(fs.statSync(operatorOutputFile.path).mtime).toISOString()}

${operatorOutputFile.content}
`);
  }

  // Check root /output directory
  const rootOutputFiles = listOutputMarkdownFiles();
  if (rootOutputFiles.length > 0) {
    for (const file of rootOutputFiles) {
      const content = readFileIfExists(file.path);
      if (content) {
        sections.push(`### output/${file.name}

**Last modified:** ${new Date(file.mtime).toISOString()}

${content}

---
`);
      }
    }
  }

  if (!operatorOutputFile && rootOutputFiles.length === 0) {
    sections.push(`*No newsletter output files found. The pipeline has not produced any output yet.*
`);
  }

  // ── Section 5: Operator Capabilities Summary ────────────────────────
  sections.push(`## 5. OPERATOR CAPABILITIES SUMMARY

### Available Operator Scripts

| Script | Purpose |
|--------|---------|
| \`operator/operator.js\` | Autonomous execution engine — takes a task, generates a plan via DeepSeek, executes steps (docs/fs/git) |
| \`operator/daily-runner.js\` | Daily newsletter generation — end-to-end: generate → validate → save → git push → webhook |
| \`operator/deepseek.js\` | DeepSeek API wrapper — call + retry logic + JSON parsing |
| \`operator/github.js\` | Git automation — add, commit, push in one call |
| \`operator/scheduler.js\` | Scheduled job runner — reads schedule.json, executes jobs, prevents duplicates |
| \`operator/sync-drive.js\` | **NEW** — builds master context + syncs to Google Drive |
| \`operator/gemini.js\` | Gemini API wrapper (secondary/fallback AI) |

### Execution Actions
| Action | Description |
|--------|-------------|
| \`docs\` | Write file content (FILE: path + content after ---) |
| \`fs\` | File system operations (CREATE/PATCH/APPEND/DELETE) |
| \`git\` | Commit and push to GitHub |

### Safety Features
- Path validation against blocklisted patterns (../, ~, /etc, /system)
- Critical file protection (cannot overwrite operator.js, .env, schedule.json, etc.)
- DELETE operations blocked by safety policy
- Dry-run mode (\`--dry-run\`) for testing without side effects
- Continuation triggers handle 6-minute GAS execution limit

### Pipeline State Management
- Daily markers prevent duplicate runs (\`.daily-marker-YYYY-MM-DD\`)
- Partial output saved on failure for debugging
- Lock files prevent concurrent scheduler execution (5-minute cooldown)
`);

  // ── Section 6: Current Pipeline Flow ────────────────────────────────
  sections.push(`## 6. CURRENT PIPELINE FLOW (END-TO-END)

### Daily Execution (6:00 AM SAST, Mon–Sat)

\`\`\`
1. Cron (Hetzner) → node operator/daily-runner.js
   ↓
2. Idempotency check (skip if already ran today)
   ↓
3. DeepSeek API call → generate newsletter JSON
   ↓
4. Schema validation
   ↓
5. Save to operator/output/latest-newsletter.json
   ↓
6. Git add + commit + push to GitHub
   ↓
7. POST to Apps Script webhook → HTML render → email subscribers
   ↓
8. Mark today complete
\`\`\`

### Apps Script Pipeline (After Webhook Receives Content)

\`\`\`
6:00 AM  → aggregateNewsletters() — Build Intel Dump (20 RSS categories + Gmail)
9:00 AM  → runScoutStep1() — Extract signals via DeepSeek Flash
Auto     → runScoutStep2() — Score + Rank signals (GAHWA-R framework)
Auto     → runScoutStep3() — Generate Parts 2-7 (Themes, Viral, Startup, etc.)
Auto     → runScoutStep4() — Build HTML + Email via Gmail
11:00 AM → dailyHealthCheck() — Verify delivery
Saturday → runWeeklyRollup() + consolidateWeeklyIntel()
2:00 AM  → cleanupTempDocs()
\`\`\`

### Sync Layer (On-Demand)

\`\`\`
node operator/sync-drive.js
   ↓
1. Read CHECKPOINT.md, output files, docs, operator capabilities
   ↓
2. Build master-context.md → operator/output/master-context.md
   ↓
3. Authenticate to Google Drive (service account or OAuth)
   ↓
4. Find/create GAHWA_MASTER_CONTEXT folder
   ↓
5. Delete any existing files in folder
   ↓
6. Upload fresh master-context.md
   ↓
7. Log: "SYNC COMPLETE"
\`\`\`

### Key Integrations
| System | Direction | Protocol |
|--------|-----------|----------|
| GitHub ↔ Hetzner | Bidirectional | SSH + git pull/push |
| Hetzner → Apps Script | One-way | HTTP POST (webhook) |
| Local → Google Drive | One-way | Google Drive API v3 |
| Apps Script → Gmail | One-way | GmailApp.sendEmail() |
| GitHub Actions → Hetzner | One-way | SSH deploy |
`);

  // ── Section 7: Recent Changelog ──────────────────────────────────────
  const changelog = readFileIfExists(
    path.resolve(PROJECT_ROOT, "docs", "changelog.md")
  );
  if (changelog) {
    // Only include the most recent entry (up to the next --- or ## YYYY)
    const recentChangelog = changelog.split(/^## \d{4}/m)[0] || changelog;
    sections.push(`## 7. RECENT CHANGELOG

${recentChangelog}
`);
  }

  // ── Final assembly ──────────────────────────────────────────────────
  const fullContent = sections.join("\n\n---\n\n");

  // Ensure deterministic output (no trailing whitespace variations)
  const deterministic = fullContent
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trimEnd();

  return deterministic;
}

// ── SECTION 2: Google Drive Sync ─────────────────────────────────────────

/**
 * Authenticate to Google Drive using either:
 *   1. Service account JSON key (preferred)
 *   2. OAuth refresh token from .env
 *
 * Returns an authenticated drive client.
 */
async function authenticateDrive() {
  // ── Try service account first ────────────────────────────────────────
  if (fs.existsSync(SERVICE_ACCOUNT_KEY)) {
    logInfo("Authenticating via service account key...");
    const auth = new google.auth.GoogleAuth({
      keyFile: SERVICE_ACCOUNT_KEY,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    const client = await auth.getClient();
    return google.drive({ version: "v3", auth: client });
  }

  // ── Fallback: OAuth refresh token ───────────────────────────────────
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;
  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;

  if (refreshToken && clientId && clientSecret) {
    logInfo("Authenticating via OAuth refresh token...");
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    // Refresh to get a fresh access token
    await oauth2Client.refreshAccessToken();

    return google.drive({ version: "v3", auth: oauth2Client });
  }

  // ── No valid auth available ─────────────────────────────────────────
  throw new Error(
    "No Google Drive authentication found.\n" +
      "  Provide either:\n" +
      "    1. Service account key at operator/gdrive-service-account.json\n" +
      "    2. OAuth credentials in .env (GDRIVE_REFRESH_TOKEN, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET)"
  );
}

/**
 * Find or create the GAHWA_MASTER_CONTEXT folder.
 * Returns the folder ID.
 */
async function findOrCreateFolder(drive) {
  logInfo(`Looking for folder "${DRIVE_FOLDER_NAME}"...`);

  // Search for existing folder
  const response = await drive.files.list({
    q: `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 10,
  });

  const folders = response.data.files;

  if (folders && folders.length > 0) {
    logSuccess(`Found existing folder "${DRIVE_FOLDER_NAME}" (ID: ${folders[0].id})`);
    return folders[0].id;
  }

  // Create folder if not found
  logInfo(`Folder "${DRIVE_FOLDER_NAME}" not found. Creating...`);
  const fileMetadata = {
    name: DRIVE_FOLDER_NAME,
    mimeType: "application/vnd.google-apps.folder",
  };

  const createResponse = await drive.files.create({
    requestBody: fileMetadata,
    fields: "id",
  });

  logSuccess(`Created folder "${DRIVE_FOLDER_NAME}" (ID: ${createResponse.data.id})`);
  return createResponse.data.id;
}

/**
 * List all files currently in the GAHWA_MASTER_CONTEXT folder.
 */
async function listFilesInFolder(drive, folderId) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id, name, modifiedTime)",
    pageSize: 100,
  });

  return response.data.files || [];
}

/**
 * Delete a file from Google Drive by ID.
 */
async function deleteFile(drive, fileId) {
  await drive.files.delete({ fileId });
}

/**
 * Upload a file to the GAHWA_MASTER_CONTEXT folder.
 * If file already exists, overwrite it (delete + re-upload).
 */
async function uploadMasterContext(drive, folderId, content) {
  const fileName = "master-context.md";
  const existingFiles = await listFilesInFolder(drive, folderId);

  // Delete all existing files in the folder to prevent duplicates
  for (const file of existingFiles) {
    logInfo(`Deleting existing file: "${file.name}" (ID: ${file.id})`);
    try {
      await deleteFile(drive, file.id);
    } catch (err) {
      logWarn(`Could not delete "${file.name}": ${err.message}`);
    }
  }

  // Upload fresh file
  logInfo(`Uploading "${fileName}" to folder...`);
  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };

  const media = {
    mimeType: "text/markdown",
    body: Buffer.from(content, "utf-8"),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: "id, name, webViewLink, size",
  });

  logSuccess(`Uploaded "${response.data.name}" (ID: ${response.data.id})`);
  logInfo(`View URL: ${response.data.webViewLink || "(no web link available)"}`);

  return response.data;
}

// ── MAIN ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🔄 GAHWA — DRIVE SYNC");
  console.log("=".repeat(60));

  // ── STEP 1: Build master context ────────────────────────────────────
  console.log("\n⏳ Building master context...");
  const content = buildMasterContext();

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Write local copy
  fs.writeFileSync(MASTER_CONTEXT_FILE, content, "utf-8");
  const sizeBytes = Buffer.byteLength(content, "utf-8");
  console.log(`[MASTER CONTEXT BUILT]`);
  logInfo(`File: ${MASTER_CONTEXT_FILE}`);
  logInfo(`Size: ${(sizeBytes / 1024).toFixed(1)} KB (${sizeBytes} bytes)`);
  logInfo(`Lines: ${content.split("\n").length}`);

  // ── STEP 2: Upload to Google Drive ──────────────────────────────────
  console.log("\n⏳ Connecting to Google Drive...");
  console.log("[UPLOADING TO GOOGLE DRIVE...]");

  try {
    const drive = await authenticateDrive();
    const folderId = await findOrCreateFolder(drive);
    await uploadMasterContext(drive, folderId, content);

    console.log("\n" + "=".repeat(60));
    console.log("[SYNC COMPLETE]");
    logSuccess(`master-context.md pushed to Google Drive folder "${DRIVE_FOLDER_NAME}"`);
    logInfo(`Local: ${MASTER_CONTEXT_FILE}`);
    console.log("=".repeat(60));
  } catch (err) {
    console.log("\n" + "=".repeat(60));
    console.error("❌ [SYNC FAILED]");
    logError(`${err.message}`);
    if (err.response?.data?.error) {
      logError(`API Error: ${JSON.stringify(err.response.data.error)}`);
    }
    console.log("=".repeat(60));
    process.exit(1);
  }
}

main();
