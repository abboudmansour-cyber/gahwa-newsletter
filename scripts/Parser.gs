// ╔══════════════════════════════════════════════════════════════════════╗
// ║  PARSER.gs — Pure text parsing · No side effects · No GAS services
// ║  THE GAHWA · STARTUP SCOUT OS v5
// ╚══════════════════════════════════════════════════════════════════════╝

// ════════════════════════════════════════════════════════════════════════
// CORE PARSERS
// ════════════════════════════════════════════════════════════════════════

/**
 * Extracts content between two markers in a text block.
 * Returns empty string if markers not found.
 */
// @agent-target: parseSection
function parseSection(text, startMarker, endMarker) {
  if (!text) return '';
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var s = text.indexOf(startMarker);
  if (s === -1) return '';
  var content = text.substring(s + startMarker.length);
  var e = content.indexOf(endMarker);
  if (e !== -1) content = content.substring(0, e);
  return content.trim();
}

/**
 * Extracts a single field value from a structured text block.
 * Matches "KEY:value" at start of line (case-insensitive).
 */
// @agent-target: getField
function getField(text, key) {
  if (!text) return '';
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var re = new RegExp('(?:^|\\n)' + key + ':([^\\n]*)', 'i');
  var m  = text.match(re);
  return m ? m[1].trim() : '';
}

// h() function REMOVED from Parser.gs.
// Html.gs provides the canonical h() which includes UTF-8 sanitization.
// Parser.gs's duplicate was overwriting Html.gs's version due to Apps Script
// alphabetically loading order (Parser > Html), causing sanitizeUTF8() bypass.
// See Html.gs for the single source of truth for h().
/**
 * Returns true if a Claude response indicates an error.
 */
// @agent-target: isError
function isError(text) {
  if (!text || text.trim().length < 10) return true;
  return text.indexOf('API ERROR')   !== -1 ||
         text.indexOf('EXCEPTION:')  !== -1 ||
         text.indexOf('FAILED after') !== -1;
}

// ════════════════════════════════════════════════════════════════════════
// STRUCTURED DATA PARSERS
// ════════════════════════════════════════════════════════════════════════

// @agent-target: parseBrief
function parseBrief(text) {
  var block = parseSection(text, '===BRIEF===', '===END BRIEF===');
  if (!block) return {};
  return {
    sod:      getField(block, 'SOD'),
    bigStory: getField(block, 'BIG_STORY'),
    themes:   getField(block, 'THEMES'),
    watch:    stripScores(getField(block, 'WATCH')),
    count:    getField(block, 'COUNT'),
  };
}

// @agent-target: parseSignals
function parseSignals(text) {
  var signals = [];
  var parts   = text.split('===SIG===');
  for (var i = 1; i < parts.length; i++) {
    var end   = parts[i].indexOf('===END SIG===');
    var block = end !== -1 ? parts[i].substring(0, end) : parts[i];
    block = block.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var sig = {
      num:      getField(block, 'N'),
      cat:      getField(block, 'CAT'),
      type:     getField(block, 'TYPE'),
      aud:      getField(block, 'AUD'),
      pri:      getField(block, 'PRI'),
      trd:      getField(block, 'TRD'),
      src:      parseInt(getField(block, 'SRC') || '1'),
      headline: getField(block, 'H'),
      insight:  getField(block, 'I'),
      ctx:      getField(block, 'CTX'),
      whynow:   getField(block, 'W'),
      score:    getField(block, 'S'),
      url:      getField(block, 'URL'),
    };
    if (sig.headline) signals.push(sig);
  }
  return signals;
}

// ════════════════════════════════════════════════════════════════════════
// NEWSLETTER SPLITTING + CHUNKING
// ════════════════════════════════════════════════════════════════════════

// @agent-target: extractFitnessContent
function extractFitnessContent(docText) {
  var firstNL = docText.search(/={5,}\s*NEWSLETTER\s*#1\s*START/i);
  var top     = firstNL !== -1 ? docText.substring(0, firstNL) : docText.substring(0, 3000);
  var m       = top.match(/⚡[\s\S]{10,1000}?(?=\n\n|\r\n\r\n|={5}|$)/);
  if (m) return m[0].trim();
  m = top.match(/MARCHING ORDERS[\s\S]{0,800}/i);
  if (m) return m[0].trim();
  return '';
}

// @agent-target: splitNewsletters
function splitNewsletters(docText) {
  var parts  = docText.split(/={5,}\s*NEWSLETTER\s*#\d+\s*START\s*={5,}/i);
  var result = [];
  for (var i = 1; i < parts.length; i++) {
    var c = parts[i].replace(/={5,}\s*NEWSLETTER\s*#\d+\s*END\s*={5,}[\s\S]*/i, '').trim();
    if (c.length > 50) result.push('===== NEWSLETTER #' + i + ' START =====\n' + c + '\n===== NEWSLETTER #' + i + ' END =====');
  }
  return result;
}

// @agent-target: buildAdaptiveChunks
function buildAdaptiveChunks(newsletters) {
  var chunks = [], curr = '';
  newsletters.forEach(function(nl) {
    if (curr.length + nl.length > CONFIG.MAX_CHARS_PER_CHUNK && curr.length > 0) {
      chunks.push(curr.trim()); curr = nl;
    } else {
      curr += (curr ? '\n\n' : '') + nl;
    }
  });
  if (curr.trim()) chunks.push(curr.trim());
  return chunks;
}

// ════════════════════════════════════════════════════════════════════════
// SIGNAL SORTING (for Gahwa public newsletter)
// ════════════════════════════════════════════════════════════════════════

// @agent-target: sortSignalsForGahwa
function sortSignalsForGahwa(signals) {
  var catPriority = {
    'GCC & SAUDI':       1,
    'MACRO & GEO':       2,
    'CULTURE':           3,
    'MEDIA & MARKETING': 4,
    'FINTECH & CRYPTO':  5,
    'AI & TECH':         6,
    'PRODUCT':           7,
    'PEOPLE':            8,
  };
  var audBoost = { 'CORP': 0, 'GEN-Z': 1, 'SME': 2, 'VC': 3 };
  return signals.slice().sort(function(a, b) {
    var catA = catPriority[a.cat] || 9;
    var catB = catPriority[b.cat] || 9;
    var audA = audBoost[a.aud] || 2;
    var audB = audBoost[b.aud] || 2;
    return (catA + audA) - (catB + audB);
  });
}

// ════════════════════════════════════════════════════════════════════════
// TEXT UTILITIES
// ════════════════════════════════════════════════════════════════════════

// @agent-target: stripScores
function stripScores(text) {
  if (!text) return '';
  return String(text).replace(/\s*\(score:\s*\d+\)/gi, '').trim();
}

// @agent-target: truncate75
function truncate75(text) {
  if (!text) return '';
  var words = String(text).trim().split(/\s+/);
  return words.length > 75 ? words.slice(0, 75).join(' ') + '…' : words.join(' ');
}

// @agent-target: truncateWords
function truncateWords(text, maxWords) {
  if (!text) return '';
  var words = String(text).trim().split(/\s+/);
  return words.length > maxWords ? words.slice(0, maxWords).join(' ') + '…' : words.join(' ');
}