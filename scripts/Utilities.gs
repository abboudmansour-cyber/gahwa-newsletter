// ╔══════════════════════════════════════════════════════════════════════╗
// ║  UTILITIES.gs — Drive/Doc helpers · Email · Triggers · State · Secrets
// ║  THE GAHWA · STARTUP SCOUT OS v5
// ╚══════════════════════════════════════════════════════════════════════╝

// ════════════════════════════════════════════════════════════════════════
// SECRETS
// Run storeSecrets() ONCE manually after deploying.
// Keys are then read at runtime via getSecret() — never in source.
// ════════════════════════════════════════════════════════════════════════

/**
 * Run this ONE TIME in the Apps Script editor after deploying.
 * Paste your real keys as arguments, then delete this call from source.
 * After running, your keys live only in PropertiesService — never in code.
 */
// @agent-target: storeSecrets
function storeSecrets() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SECRET_DEEPSEEK_API_KEY', '__PASTE_YOUR_DEEPSEEK_KEY_HERE__');
  props.setProperty('SECRET_BEEHIIV_API_KEY',  '__PASTE_YOUR_BEEHIIV_KEY_HERE__');
  props.setProperty('WEBHOOK_SECRET',          '89e9d1671f9a13dbd3cbdc5fd90a2fdecaff7a5d635b81aa');
  Logger.log('✅ Secrets stored in PropertiesService. Remove keys from storeSecrets() now.');
  Logger.log('ℹ️  WEBHOOK_SECRET: 89e9d1671f9a13dbd3cbdc5fd90a2fdecaff7a5d635b81aa');
}

/**
 * Runtime secret accessor. Throws a clear error if a key is missing
 * so pipeline failures are obvious rather than silent auth errors.
 */
// @agent-target: getSecret
function getSecret(name) {
  var val = PropertiesService.getScriptProperties().getProperty(name);
  if (!val || val.indexOf('__PASTE') === 0) {
    var msg = '⛔ Secret "' + name + '" not set. Run storeSecrets() first.';
    log('ERROR', msg);
    throw new Error(msg);
  }
  return val;
}

// ════════════════════════════════════════════════════════════════════════
// STRUCTURED LOGGING
// log(level, message) — severity-tagged, single entry point for all logs
// ════════════════════════════════════════════════════════════════════════

var LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
var LOG_MIN    = LOG_LEVELS.INFO; // Change to DEBUG for verbose output

// @agent-target: log
function log(level, message) {
  if ((LOG_LEVELS[level] || 0) < LOG_MIN) return;
  var icons = { DEBUG: '🔍', INFO: 'ℹ️ ', WARN: '⚠️ ', ERROR: '⛔' };
  Logger.log('[' + level + '] ' + (icons[level] || '') + ' ' + message);
}

// ════════════════════════════════════════════════════════════════════════
// DRIVE / DOC HELPERS
// ════════════════════════════════════════════════════════════════════════

// @agent-target: readDoc
function readDoc(docId) {
  return DocumentApp.openById(docId).getBody().getText();
}

// @agent-target: appendToDoc
function appendToDoc(docId, text) {
  var doc = DocumentApp.openById(docId);
  doc.getBody().appendParagraph(text);
  doc.saveAndClose();
}

// @agent-target: loadChunkFromDoc
function loadChunkFromDoc(chunksDocId, idx) {
  var text  = readDoc(chunksDocId).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var start = '===CHUNK_START_' + idx + '===';
  var end   = '===CHUNK_END_'   + idx + '===';
  var s     = text.indexOf(start);
  if (s === -1) return '';
  var content = text.substring(s + start.length);
  var e = content.indexOf(end);
  if (e !== -1) content = content.substring(0, e);
  return content.trim();
}

// @agent-target: createDocInFolder
function createDocInFolder(namePrefix, folderId) {
  var doc    = DocumentApp.create(namePrefix + '_' + Date.now());
  var fileId = doc.getId();
  DriveApp.getFileById(fileId).moveTo(DriveApp.getFolderById(folderId));
  doc.getBody().clear();
  doc.saveAndClose();
  return fileId;
}

// @agent-target: getTodayIntelDump
function getTodayIntelDump() {
  var folder   = DriveApp.getFolderById(CONFIG.DAILY_INTEL_FOLDER_ID);
  var todayStr = new Date().toDateString();
  var files    = folder.getFiles();

  while (files.hasNext()) {
    var f = files.next();
    if (f.getMimeType() !== MimeType.GOOGLE_DOCS) continue;
    if (f.getName().indexOf(todayStr) !== -1 && f.getName().indexOf('Daily Intel Dump') !== -1) {
      log('INFO', 'Intel Dump found: ' + f.getName());
      return DocumentApp.openById(f.getId()).getBody().getText();
    }
  }

  // Fallback: most recent intel dump
  files = folder.getFiles();
  var best = null, bestT = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getMimeType() !== MimeType.GOOGLE_DOCS) continue;
    if (f.getName().indexOf('Daily Intel Dump') === -1) continue;
    var t = f.getDateCreated().getTime();
    if (t > bestT) { bestT = t; best = f; }
  }

  if (best) {
    log('WARN', 'No today dump found. Using fallback: ' + best.getName());
    return DocumentApp.openById(best.getId()).getBody().getText();
  }

  log('ERROR', 'No Intel Dump found in folder ' + CONFIG.DAILY_INTEL_FOLDER_ID);
  return null;
}

// ════════════════════════════════════════════════════════════════════════
// EMAIL + NOTIFICATIONS
// ════════════════════════════════════════════════════════════════════════

// @agent-target: sendHTMLEmail
function sendHTMLEmail(subject, html) {
  if (!CONFIG.NOTIFY_EMAIL) return;
  try {
    GmailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, '', { htmlBody: html });
    log('INFO', '📧 Email sent: ' + subject);
  } catch(e) {
    log('ERROR', 'Email failed: ' + e.message);
  }
}

// @agent-target: sendNotification
function sendNotification(subject, body) {
  if (!CONFIG.NOTIFY_EMAIL) return;
  try { GmailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body); } catch(e) {
    log('ERROR', 'Notification failed: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════
// PIPELINE STATE
// ════════════════════════════════════════════════════════════════════════

var PIPELINE_KEYS = [
  'PIPELINE_ACTIVE', 'PIPE_START', 'NL_COUNT', 'CHUNK_COUNT', 'CHUNK_INDEX',
  'FAILED_CHUNKS', 'CHUNKS_DOC_ID', 'SIGNALS_DOC_ID', 'PART1_DOC_ID',
  'PARTS27_DOC_ID', 'FITNESS', 'IN_TOK', 'OUT_TOK',
  'STEP2_ATTEMPTS', 'STEP3_ATTEMPTS', 'STEP4_ATTEMPTS',
];

/**
 * Validates required props exist before a step runs.
 * Returns true if OK, false + logs if anything is missing.
 */
// @agent-target: validatePipelineState
function validatePipelineState(requiredKeys) {
  var props   = PropertiesService.getScriptProperties();
  var missing = [];
  requiredKeys.forEach(function(k) {
    if (!props.getProperty(k)) missing.push(k);
  });
  if (missing.length) {
    log('ERROR', 'Pipeline state missing: ' + missing.join(', '));
    return false;
  }
  return true;
}

// @agent-target: clearPipelineState
function clearPipelineState() {
  var props  = PropertiesService.getScriptProperties();
  var docIds = ['CHUNKS_DOC_ID', 'SIGNALS_DOC_ID', 'PART1_DOC_ID', 'PARTS27_DOC_ID']
    .map(function(k) { return props.getProperty(k); })
    .filter(function(id) { return !!id; });

  PIPELINE_KEYS.forEach(function(k) { props.deleteProperty(k); });

  docIds.forEach(function(id) {
    try { DriveApp.getFileById(id).setTrashed(true); } catch(e) {}
  });

  deleteContinuationTriggers();
  log('INFO', '✅ Pipeline state cleared. Daily triggers preserved.');
}

/**
 * Increments the attempt counter for a step.
 * Returns true if under limit (proceed), false if limit reached (abort).
 */
// @agent-target: checkAndIncrementAttempts
function checkAndIncrementAttempts(stepKey, maxAttempts) {
  var props    = PropertiesService.getScriptProperties();
  var attempts = parseInt(props.getProperty(stepKey) || '0') + 1;
  props.setProperty(stepKey, attempts.toString());
  if (attempts > maxAttempts) {
    log('ERROR', stepKey + ' exceeded max attempts (' + maxAttempts + '). Aborting.');
    return false;
  }
  log('INFO', stepKey + ' attempt ' + attempts + '/' + maxAttempts);
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// CONTINUATION TRIGGERS
// ════════════════════════════════════════════════════════════════════════

// @agent-target: scheduleContinuation
function scheduleContinuation(fnName) {
  deleteContinuationTriggers();
  var at      = new Date(Date.now() + 2 * 60 * 1000);
  var trigger = ScriptApp.newTrigger(fnName).timeBased().at(at).create();
  var props   = PropertiesService.getScriptProperties();
  var ids     = JSON.parse(props.getProperty('CONTINUATION_TRIGGER_IDS') || '[]');
  ids.push(trigger.getUniqueId());
  props.setProperty('CONTINUATION_TRIGGER_IDS', JSON.stringify(ids));
  log('INFO', '⏱ Continuation: ' + fnName + ' at ' + at.toTimeString() + ' (id:' + trigger.getUniqueId() + ')');
}

// @agent-target: deleteContinuationTriggers
function deleteContinuationTriggers() {
  var props = PropertiesService.getScriptProperties();
  var ids   = JSON.parse(props.getProperty('CONTINUATION_TRIGGER_IDS') || '[]');
  if (!ids.length) return;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var idx = ids.indexOf(t.getUniqueId());
    if (idx !== -1) {
      ScriptApp.deleteTrigger(t);
      log('INFO', '🗑 Deleted continuation trigger: ' + t.getUniqueId());
      ids.splice(idx, 1);
    }
  });
  props.setProperty('CONTINUATION_TRIGGER_IDS', JSON.stringify(ids));
}

// ════════════════════════════════════════════════════════════════════════
// TRIGGERS SETUP
// ════════════════════════════════════════════════════════════════════════

var MANAGED_TRIGGER_FNS = [
  'aggregateNewsletters', 'runScoutStep1', 'dailyHealthCheck',
  'runWeeklyRollup', 'consolidateWeeklyIntel', 'cleanupTempDocs',
];

// @agent-target: setupAllTriggers
function setupAllTriggers() {
  var props           = PropertiesService.getScriptProperties();
  var continuationIds = JSON.parse(props.getProperty('CONTINUATION_TRIGGER_IDS') || '[]');

  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (continuationIds.indexOf(t.getUniqueId()) !== -1) return;
    if (MANAGED_TRIGGER_FNS.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
      log('INFO', '🗑 Removed old trigger: ' + t.getHandlerFunction());
    }
  });

  ScriptApp.newTrigger('aggregateNewsletters').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('runScoutStep1').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('dailyHealthCheck').timeBased().everyDays(1).atHour(11).create();
  ScriptApp.newTrigger('runWeeklyRollup').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(14).create();
  ScriptApp.newTrigger('consolidateWeeklyIntel').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(15).create();
  ScriptApp.newTrigger('cleanupTempDocs').timeBased().everyDays(1).atHour(2).create();

  log('INFO', '✅ Triggers set: 6am aggregate · 9am scout · 11am health · 2pm/3pm Saturday · 2am cleanup');
  log('INFO', 'Note: Run setupAllTriggers() ONLY once to initialize. Never during pipeline run.');
}

// @agent-target: autoSetupTriggers
function autoSetupTriggers() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('TRIGGERS_INITIALIZED') === 'true') return;
  log('INFO', '⏰ First run detected — setting up triggers automatically...');
  setupAllTriggers();
  props.setProperty('TRIGGERS_INITIALIZED', 'true');
  log('INFO', '✅ Triggers initialized.');
}

// ════════════════════════════════════════════════════════════════════════
// HISTORY + TRACKING
// ════════════════════════════════════════════════════════════════════════

// @agent-target: updateIssueNumber
function updateIssueNumber() {
  var props  = PropertiesService.getScriptProperties();
  var num    = parseInt(props.getProperty('ISSUE_NUMBER') || '0') + 1;
  props.setProperty('ISSUE_NUMBER', num.toString());
  return num;
}

// @agent-target: updateRunHistory
function updateRunHistory(nlCount, part1, cost) {
  var props   = PropertiesService.getScriptProperties();
  var history;
  try { history = JSON.parse(props.getProperty('RUN_HISTORY') || '[]'); } catch(e) { history = []; }
  var sigs     = parseSignals(part1);
  var priority = sigs.filter(function(s) { return s.pri === 'YES'; }).length;
  history.unshift({ date: new Date().toDateString(), nl: nlCount, signals: sigs.length, priority: priority, cost: cost });
  if (history.length > 30) history = history.slice(0, 30);
  var streak = 1, today = new Date();
  for (var i = 1; i < history.length; i++) {
    if (Math.round((today - new Date(history[i].date)) / 86400000) === i) streak++;
    else break;
  }
  var s = JSON.stringify(history);
  if (s.length < 8000) props.setProperty('RUN_HISTORY', s);
  return streak;
}

// @agent-target: updateTrendTracker
function updateTrendTracker(part1) {
  try {
    var props = PropertiesService.getScriptProperties();
    var today = new Date().toDateString();
    var trends;
    try { trends = JSON.parse(props.getProperty('TREND_TRACKER') || '{}'); } catch(e) { trends = {}; }
    parseSignals(part1).forEach(function(s) {
      if (!s.headline) return;
      var key = s.headline.toLowerCase().substring(0, 50).replace(/[^a-z0-9]/g, '_');
      if (!trends[key]) trends[key] = { headline: s.headline.substring(0, 100), days: [today], count: 1 };
      else if (trends[key].days.indexOf(today) === -1) { trends[key].days.push(today); trends[key].count++; }
    });
    var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    Object.keys(trends).forEach(function(k) {
      trends[k].days = trends[k].days.filter(function(d) { return new Date(d).getTime() > cutoff; });
      if (!trends[k].days.length) delete trends[k];
      else trends[k].count = trends[k].days.length;
    });
    var s = JSON.stringify(trends);
    if (s.length < 8000) props.setProperty('TREND_TRACKER', s);
  } catch(e) {
    log('WARN', 'Trend tracker error: ' + e.message);
  }
}

// @agent-target: viewRunHistory
function viewRunHistory() {
  var props = PropertiesService.getScriptProperties();
  var h;
  try { h = JSON.parse(props.getProperty('RUN_HISTORY') || '[]'); } catch(e) { h = []; }
  log('INFO', '═══ RUN HISTORY ═══');
  h.forEach(function(r, i) {
    log('INFO', (i + 1) + '. ' + r.date + ' | ' + r.nl + ' NL | ' + r.signals + ' sig | ' + r.priority + ' pri | $' + r.cost);
  });
}

// ════════════════════════════════════════════════════════════════════════
// FINJAN IMAGE LOADER
// ════════════════════════════════════════════════════════════════════════

// @agent-target: loadFinjanB64
function loadFinjanB64() {
  var b64 = PropertiesService.getScriptProperties().getProperty('FINJAN_B64');
  // Fallback: transparent 1x1 pixel if not stored yet
  if (!b64) return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  return 'data:image/png;base64,' + b64;
}

// @agent-target: storeFinjanB64
function storeFinjanB64() {
  try {
    var folder = DriveApp.getFolderById(CONFIG.SCOUT_OUTPUT_FOLDER_ID);
    var files  = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (f.getMimeType() === MimeType.PNG && f.getName().indexOf('finjan') !== -1) {
        var b64 = Utilities.base64Encode(f.getBlob().getBytes());
        PropertiesService.getScriptProperties().setProperty('FINJAN_B64', b64);
        log('INFO', 'Finjan stored: ' + b64.length + ' chars');

        // Also store the public Drive URL for Gmail (avoids base64 size limit)
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var driveUrl = 'https://drive.google.com/uc?export=view&id=' + f.getId();
        PropertiesService.getScriptProperties().setProperty('FINJAN_DRIVE_URL', driveUrl);
        log('INFO', 'Finjan URL stored: ' + driveUrl);
        return;
      }
    }
    log('WARN', 'No finjan PNG found. Upload a file named "finjan.png" to the output folder.');
  } catch(e) {
    log('ERROR', 'storeFinjanB64 error: ' + e.message);
  }
}

// @agent-target: getFinjanUrl
function getFinjanUrl() {
  var url = PropertiesService.getScriptProperties().getProperty('FINJAN_DRIVE_URL');
  if (url && url.trim()) return url;
  return '';
}

// ════════════════════════════════════════════════════════════════════════
// CLEANUP
// ════════════════════════════════════════════════════════════════════════

// @agent-target: cleanupTempDocs
function cleanupTempDocs() {
  var props    = PropertiesService.getScriptProperties();
  var folder   = DriveApp.getFolderById(CONFIG.SCOUT_OUTPUT_FOLDER_ID);
  var files    = folder.getFiles();
  var cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  var n = 0;

  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf('_SS_') !== 0) continue;
    if (f.getDateCreated().getTime() < cutoff24h) { f.setTrashed(true); n++; }
  }

  var allKeys  = props.getKeys();
  var cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
  var keysRemoved = 0;
  allKeys.forEach(function(k) {
    if (k.indexOf('RAN_') !== 0) return;
    var d = new Date(k.replace('RAN_', '').replace(/_/g, ' '));
    if (!isNaN(d.getTime()) && d.getTime() < cutoff7d) { props.deleteProperty(k); keysRemoved++; }
  });

  log('INFO', 'Cleaned ' + n + ' temp docs, ' + keysRemoved + ' old RAN_ keys.');
}

// @agent-target: listTodaysNewsletters
function listTodaysNewsletters() {
  var docText = getTodayIntelDump();
  if (!docText) { log('ERROR', 'No Intel Dump found.'); return; }
  log('INFO', '═══ NEWSLETTERS IN INTEL DUMP ═══');
  var lines = docText.split(/\r?\n/);
  var count = 0, inBlock = false, title = '', publisher = '';
  lines.forEach(function(line) {
    line = line.trim();
    if (line.match(/={5,}.*NEWSLETTER.*START/i)) { inBlock = true; title = ''; publisher = ''; }
    else if (line.match(/={5,}.*NEWSLETTER.*END/i)) {
      if (title) { count++; log('INFO', count + '. ' + title + (publisher ? '  |  ' + publisher : '')); }
      inBlock = false;
    } else if (inBlock) {
      if (line.startsWith('Title:'))     title     = line.substring(6).trim();
      if (line.startsWith('Publisher:')) publisher = line.substring(10).trim();
    }
  });
  log('INFO', 'TOTAL: ' + count + ' newsletters');
}