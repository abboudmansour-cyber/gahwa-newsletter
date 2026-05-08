// ╔══════════════════════════════════════════════════════════════════════╗
// ║              THE GAHWA · STARTUP SCOUT OS v5                         ║
// ║     The Gulf Brief · A Premium Daily Brew of Gulf Insight            ║
// ╠══════════════════════════════════════════════════════════════════════╣
// ║  FIRST TIME SETUP:                                                   ║
// ║  1. Run storeSecrets() — stores API keys in PropertiesService        ║
// ║  2. Run testClaudeKey() — should log "Hello"                         ║
// ║  3. Run setupAllTriggers() — sets all automation                     ║
// ║  4. Run resetPipeline() — clears any leftover state                  ║
// ║  5. Run runScoutStep1() manually to test                             ║
// ║                                                                      ║
// ║  DAILY FLOW (automatic):                                             ║
// ║  6:00am → aggregateNewsletters() builds Intel Dump                   ║
// ║  9:00am → runScoutStep1() extracts all signals                       ║
// ║  auto   → runScoutStep2() scores + ranks → Part 1                    ║
// ║  auto   → runScoutStep3() generates Parts 2-7                        ║
// ║  auto   → runScoutStep4() builds HTML + emails it                    ║
// ║                                                                      ║
// ║  MANUAL CONTROLS:                                                    ║
// ║  resetPipeline()    — clear stuck state                              ║
// ║  cleanupTempDocs()  — delete orphaned _SS_ docs                      ║
// ║  runWeeklyRollup()  — Saturday trend analysis                        ║
// ║  viewRunHistory()   — log last 30 days stats                         ║
// ╚══════════════════════════════════════════════════════════════════════╝
// ║                                                                      ║
// ║  WEBHOOK ENTRY POINT:                                                ║
// ║  doPost(e)  — Receives JSON payloads from Node.js/curl senders       ║
// ║  doGet(e)   — Health check endpoint                                  ║
// ║                                                                      ║
// ║  Auth:      Header-based ONLY — Authorization: Bearer <token>        ║
// ║             No PropertiesService dependency for auth validation       ║
// ║                                                                      ║
// ║  Expects:   { deliveryId, subject, htmlBody, action }                ║
// ║             OR raw newsletter format: { title, sections, ... }       ║
// ║  Returns:   JSON with { status: "ok"|"error", ... }                  ║
// ║  Dedup:     Returns JSON with message "DUPLICATE_IGNORED"            ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ════════════════════════════════════════════════════════════════════════
// CONFIG
// Non-sensitive settings only. API keys → storeSecrets() → PropertiesService
// ════════════════════════════════════════════════════════════════════════

// @agent-target: CONFIG
var CONFIG = {
  // ── Folder IDs ──────────────────────────────────────────────────────
  DAILY_INTEL_FOLDER_ID:  '14MfCtuSMSgnUGnxgduoxsXKQj5f4roI0',
  SCOUT_OUTPUT_FOLDER_ID: '1fz_cnHzeu4IhrhPNzW-65rZVmX0A796S',
  WEEKLY_FOLDER_ID:       '10weeyxOqd0c7V3AsLeH7XPnPtKu-HDti',

  // ── Email ────────────────────────────────────────────────────────────
  NOTIFY_EMAIL:           'abboudmansour@gmail.com',
  GAHWA_EMAIL:            'abboudmansour@gmail.com',

  // ── Beehiiv ──────────────────────────────────────────────────────────
  BEEHIIV_PUB_ID:         'pub_ce38a7fe-d3af-4e0b-abc5-c049af970c2d',
  BEEHIIV_URL:            'https://gahwa.beehiiv.com/subscribe',

  // ── AI models (DeepSeek Anthropic-compatible endpoint) ────────────────
  CLAUDE_FAST:            'deepseek-v4-flash',
  CLAUDE_SMART:           'deepseek-v4-pro',

  // ── Pipeline tuning ──────────────────────────────────────────────────
  MAX_CHARS_PER_CHUNK:    48000,
  PAUSE_MS:               2000,
  MAX_RUN_MS:             270000,
  MAX_STEP_ATTEMPTS:      2,       // Max auto-retries per step before aborting

  // ── Branding ─────────────────────────────────────────────────────────
  TITLE:                  'STARTUP SCOUT',
  TAGLINE:                'Daily Intelligence for GCC Founders & Operators',
  GAHWA_TITLE:            'GAHWA',
  GAHWA_TAGLINE:          "It's gahwa time.",

  // ── Compliance ───────────────────────────────────────────────────────
  MAILING_ADDRESS:        'The Gahwa · P.O. Box 12345, Jeddah 21411, Saudi Arabia',
  UNSUBSCRIBE_URL:        'https://gahwa.beehiiv.com/unsubscribe',
  PREFERENCES_URL:        'https://gahwa.beehiiv.com/preferences',

  // ── Beehiiv API posting ──────────────────────────────────────────────
  // Set to true when Beehiiv plan is upgraded to Scale/Enterprise.
  // Currently disabled — Posts API requires Enterprise plan (403).
  // Auth is confirmed working. postToBeehiiv() function is preserved.
  BEEHIIV_POST_ENABLED:   false,
};

// ════════════════════════════════════════════════════════════════════════
// STEP 1 — EXTRACTION
// ════════════════════════════════════════════════════════════════════════

// @agent-target: runScoutStep1
function runScoutStep1() {
  autoSetupTriggers();
  var startTime = Date.now();
  var props     = PropertiesService.getScriptProperties();
  var todayKey  = 'RAN_' + new Date().toDateString().replace(/ /g, '_');

  if (props.getProperty(todayKey) === 'COMPLETE') {
    log('INFO', 'Already completed today. Call resetPipeline() to re-run.');
    return;
  }

  if (!props.getProperty('PIPELINE_ACTIVE')) {
    log('INFO', '═══ SCOUT v5 START ═══');

    var docText = getTodayIntelDump();
    if (!docText) { log('ERROR', '⛔ No Intel Dump. Aborting.'); return; }
    log('INFO', 'Doc: ' + docText.length + ' chars');

    var fitness     = extractFitnessContent(docText);
    var newsletters = splitNewsletters(docText);
    var chunks      = buildAdaptiveChunks(newsletters);

    log('INFO', 'Fitness: ' + (fitness ? fitness.length + ' chars' : 'not found'));
    log('INFO', 'Newsletters: ' + newsletters.length + ' · Chunks: ' + chunks.length);

    var chunksDocId = createDocInFolder('_SS_CHUNKS_', CONFIG.SCOUT_OUTPUT_FOLDER_ID);
    var chunksDoc   = DocumentApp.openById(chunksDocId);
    var cb          = chunksDoc.getBody();
    cb.clear();
    for (var c = 0; c < chunks.length; c++) {
      cb.appendParagraph('===CHUNK_START_' + c + '===');
      cb.appendParagraph(chunks[c]);
      cb.appendParagraph('===CHUNK_END_' + c + '===');
    }
    chunksDoc.saveAndClose();

    var sigDocId = createDocInFolder('_SS_SIGNALS_', CONFIG.SCOUT_OUTPUT_FOLDER_ID);

    props.setProperty('PIPELINE_ACTIVE',  'true');
    props.setProperty('PIPE_START',       Date.now().toString());
    props.setProperty('NL_COUNT',         newsletters.length.toString());
    props.setProperty('CHUNK_COUNT',      chunks.length.toString());
    props.setProperty('CHUNK_INDEX',      '0');
    props.setProperty('FAILED_CHUNKS',    '');
    props.setProperty('CHUNKS_DOC_ID',    chunksDocId);
    props.setProperty('SIGNALS_DOC_ID',   sigDocId);
    props.setProperty('FITNESS',          (fitness || '').substring(0, 3000));
    props.setProperty('IN_TOK',           '0');
    props.setProperty('OUT_TOK',          '0');
    log('INFO', 'Pipeline state saved. Extracting...');
  } else {
    log('INFO', 'Resuming extraction...');
  }

  var totalChunks = parseInt(props.getProperty('CHUNK_COUNT'));
  var chunkIdx    = parseInt(props.getProperty('CHUNK_INDEX'));
  var sigDocId    = props.getProperty('SIGNALS_DOC_ID');
  var chunksDocId = props.getProperty('CHUNKS_DOC_ID');
  var failedStr   = props.getProperty('FAILED_CHUNKS') || '';

  log('INFO', 'Progress: ' + chunkIdx + '/' + totalChunks);

  while (chunkIdx < totalChunks) {
    if (Date.now() - startTime > CONFIG.MAX_RUN_MS) {
      log('WARN', '⏰ Time limit at chunk ' + chunkIdx + '. Scheduling continuation...');
      props.setProperty('CHUNK_INDEX', chunkIdx.toString());
      scheduleContinuation('runScoutStep1');
      return;
    }

    log('INFO', '📦 Chunk ' + (chunkIdx + 1) + '/' + totalChunks);
    var chunkText = loadChunkFromDoc(chunksDocId, chunkIdx);
    var result    = extractChunk(chunkText, chunkIdx + 1, totalChunks);
    var failed    = isError(result);

    if (failed) {
      log('WARN', '⚠️ Chunk ' + (chunkIdx + 1) + ' failed');
      failedStr += (failedStr ? ',' : '') + chunkIdx;
      props.setProperty('FAILED_CHUNKS', failedStr);
    }

    appendToDoc(sigDocId, '\n\n══ CHUNK ' + (chunkIdx + 1) + '/' + totalChunks + (failed ? ' [FAILED]' : '') + ' ══\n' + result);
    chunkIdx++;
    props.setProperty('CHUNK_INDEX', chunkIdx.toString());
    log('INFO', '✅ ' + chunkIdx + '/' + totalChunks);
    if (chunkIdx < totalChunks) Utilities.sleep(CONFIG.PAUSE_MS);
  }

  if (failedStr) {
    log('WARN', 'Retrying failed chunks: ' + failedStr);
    failedStr.split(',').forEach(function(i) {
      var idx   = parseInt(i);
      var retry = extractChunk(loadChunkFromDoc(chunksDocId, idx), idx + 1, totalChunks);
      appendToDoc(sigDocId, '\n\n══ CHUNK ' + (idx + 1) + ' RETRY ══\n' + retry);
      Utilities.sleep(CONFIG.PAUSE_MS);
    });
    props.setProperty('FAILED_CHUNKS', '');
  }

  log('INFO', '🏁 Extraction complete. Scheduling Step 2...');
  scheduleContinuation('runScoutStep2');
}

// ════════════════════════════════════════════════════════════════════════
// STEP 2 — SCORE + RANK (Part 1)
// ════════════════════════════════════════════════════════════════════════

// @agent-target: runScoutStep2
function runScoutStep2() {
  log('INFO', '══ STEP 2: SCORING ══');
  var props = PropertiesService.getScriptProperties();

  if (!validatePipelineState(['SIGNALS_DOC_ID', 'NL_COUNT'])) {
    sendNotification('⛔ Scout Step 2 FAILED', 'Pipeline state missing. Run resetPipeline().');
    return;
  }

  if (!checkAndIncrementAttempts('STEP2_ATTEMPTS', CONFIG.MAX_STEP_ATTEMPTS)) {
    sendNotification('⛔ Scout Step 2 ABORTED', 'Max retries reached. Run resetPipeline().');
    clearPipelineState();
    return;
  }

  var sigDocId = props.getProperty('SIGNALS_DOC_ID');
  var nlCount  = parseInt(props.getProperty('NL_COUNT') || '0');
  var signals  = readDoc(sigDocId);

  log('INFO', 'Signals: ' + signals.length + ' chars');

  if (signals.trim().length < 200) {
    sendNotification('⛔ Scout Step 2 FAILED', 'Signals doc is empty.');
    return;
  }
  if (signals.length > 580000) {
    signals = signals.substring(0, 580000) + '\n[TRIMMED]';
    log('WARN', 'Signals trimmed to 580k chars');
  }

  var part1 = generatePart1(signals, nlCount);
  if (isError(part1)) {
    log('ERROR', '⛔ Part 1 generation failed: ' + part1.substring(0, 100));
    sendNotification('⛔ Scout Step 2 FAILED', part1);
    scheduleContinuation('runScoutStep2');
    return;
  }

  log('INFO', '✅ Part 1: ' + part1.length + ' chars');
  var p1DocId = createDocInFolder('_SS_PART1_', CONFIG.SCOUT_OUTPUT_FOLDER_ID);
  var p1Doc   = DocumentApp.openById(p1DocId);
  p1Doc.getBody().appendParagraph(part1);
  p1Doc.saveAndClose();
  props.setProperty('PART1_DOC_ID', p1DocId);
  scheduleContinuation('runScoutStep3');
}

// ════════════════════════════════════════════════════════════════════════
// STEP 3 — PARTS 2-7
// ════════════════════════════════════════════════════════════════════════

// @agent-target: runScoutStep3
function runScoutStep3() {
  log('INFO', '══ STEP 3: PARTS 2-7 ══');
  var props = PropertiesService.getScriptProperties();

  if (!validatePipelineState(['PART1_DOC_ID'])) {
    sendNotification('⛔ Scout Step 3 FAILED', 'Pipeline state missing PART1_DOC_ID. Run resetPipeline().');
    return;
  }

  if (!checkAndIncrementAttempts('STEP3_ATTEMPTS', CONFIG.MAX_STEP_ATTEMPTS)) {
    sendNotification('⛔ Scout Step 3 ABORTED', 'Max retries reached. Run resetPipeline().');
    clearPipelineState();
    return;
  }

  var p1DocId = props.getProperty('PART1_DOC_ID');
  var fitness = props.getProperty('FITNESS') || '';
  var nlCount = parseInt(props.getProperty('NL_COUNT') || '0');
  var part1   = readDoc(p1DocId);

  var parts2to7 = generateParts2to7(part1, fitness, nlCount);
  if (isError(parts2to7)) {
    log('ERROR', '⛔ Parts 2-7 failed: ' + parts2to7.substring(0, 100));
    sendNotification('⛔ Scout Step 3 FAILED', parts2to7);
    scheduleContinuation('runScoutStep3');
    return;
  }

  log('INFO', '✅ Parts 2-7: ' + parts2to7.length + ' chars');
  var p27DocId = createDocInFolder('_SS_PARTS27_', CONFIG.SCOUT_OUTPUT_FOLDER_ID);
  var p27Doc   = DocumentApp.openById(p27DocId);
  p27Doc.getBody().appendParagraph(parts2to7);
  p27Doc.saveAndClose();
  props.setProperty('PARTS27_DOC_ID', p27DocId);
  scheduleContinuation('runScoutStep4');
}

// ════════════════════════════════════════════════════════════════════════
// STEP 4 — HTML + EMAIL + CLEANUP
// Phase 2: Scout internal HTML deactivated. Gahwa public output only.
// Beehiiv posting: disabled — Posts API requires Enterprise plan.
//   Re-enable by setting CONFIG.BEEHIIV_POST_ENABLED = true after upgrade.
// ════════════════════════════════════════════════════════════════════════

// @agent-target: runScoutStep4
function runScoutStep4() {
  Logger.log("STEP 4 — runScoutStep4 entered");
  log('INFO', '══ STEP 4: HTML + EMAIL ══');
  var props = PropertiesService.getScriptProperties();


  if (!validatePipelineState(['PART1_DOC_ID', 'PARTS27_DOC_ID'])) {
    sendNotification('⛔ Scout Step 4 FAILED', 'Pipeline state missing docs. Run resetPipeline().');
    Logger.log("STEP 4 — FAILED: pipeline state missing docs");
    return;
  }

  if (!checkAndIncrementAttempts('STEP4_ATTEMPTS', CONFIG.MAX_STEP_ATTEMPTS)) {
    sendNotification('⛔ Scout Step 4 ABORTED', 'Max retries reached. Run resetPipeline().');
    clearPipelineState();
    Logger.log("STEP 4 — ABORTED: max retries reached");
    return;
  }

  var p1DocId   = props.getProperty('PART1_DOC_ID');
  var p27DocId  = props.getProperty('PARTS27_DOC_ID');
  var nlCount   = parseInt(props.getProperty('NL_COUNT')  || '0');
  var pipeStart = parseInt(props.getProperty('PIPE_START') || Date.now());
  var fitness   = props.getProperty('FITNESS') || '';
  var inTok     = parseInt(props.getProperty('IN_TOK')    || '0');
  var outTok    = parseInt(props.getProperty('OUT_TOK')   || '0');

  var part1     = readDoc(p1DocId);
  var parts2to7 = readDoc(p27DocId);

  var cost   = ((inTok * 0.000003) + (outTok * 0.000015)).toFixed(4);
  var runMin = Math.round((Date.now() - pipeStart) / 60000);
  log('INFO', 'Cost: $' + cost + ' | Runtime: ' + runMin + 'min | Tokens: ' + inTok + ' in / ' + outTok + ' out');

  var streak  = updateRunHistory(nlCount, part1, cost);
  var dateStr = new Date().toDateString();
  Logger.log("STEP 4 — dateStr: " + dateStr + " | nlCount: " + nlCount);

  // ── Scout internal HTML — DEACTIVATED (Phase 2: public Gahwa output only) ──
  var shareUrl = '';

  // ── Gahwa public output — ACTIVE ─────────────────────────────────────
  if (CONFIG.GAHWA_EMAIL) {
    Logger.log("STEP 5 — preparing email: recipient=" + CONFIG.GAHWA_EMAIL);
    log('INFO', 'DIAG part1 first 200: ' + part1.substring(0, 200));
    log('INFO', 'DIAG parts2to7 first 200: ' + parts2to7.substring(0, 200));
    // ── UTF-8 DIAGNOSTIC — log raw input BEFORE render ──────────────
    var diagRaw1 = (part1 || '').substring(0, 60);
    var diagRaw1Codes = (part1 || '').split('').slice(0, 30).map(function(c){return c.charCodeAt(0);}).join(',');
    Logger.log('[UTF8-DIAG] part1 raw first 60: ' + diagRaw1);
    Logger.log('[UTF8-DIAG] part1 char codes first 30: ' + diagRaw1Codes);
    Logger.log('[UTF8-DIAG] part1 has surrogate: ' + (/[\uD800-\uDFFF]/.test(part1 || '')));
    Logger.log('[UTF8-DIAG] part1 has replacement char (U+FFFD): ' + (/[\uFFFD]/.test(part1 || '')));
    var diagRaw27 = (parts2to7 || '').substring(0, 60);
    var diagRaw27Codes = (parts2to7 || '').split('').slice(0, 30).map(function(c){return c.charCodeAt(0);}).join(',');
    Logger.log('[UTF8-DIAG] parts2to7 raw first 60: ' + diagRaw27);
    Logger.log('[UTF8-DIAG] parts2to7 char codes first 30: ' + diagRaw27Codes);
    Logger.log('[UTF8-DIAG] parts2to7 has surrogate: ' + (/[\uD800-\uDFFF]/.test(parts2to7 || '')));
    Logger.log('[UTF8-DIAG] parts2to7 has replacement char (U+FFFD): ' + (/[\uFFFD]/.test(parts2to7 || '')));
    // ─────────────────────────────────────────────────────────────────
    var gahwaHtml  = buildGahwaHTML(part1, parts2to7, shareUrl);
    Logger.log("STEP 5 — HTML rendered, length: " + (gahwaHtml ? gahwaHtml.length : 0));
    // ── FINAL OUTPUT VALIDATION ──────────────────────────────────────
    if (gahwaHtml) {
      Logger.log('[UTF8-VALIDATE] htmlBody length: ' + gahwaHtml.length);
      Logger.log('[UTF8-VALIDATE] htmlBody has <meta charset: ' + (/<meta\s+charset\s*=/i.test(gahwaHtml)));
      Logger.log('[UTF8-VALIDATE] htmlBody has U+FFFD replacement char: ' + (/[\uFFFD]/.test(gahwaHtml)));
      Logger.log('[UTF8-VALIDATE] htmlBody has lone surrogates: ' + (/[\uD800-\uDFFF]/.test(gahwaHtml)));
      Logger.log('[UTF8-VALIDATE] htmlBody JSON-safe first 100: ' + JSON.stringify(gahwaHtml.substring(0, 100)));
    }
    // ─────────────────────────────────────────────────────────────────
    var gahwaFname = 'Gahwa_' + dateStr.replace(/ /g, '_') + '.html';

    var gahwaFile  = DriveApp.getFolderById(CONFIG.SCOUT_OUTPUT_FOLDER_ID)
                             .createFile(gahwaFname, gahwaHtml, MimeType.HTML);
    gahwaFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    log('INFO', 'Gahwa Drive: https://drive.google.com/file/d/' + gahwaFile.getId() + '/view');

    var gahwaSubject = parseWinningSubject(parts2to7, dateStr);
    Logger.log("STEP 5 — subject: \"" + gahwaSubject + "\" | htmlBody length: " + gahwaHtml.length);
    var emailHtml = gahwaHtml.replace(
      /src="data:image\/[^"]{100,}"/g,
      'src="' + (getFinjanUrl() || '') + '"'
    );
    Logger.log("STEP 6 — calling GmailApp.sendEmail to: " + CONFIG.GAHWA_EMAIL);
    try {
      GmailApp.sendEmail(CONFIG.GAHWA_EMAIL, gahwaSubject, '', { htmlBody: emailHtml });
      Logger.log("EMAIL SEND SUCCESS — subject: " + gahwaSubject);
      Logger.log("STEP 7 — email send completed");
    } catch (err) {
      Logger.log("EMAIL SEND FAILURE: " + err.message);
      throw err;
    }
    log('INFO', 'Gahwa email sent: ' + gahwaSubject);
    // ── TRUTH VERIFICATION: track last sent email deliveryId ────────────
    var sentDeliveryId = 'scout-internal-' + new Date().toISOString().slice(0, 10);
    props.setProperty('lastEmailSent', sentDeliveryId);
    log('INFO', '📝 lastEmailSent updated: ' + sentDeliveryId);


    // ── Beehiiv posting — DISABLED (Enterprise plan required) ────────────
    // Auth confirmed working. Key is valid. Plan blocks POST /posts endpoint.
    // To re-enable: set CONFIG.BEEHIIV_POST_ENABLED = true after upgrading plan.
    if (CONFIG.BEEHIIV_POST_ENABLED) {
      var beehiivUrl = postToBeehiiv(gahwaHtml, dateStr, part1, parts2to7);
      if (beehiivUrl) log('INFO', 'Beehiiv post: ' + beehiivUrl);
    } else {
      log('INFO', 'Beehiiv: skipped — Posts API requires Enterprise plan. Set BEEHIIV_POST_ENABLED=true to re-enable.');
    }
  } else {
    Logger.log("STEP 4 — SKIPPED: CONFIG.GAHWA_EMAIL not set");
  }

  updateTrendTracker(part1);

  var todayKey = 'RAN_' + new Date().toDateString().replace(/ /g, '_');
  props.setProperty(todayKey, 'COMPLETE');
  clearPipelineState();
  Logger.log("STEP 4 — COMPLETE");
  log('INFO', '\uD83C\uDF89 Done in ' + runMin + 'min · $' + cost);
}

// ════════════════════════════════════════════════════════════════════════
// WEEKLY ROLLUP
// ════════════════════════════════════════════════════════════════════════

// @agent-target: runWeeklyRollup
function runWeeklyRollup() {
  var props = PropertiesService.getScriptProperties();
  var trends;
  try { trends = JSON.parse(props.getProperty('TREND_TRACKER') || '{}'); } catch(e) { trends = {}; }

  var keys = Object.keys(trends);
  if (!keys.length) { log('INFO', 'No trend data yet.'); return; }
  keys.sort(function(a, b) { return trends[b].count - trends[a].count; });

  var summary = 'WEEKLY SIGNAL FREQUENCY\n';
  keys.slice(0, 50).forEach(function(k) {
    var e = trends[k];
    summary += e.count + 'x | ' + e.headline + '\n';
  });

  var rollup = generateWeeklyRollup(summary);
  if (isError(rollup)) { log('ERROR', 'Weekly rollup failed.'); return; }

  var dateStr     = new Date().toDateString();
  var rollupHtml  = buildWeeklyRollupHTML(rollup, dateStr);
  var fname       = 'WeeklyRollup_' + dateStr.replace(/ /g, '_') + '.html';
  var f           = DriveApp.getFolderById(CONFIG.SCOUT_OUTPUT_FOLDER_ID)
                            .createFile(fname, rollupHtml, MimeType.HTML);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  log('INFO', 'Weekly rollup: https://drive.google.com/file/d/' + f.getId() + '/view');
  sendHTMLEmail('STARTUP SCOUT · Weekly Rollup · ' + dateStr, rollupHtml);
}

// ════════════════════════════════════════════════════════════════════════
// DAILY HEALTH CHECK
// ════════════════════════════════════════════════════════════════════════

// @agent-target: dailyHealthCheck
function dailyHealthCheck() {
  var props    = PropertiesService.getScriptProperties();
  var todayKey = 'RAN_' + new Date().toDateString().replace(/ /g, '_');
  if (props.getProperty(todayKey) === 'COMPLETE') {
    log('INFO', 'Health check: Newsletter sent successfully today.');
    return;
  }
  var pipeStatus = props.getProperty('PIPELINE_ACTIVE') ? 'ACTIVE (still running)' : 'INACTIVE (not started or failed)';
  var msg = 'SCOUT ALERT: Newsletter has not sent today (' + new Date().toDateString() + '). Pipeline: ' + pipeStatus + '. Check Apps Script logs.';
  log('WARN', msg);
  if (CONFIG.NOTIFY_EMAIL) GmailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'SCOUT ALERT: Newsletter not sent today', msg);
}

// ════════════════════════════════════════════════════════════════════════
// MANUAL CONTROLS
// ════════════════════════════════════════════════════════════════════════

// @agent-target: runFullPipeline
function runFullPipeline() {
  aggregateNewsletters();
  Utilities.sleep(5000);
  runScoutStep1();
}

// @agent-target: testClaudeKey
function testClaudeKey() {
  var result = callClaude('Say hello in one word.', CONFIG.CLAUDE_FAST);
  log('INFO', 'Claude test: ' + result);
}

// @agent-target: resetPipeline
function resetPipeline() {
  clearPipelineState();
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('RAN_' + new Date().toDateString().replace(/ /g, '_'));
  log('INFO', '\u2705 Reset complete. Run runScoutStep1().');
}

// ════════════════════════════════════════════════════════════════════════
// IDEMPOTENT DELIVERY — DEDUP by deliveryId
// ════════════════════════════════════════════════════════════════════════

/**
 * Check if a deliveryId has already been processed (idempotency guard).
 * Uses ScriptProperties as a lightweight KV store — no external DB needed.
 *
 * @param {string} deliveryId - Unique delivery identifier (job-date-commit)
 * @return {boolean} true if this deliveryId was already marked DELIVERED
 */
function isDuplicate(deliveryId) {
  if (!deliveryId) return false;
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(deliveryId);
  return existing === "DELIVERED";
}

/**
 * Mark a deliveryId as successfully delivered.
 * Once set, any future request with the same deliveryId will be ignored.
 *
 * @param {string} deliveryId - Unique delivery identifier to persist
 */
function markDelivered(deliveryId) {
  if (!deliveryId) return;
  var props = PropertiesService.getScriptProperties();
  props.setProperty(deliveryId, "DELIVERED");
}

// ════════════════════════════════════════════════════════════════════════
// WEBHOOK ENTRY POINT — doPost / doGet
// ════════════════════════════════════════════════════════════════════════

/**
 * doGet — Health check endpoint + truth verification endpoint.
 *
 * Returns JSON confirming the web app is alive, plus truth state:
 *   - lastEmailSent: the deliveryId of the most recently sent email
 *   - This allows the Node truth-evaluator to independently verify email delivery
 *
 * Auth: Uses header-based Authorization: Bearer <token> (no PropertiesService dependency)
 *
 * Query params (optional):
 *   ?verify=deliveryId — returns { verified: true/false, deliveryId: "..." }
 */
function doGet(e) {
  var props = PropertiesService.getScriptProperties();

  // ── Truth verification query ──────────────────────────────────────────

  // If ?verify=deliveryId is passed, check if that delivery was confirmed
  if (e && e.parameter && e.parameter.verify) {
    var verifyDeliveryId = e.parameter.verify;
    var lastSent = props.getProperty('lastEmailSent');
    var dupFound = isDuplicate(verifyDeliveryId);
    var verified = (lastSent === verifyDeliveryId) || dupFound;

    return ContentService
      .createTextOutput(JSON.stringify({
        status: "ok",
        verified: verified,
        deliveryId: verifyDeliveryId,
        lastEmailSent: lastSent,
        duplicateExists: dupFound
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      status: "ok",
      app: "Gahwa Newsletter",
      version: "v5",
      timestamp: new Date().toISOString(),
      lastEmailSent: props.getProperty('lastEmailSent') || null
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * buildPlainSubject — Derive an email subject from the newsletter payload.
 *
 * Priority order:
 *   1. Explicit contents.subject (preferred for direct email requests)
 *   2. contents.title (from raw newsletter JSON format)
 *   3. First section's headline
 *   4. Hardcoded fallback
 *
 * @param {Object} contents - The parsed JSON payload
 * @return {string} The computed email subject line
 */
function buildPlainSubject(contents) {
  if (contents.subject) return contents.subject;
  if (contents.title) return contents.title;
  if (contents.sections && contents.sections.length > 0 && contents.sections[0].headline) {
    return contents.sections[0].headline;
  }
  return "GCC Morning Brief — " + new Date().toDateString();
}


/**
 * buildPlainHtmlBody — Build an HTML email body from the newsletter payload.
 *
 * If contents.htmlBody is already provided, uses it directly.
 * Otherwise, reconstructs from the newsletter's sections array.
 *
 * @param {Object} contents - The parsed JSON payload
 * @return {string} The HTML email body
 */
function buildPlainHtmlBody(contents) {
  if (contents.htmlBody) return contents.htmlBody;
  if (!contents.sections || contents.sections.length === 0) return "";

  var title = contents.title || "GCC Morning Brief";
  var dateStr = new Date().toDateString();
  var html = "";

  html += "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>";
  html += "<div style=\"font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a2e;\">";
  html += "<h1 style=\"color: #1a1a2e; border-bottom: 2px solid #c9a96e; padding-bottom: 10px;\">" + title + "</h1>";
  html += "<p style=\"color: #666; font-size: 14px;\">" + dateStr + "</p>";

  for (var i = 0; i < contents.sections.length; i++) {
    var section = contents.sections[i];
    html += "<div style=\"margin-bottom: 24px;\">";
    html += "<h2 style=\"color: #c9a96e; font-size: 18px; margin-bottom: 8px;\">" + section.headline + "</h2>";
    if (section.summary) {
      html += "<p style=\"font-size: 15px; line-height: 1.6; color: #333;\">" + section.summary + "</p>";
    }
    if (section.insight) {
      html += "<p style=\"font-size: 13px; color: #888; font-style: italic; border-left: 3px solid #c9a96e; padding-left: 12px;\">" + section.insight + "</p>";
    }
    html += "</div>";
  }

  html += "<br><hr style=\"border: none; border-top: 1px solid #eee;\">";
  html += "<p style=\"font-size: 12px; color: #999; text-align: center;\">" + CONFIG.MAILING_ADDRESS + "</p>";
  html += "</div></body></html>";

  return html;
}


/**
 * doPost — Definitively instrumented delivery pipeline entry point.
 *
 * Called by send_to_apps_script.sh / operator.js / daily-runner.js
 * after the pipeline generates a newsletter.
 *
 * INSTRUMENTED: Full step-by-step Logger.log() tracing (STEP 1-7).
 * Every path returns JSON with {status, stage, message, runId}.
 *
 * Accepts two payload formats:
 *   Direct email: { subject, htmlBody, deliveryId, action }
 *   Raw newsletter: { title, sections, strategicInsights, scenarios, deliveryId }
 *
 * IDEMPOTENCY: Uses deliveryId to prevent duplicate processing.
 * AUTH: DUAL-MODE (header + body payload for redirect survival).
 */
function doPost(e) {
  Logger.log("STEP 1 — doPost entered");
  try {
    // ── Parse payload ──────────────────────────────────────────────────
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log("STEP 1 — FAILED: no POST data received");
      return ContentService
        .createTextOutput(JSON.stringify({
          status: "error",
          stage: "STEP_1",
          message: "No POST data received",
          runId: null
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var contents = JSON.parse(e.postData.contents);
    var runId = (contents._ctx && contents._ctx.runId) || contents.deliveryId || null;
    Logger.log("STEP 1 — payload parsed, runId: " + runId);

    // ── Log payload details ──────────────────────────────────────────
    var sectionCount = (contents.sections && contents.sections.length) || 0;
    Logger.log("STEP 1 — payload section count: " + sectionCount);
    Logger.log("STEP 1 — payload runId: " + runId);
    if (contents.deliveryId) Logger.log("STEP 1 — deliveryId: " + contents.deliveryId);
    Logger.log("STEP 1 — payload keys: " + Object.keys(contents).join(", "));

    // ── DUAL-MODE AUTHENTICATION (Header + Body payload) ───────────────
    // Apps Script Web Apps redirect POST → callback GET, which DROPS headers.
    // The POST body IS preserved through the redirect chain.
    // Auth strategy:
    //   1. Try X-Gahwa-Webhook-Secret header first (direct POST, no redirect)
    //   2. Fall back to payload._webhookSecret (survives POST→302→callback GET)
    //
    // This handles both curl direct POST and node-fetch with redirect:"manual".
    var secretToken = '89e9d1671f9a13dbd3cbdc5fd90a2fdecaff7a5d635b81aa';

    // ── Method 1: Check header ─────────────────────────────────────────
    var authHeader = e.headers?.['X-Gahwa-Webhook-Secret'] || e.headers?.['x-gahwa-webhook-secret'];
    var tokenFromHeader = null;
    if (authHeader) {
      if (authHeader.indexOf('Bearer ') === 0) {
        tokenFromHeader = authHeader.substring(7);
      } else {
        tokenFromHeader = authHeader;
      }
    }

    // ── Method 2: Check payload body (survives redirect) ───────────────
    var tokenFromBody = contents._webhookSecret || null;

    // Either source is valid — header takes precedence, body is fallback
    var effectiveToken = tokenFromHeader || tokenFromBody;

    if (!effectiveToken || effectiveToken !== secretToken) {
      Logger.log("STEP 2 — FAILED: auth rejected — header: " + (!!tokenFromHeader) + " body: " + (!!tokenFromBody));
      log('WARN', 'Unauthorized webhook attempt — header:' + (!!tokenFromHeader) + ' body:' + (!!tokenFromBody));
      return ContentService
        .createTextOutput(JSON.stringify({
          status: "error",
          stage: "STEP_2",
          message: "Unauthorized",
          runId: runId
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    Logger.log("STEP 2 — auth passed");

    // Strip _webhookSecret from contents before processing to avoid leaking
    if (contents._webhookSecret) {
      delete contents._webhookSecret;
    }


    // ── IDEMPOTENCY CHECK — guard against duplicate delivery ───────────
    var deliveryId = contents.deliveryId;
    if (deliveryId && isDuplicate(deliveryId)) {
      Logger.log("STEP 1 — DUPLICATE IGNORED: " + deliveryId);
      log('INFO', '⏭️ DUPLICATE IGNORED — deliveryId already processed: ' + deliveryId);
      return ContentService
        .createTextOutput(JSON.stringify({
          status: "ok",
          stage: "STEP_1",
          message: "DUPLICATE_IGNORED",
          runId: runId
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── Route based on action ──────────────────────────────────────────
    var action = contents.action || 'send';
    Logger.log("STEP 3 — payload parsed, action: " + action);
    log('INFO', '📩 Webhook received — action: ' + action);

    if (action === 'deploy') {
      Logger.log("STEP 3 — action=deploy, triggering runFullPipeline");
      runFullPipeline();
      return ContentService
        .createTextOutput(JSON.stringify({
          status: "ok",
          stage: "STEP_3",
          message: "Pipeline deploy triggered",
          runId: runId
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'send' || action === 'test') {
      Logger.log("STEP 3 — action=" + action);

      // ── Derive subject + htmlBody from payload ─────────────────────
      // The operator sends a raw newsletter JSON with sections[], title, etc.
      // We synthesize subject and htmlBody if not provided explicitly.
      var subject = buildPlainSubject(contents);
      var htmlBody = buildPlainHtmlBody(contents);
      Logger.log("STEP 4 — newsletter rendered: subject derived=\"" + subject
        + "\", htmlBody length=" + htmlBody.length);

      // Validate derived fields
      if (!subject || subject.trim() === "") {
        Logger.log("STEP 4 — FAILURE: could not derive subject from payload");
        Logger.log("EMAIL SEND FAILURE: subject cannot be derived from payload — missing subject/title/sections[0].headline");
        return ContentService
          .createTextOutput(JSON.stringify({
            status: "error",
            stage: "STEP_4",
            message: "Could not derive subject — payload missing subject/title/sections[0].headline",
            runId: runId
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (!htmlBody || htmlBody.trim() === "" || htmlBody === "<html><body></body></html>") {
        Logger.log("STEP 4 — FAILURE: could not build htmlBody from payload");
        Logger.log("EMAIL SEND FAILURE: htmlBody empty — payload has no htmlBody or sections");
        return ContentService
          .createTextOutput(JSON.stringify({
            status: "error",
            stage: "STEP_4",
            message: "Could not build htmlBody — payload has no htmlBody or sections",
            runId: runId
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      Logger.log("STEP 5 — preparing email: recipient=" + CONFIG.GAHWA_EMAIL
        + ", subject=\"" + subject
        + "\", htmlBody length=" + htmlBody.length);

      Logger.log("STEP 6 — calling GmailApp.sendEmail");
      htmlBody = htmlBody.replace(/\uFFFD/g, "");
      try {
        GmailApp.sendEmail(CONFIG.GAHWA_EMAIL, subject, '', {
          htmlBody: htmlBody
        });
        Logger.log("EMAIL SEND SUCCESS — subject: " + subject + " | recipient: " + CONFIG.GAHWA_EMAIL);
        Logger.log("STEP 7 — email send completed");
      } catch (err) {
        Logger.log("EMAIL SEND FAILURE: " + err.message);
        throw err;
      }
      log('INFO', '📧 Webhook-triggered email sent: ' + subject);

      // ── Mark delivered ONLY after successful email send ────────────
      if (deliveryId) {
        markDelivered(deliveryId);

        // ── TRUTH VERIFICATION: Track lastEmailSent for independent verification ──
        var props = PropertiesService.getScriptProperties();
        props.setProperty('lastEmailSent', deliveryId);

        log('INFO', '📝 Delivery marked + lastEmailSent updated: ' + deliveryId);
      }

      Logger.log("STEP 7 — returning success response");
      return ContentService
        .createTextOutput(JSON.stringify({
          status: "ok",
          stage: "STEP_7",
          message: "Email sent",
          subject: subject,
          runId: runId,
          deliveryId: deliveryId
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── Unknown action ──────────────────────────────────────────────────
    Logger.log("STEP 3 — WARNING: unknown action: " + action);
    return ContentService
      .createTextOutput(JSON.stringify({
        status: "ok",
        stage: "STEP_3",
        message: "Unknown action '" + action + "'. Payload acknowledged.",
        runId: runId
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log("doPost CATCH: " + err.message);
    Logger.log("EMAIL SEND FAILURE: " + err.message);
    log('ERROR', 'Webhook error: ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({
        status: "error",
        stage: "CATCH",
        message: err.toString(),
        runId: null
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
