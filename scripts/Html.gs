// Bundle built: 2026-04-30 20:10:14
// === templates/shared/shared.utils.js ===
// ========================================================================
// SHARED UTILITIES -- used by all template builders
// ========================================================================

/**
 * Strip invalid UTF-8 byte sequences that cause Gmail rendering corruption (e.g. "").
 * Keeps valid printable Unicode, replaces broken sequences with empty string.
 * Never produces replacement glyphs.
 */
function sanitizeUTF8(str) {
  if (str === null || str === undefined) return '';
  // Remove non-characters, surrogates, and control chars (except \t \n \r)
  return String(str)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDFFF]/g, '')        // strip lone surrogates (root cause of )
    .replace(/[\uFEFF]/g, '');              // strip BOM if present
}

/**
 * HTML-escape a string (prevents XSS in email HTML).
 * Also sanitizes UTF-8 to prevent Gmail corruption rendering.
 */
function h(str) {
  if (str === null || str === undefined) return '';
  return sanitizeUTF8(String(str))
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

/**
 * Truncate a string to a given word count
 */
function truncateWords(str, maxWords) {
  if (!str) return '';
  var words = str.split(/\s+/);
  if (words.length <= maxWords) return str;
  return words.slice(0, maxWords).join(' ') + '\u2026';
}

/**
 * Parse a section between two markers (inclusive of markers)
 */
function parseSection(text, startMarker, endMarker) {
  if (!text) return '';
  var s = text.indexOf(startMarker);
  if (s === -1) return '';
  var content = text.substring(s + startMarker.length);
  var e = content.indexOf(endMarker);
  return e !== -1 ? content.substring(0, e).trim() : content.trim();
}

/**
 * Get a single-line field value from a structured block
 * e.g. getField("SOD: hello\nCOUNT: 5", "SOD") -> "hello"
 */
function getField(text, key) {
  if (!text) return '';
  var re = new RegExp('(?:^|\\n)' + key + '\\s*:\\s*(.+?)(?:\\n|$)', 'i');
  var m  = text.match(re);
  return m ? m[1].trim() : '';
}

/**
 * Strip score annotations like "S: G5 A4 H3 W4 A2=2 = 21/25" from text
 */
function stripScores(text) {
  if (!text) return '';
  return text.replace(/S:\s*G\d+\s*A\d+\s*H\d+\s*W\d+\s*A2?=\d+\s*=\s*\d+\/25/gi, '').trim();
}

/**
 * Parse the ===BRIEF=== block from Part 1 (dual-mode: JSON or markers)
 */
function parseBrief(part1) {
  // -- JSON mode ----------------------------------------------------------
  if ((part1 || '').trim().charAt(0) === '{') {
    try {
      var parsed = JSON.parse(part1);
      var brief  = parsed.sections && parsed.sections.brief ? parsed.sections.brief : (parsed.brief || {});
      return {
        date:     parsed.issue && parsed.issue.date ? parsed.issue.date : (brief.date || ''),
        count:    parsed.issue && parsed.issue.newsletter_count ? String(parsed.issue.newsletter_count) : (brief.count || ''),
        sod:      brief.sod || '',
        bigStory: brief.big_story || '',
        themes:   Array.isArray(brief.themes) ? brief.themes.join(', ') : (brief.themes || ''),
        watch:    Array.isArray(brief.watch)  ? brief.watch.join(', ')  : (brief.watch || ''),
      };
    } catch (e) {
      // fall through to marker parsing
    }
  }
  // -- Marker mode --------------------------------------------------------
  var briefText = parseSection(part1, '===BRIEF===', '===END BRIEF===');
  return {
    date:     getField(briefText, 'DATE'),
    count:    getField(briefText, 'COUNT'),
    sod:      getField(briefText, 'SOD'),
    bigStory: getField(briefText, 'BIG_STORY'),
    themes:   getField(briefText, 'THEMES'),
    watch:    getField(briefText, 'WATCH'),
  };
}

/**
 * Parse all ===SIG=== blocks from Part 1 (dual-mode: JSON or markers)
 */
function parseSignals(part1) {
  // -- JSON mode ----------------------------------------------------------
  if ((part1 || '').trim().charAt(0) === '{') {
    try {
      var parsed = JSON.parse(part1);
      var rawSignals = parsed.sections && parsed.sections.signals ? parsed.sections.signals : (parsed.signals || []);
      var signals = [];
      for (var si = 0; si < rawSignals.length; si++) {
        var s = rawSignals[si];
        signals.push({
          headline: s.h || '',
          insight:  s.i || '',
          ctx:      s.ctx || '',
          whynow:   s.w || '',
          cat:      s.cat || '',
          type:     s.type || '',
          aud:      s.aud || '',
          pri:      s.pri === true ? 'YES' : (s.pri === false ? 'NO' : String(s.pri || '')),
          trd:      s.trd === true ? 'UP' : (s.trd === false ? 'NO' : String(s.trd || '')),
          src:      typeof s.src === 'number' ? s.src : parseInt(s.src || '0'),
          score:    s.scores && s.scores.total ? String(s.scores.total) + '/25' : (s.score || ''),
          url:      s.url || '',
        });
      }
      return signals;
    } catch (e) {
      // fall through to marker parsing
    }
  }
  // -- Marker mode --------------------------------------------------------
  var signals = [];
  var blocks  = part1.split('===SIG===');
  for (var i = 1; i < blocks.length; i++) {
    var b = blocks[i];
    var e = b.indexOf('===END SIG===');
    var block = e !== -1 ? b.substring(0, e).trim() : b.trim();
    if (!block) continue;
    signals.push({
      headline: getField(block, 'H'),
      insight:  getField(block, 'I'),
      ctx:      getField(block, 'CTX'),
      whynow:   getField(block, 'W'),
      cat:      getField(block, 'CAT'),
      type:     getField(block, 'TYPE'),
      aud:      getField(block, 'AUD'),
      pri:      getField(block, 'PRI'),
      trd:      getField(block, 'TRD'),
      src:      parseInt(getField(block, 'SRC') || '0'),
      score:    getField(block, 'S'),
      url:      getField(block, 'URL'),
    });
  }
  return signals;
}

/**
 * Parse winning subject line from parts2to7 (dual-mode: JSON or markers)
 */
function parseWinningSubject(parts2to7, dateStr) {
  // -- JSON mode ----------------------------------------------------------
  if ((parts2to7 || '').trim().charAt(0) === '{') {
    try {
      var parsed = JSON.parse(parts2to7);
      var slSection = parsed.sections && parsed.sections.subject_lines ? parsed.sections.subject_lines : {};
      // Case 1: winner is an object with .id
      if (slSection.winner && typeof slSection.winner === 'object' && slSection.winner.id) {
        var winnerId = slSection.winner.id;
        if (slSection.lines && Array.isArray(slSection.lines)) {
          for (var li = 0; li < slSection.lines.length; li++) {
            if (slSection.lines[li].id === winnerId) {
              return slSection.lines[li].text || 'Gahwa \u00b7 Gulf Intelligence \u00b7 ' + dateStr;
            }
          }
        }
      }
      // Case 2: winner is a plain string like old format
      if (typeof slSection.winner === 'string') {
        return slSection.winner || 'Gahwa \u00b7 Gulf Intelligence \u00b7 ' + dateStr;
      }
      return 'Gahwa \u00b7 Gulf Intelligence \u00b7 ' + dateStr;
    } catch (e) {
      // fall through to marker parsing
    }
  }
  // -- Marker mode --------------------------------------------------------
  var block  = parseSection(parts2to7, '===SUBJECT_LINES===', '===END SUBJECT_LINES===');
  if (!block) return 'Gahwa \u00b7 Gulf Intelligence \u00b7 ' + dateStr;
  var winner = getField(block, 'WINNER');
  if (!winner) return 'Gahwa \u00b7 Gulf Intelligence \u00b7 ' + dateStr;
  var slNumMatch = winner.match(/SL(\d+)/i);
  if (!slNumMatch) return 'Gahwa \u00b7 Gulf Intelligence \u00b7 ' + dateStr;
  var slKey = 'SL' + slNumMatch[1];
  var subject = getField(block, slKey);
  return subject || 'Gahwa \u00b7 Gulf Intelligence \u00b7 ' + dateStr;
}


// === templates/scout/scout.css.js ===
// ========================================================================
// SCOUT INTERNAL -- CSS
// ========================================================================

function getCSS() {
  return [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{background:#FDFDF7;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1a1a1a;line-height:1.6;-webkit-font-smoothing:antialiased}',
    'a{color:inherit;text-decoration:none}',
    '.page{max-width:680px;margin:0 auto;background:#FDFDF7}',

    '.share-bar{background:#25D366;padding:0}',
    '.share-inner{max-width:680px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
    '.share-label{font-size:12px;font-weight:700;color:#fff;white-space:nowrap}',
    '.share-url{font-size:11px;color:rgba(255,255,255,0.85);font-family:"JetBrains Mono",monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;padding:4px 8px;background:rgba(0,0,0,0.12);border-radius:4px;min-width:0}',
    '.share-url:hover{background:rgba(0,0,0,0.2)}',
    '.share-copied{font-size:11px;color:#fff;font-weight:700;opacity:0;transition:opacity 0.3s;white-space:nowrap}',
    '.share-btn{background:#fff;color:#25D366;font-size:12px;font-weight:700;padding:6px 14px;border-radius:20px;white-space:nowrap;text-decoration:none;flex-shrink:0}',
    '.share-btn:hover{background:#f0fdf4}',

    '.masthead{background:#1A3E5C;padding:0;position:relative;overflow:hidden}',
    '.masthead::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 70% 40%,rgba(218,165,32,0.10) 0%,transparent 60%);pointer-events:none}',
    '.masthead-inner{padding:44px 40px 36px;position:relative}',
    '.mast-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}',
    '.mast-issue{font-size:11px;font-weight:700;color:rgba(255,255,255,0.25);letter-spacing:0.1em;font-family:"JetBrains Mono",monospace}',
    '.mast-date{font-size:11px;font-weight:600;letter-spacing:0.08em;color:#DAA520;text-transform:uppercase}',
    '.mast-wordmark{font-size:48px;font-weight:900;letter-spacing:-0.01em;line-height:1;color:#fff;font-family:"Playfair Display","Georgia",serif}',
    '.mast-sub{font-size:13px;font-weight:600;letter-spacing:0.18em;color:rgba(255,255,255,0.55);text-transform:uppercase;margin-top:4px;font-family:"Inter",sans-serif}',
    '.mast-tagline{font-size:11px;color:#DAA520;margin-top:6px;letter-spacing:0.06em;text-transform:uppercase;font-style:italic}',
    '.mast-stats{display:flex;gap:32px;margin-top:32px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.07)}',
    '.mast-stat{display:flex;align-items:baseline;gap:8px}',
    '.mast-stat-n{font-size:28px;font-weight:900;color:#fff;font-family:"JetBrains Mono",monospace;line-height:1}',
    '.mast-stat-l{font-size:11px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.06em}',
    '.mast-sod{margin:28px 40px 0;padding:20px 24px;background:rgba(255,255,255,0.05);border-left:3px solid #DAA520;border-radius:0 8px 8px 0}',
    '.mast-sod-label{font-size:9px;font-weight:700;letter-spacing:0.14em;color:#DAA520;text-transform:uppercase;margin-bottom:8px}',
    '.mast-sod-text{font-size:16px;font-weight:700;color:#fff;line-height:1.45}',
    '.mast-big-story{margin:16px 40px 0;padding:20px 24px;background:rgba(255,255,255,0.03);border-left:3px solid rgba(255,255,255,0.2);border-radius:0 8px 8px 0}',
    '.mast-big-story-label{font-size:9px;font-weight:700;letter-spacing:0.14em;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:8px}',
    '.mast-big-story-text{font-size:13px;color:rgba(255,255,255,0.7);line-height:1.6}',
    '.sig-ctx{font-size:11px;color:#7C848C;line-height:1.5;margin-bottom:8px;padding-left:12px;font-style:italic}',
    '.sig-ctx strong{color:#DAA520;font-style:normal;font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-right:4px}',
    '.mast-themes{display:flex;flex-wrap:wrap;gap:6px;padding:16px 40px 0}',
    '.mast-theme{background:transparent;border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:4px 12px;font-size:11px;color:rgba(255,255,255,0.45);font-weight:500}',
    '.mast-bottom{height:4px;background:linear-gradient(90deg,#DAA520,#C9981A,#DAA520)}',

    '.fitness{background:#fff;border-bottom:1px solid #e8e8e2;padding:18px 36px}',
    '.fitness-label{font-size:9px;font-weight:700;letter-spacing:0.12em;color:#f59e0b;text-transform:uppercase;margin-bottom:8px}',
    '.fitness-text{font-size:13px;color:#555;line-height:1.8}',

    '.section{background:#fff;border-bottom:1px solid #e8e8e2;padding:32px 40px}',
    '.section:last-child{border-bottom:none}',
    '.sec-hdr{display:flex;align-items:center;gap:12px;margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid #f5f5f0}',
    '.sec-num{font-size:10px;font-weight:700;color:#ccc;letter-spacing:0.1em;font-family:"JetBrains Mono",monospace}',
    '.sec-title{font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#1a1a1a}',
    '.sec-accent{width:24px;height:3px;border-radius:2px;flex-shrink:0}',
    '.sec-count{font-size:11px;color:#bbb;margin-left:auto;font-family:"JetBrains Mono",monospace}',

    '.brief-section{background:#FAFAF3;border-bottom:2px solid #DAA520}',
    '.watch-bar{margin-top:14px;padding:11px 14px;background:#fffbf0;border-left:3px solid #f59e0b;border-radius:0 6px 6px 0}',
    '.watch-bar-label{font-size:9px;font-weight:700;color:#d97706;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:3px}',
    '.watch-bar-text{font-size:12px;color:#777;line-height:1.6}',

    '.toc-section{background:#fff;padding:14px 40px;border-bottom:2px solid #f0f0ea;display:flex;align-items:center;flex-wrap:wrap}',
    '.toc-item{display:inline-flex;align-items:center;gap:5px;padding:4px 14px;font-size:11px;font-weight:600;color:#999;white-space:nowrap;border-right:1px solid #e8e8e2;transition:color 0.12s}',
    '.toc-item:first-child{padding-left:0}',
    '.toc-item:last-child{border-right:none}',
    '.toc-item:hover{color:#1a1a1a}',
    '.toc-n{font-size:10px;font-weight:700;color:#ccc;font-family:"JetBrains Mono",monospace}',
    '.toc-label{font-size:11px;font-weight:600;color:inherit}',

    '.cat-divider{display:flex;align-items:center;gap:10px;margin:24px 0 14px}',
    '.cat-divider:first-child{margin-top:0}',
    '.cat-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}',
    '.cat-name{font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase}',
    '.cat-line{flex:1;height:1px;background:#f0f0ea}',

    '.sig{background:#fff;border:1px solid #e8e8e2;border-radius:8px;margin-bottom:8px;overflow:hidden;transition:box-shadow 0.15s,border-color 0.15s}',
    '.sig:hover{box-shadow:0 2px 12px rgba(0,0,0,0.06);border-color:#d0d0ca}',
    '.sig:last-child{margin-bottom:0}',
    '.sig.pri{border-left:3px solid #DAA520}',
    '.sig.trd{border-left:3px solid #10b981}',
    '.sig-top{padding:12px 14px 10px;display:flex;flex-wrap:wrap;gap:5px;align-items:center;border-bottom:1px solid #f5f5f0;background:#FAFAF3}',
    '.sig-bottom{padding:14px 16px}',
    '.badge{font-size:9px;font-weight:700;padding:3px 7px;border-radius:3px;letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap}',
    '.b-pri{background:#F5F0E8;color:#1A3E5C;border:1px solid #E8D9A0}',
    '.b-trd{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}',
    '.b-opp{background:#fffbeb;color:#b45309;border:1px solid #fde68a}',
    '.b-gap{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}',
    '.b-cat{background:#FDFDF7;color:#888;border:1px solid #e0e0da}',
    '.b-aud{background:#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe}',
    '.sig-num{margin-left:auto;font-size:10px;color:#ccc;font-family:"JetBrains Mono",monospace;font-weight:600}',
    '.sig-stat{font-size:30px;font-weight:900;color:#1a1a1a;line-height:1;margin-bottom:4px;letter-spacing:-0.02em;font-family:"JetBrains Mono",monospace}',
    '.sig-stat-label{font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px}',
    '.sig-h{font-size:15px;font-weight:700;color:#1a1a1a;line-height:1.35;margin-bottom:10px}',
    '.sig-i{font-size:13px;color:#555;line-height:1.6;margin-bottom:6px;padding-left:12px;border-left:2px solid #e8e8e2}',
    '.sig-src{font-size:11px;padding-left:12px;margin-bottom:10px}',
    '.sig-src a{color:#DAA520;font-weight:600;text-decoration:none;border-bottom:1px solid rgba(218,165,32,0.3)}',
    '.sig-src a:hover{color:#DAA520;border-bottom-color:#DAA520}',
    '.sig-w{font-size:13px;color:#166534;line-height:1.55;padding:10px 12px;background:#f0fdf4;border-radius:6px;border-left:2px solid #16a34a}',
    '.sig-w strong{color:#15803d;font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-right:6px;display:inline-block;vertical-align:middle}',
    '.sig-compact{font-size:12px;color:#888;line-height:1.5;padding-top:8px;border-top:1px solid #f0f0ea;margin-top:6px}',
    '.editorial{background:#F5F0E8;border-left:3px solid #DAA520;padding:12px 18px;margin-bottom:0;border-radius:0 0 6px 6px;font-size:14px;color:#1A3E5C;line-height:1.6;font-style:italic}',
    '.editorial strong{font-style:normal;color:#DAA520;font-weight:700}',

    '.theme{margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid #f0f0ea}',
    '.theme:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}',
    '.theme-title{font-size:17px;font-weight:800;color:#1a1a1a;line-height:1.3;margin-bottom:5px}',
    '.theme-sigs{font-size:10px;color:#bbb;font-family:"JetBrains Mono",monospace;font-weight:600;margin-bottom:16px;letter-spacing:0.04em}',
    '.theme-block{margin-bottom:12px}',
    '.theme-geo{font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;padding:2px 8px;border-radius:3px;display:inline-block}',
    '.geo-sa{background:#f0fdf4;color:#16a34a}',
    '.geo-me{background:#F5F0E8;color:#1A3E5C}',
    '.geo-gl{background:#fffbeb;color:#b45309}',
    '.theme-txt{font-size:13px;color:#444;line-height:1.7}',
    '.theme-txt-sm{font-size:12px;color:#777;line-height:1.6}',
    '.theme-do{margin-top:12px;padding:11px 14px;background:#F5F0E8;border-left:2px solid #DAA520;border-radius:0 6px 6px 0;font-size:13px;font-weight:600;color:#1A3E5C}',
    '.theme-do::before{content:"\u2192 "}',

    '.viral-grid{display:grid;gap:8px}',
    '.viral-card{background:#1A3E5C;border-radius:8px;padding:18px 20px;position:relative;overflow:hidden}',
    '.viral-card::before{content:"\&#128293;";position:absolute;top:14px;right:16px;font-size:18px;opacity:0.2}',
    '.viral-hook{font-size:15px;font-weight:700;color:#fff;line-height:1.4;margin-bottom:7px;padding-right:36px}',
    '.viral-why{font-size:12px;color:rgba(255,255,255,0.45);line-height:1.6}',

    '.startup{background:#fff;border:1px solid #e8e8e2;border-radius:8px;margin-bottom:10px;overflow:hidden}',
    '.startup:last-child{margin-bottom:0}',
    '.startup-hdr{padding:16px 20px 12px;border-bottom:1px solid #f0f0ea;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;background:#FAFAF3}',
    '.startup-name{font-size:17px;font-weight:800;color:#1a1a1a}',
    '.startup-sigs{font-size:10px;color:#bbb;font-family:"JetBrains Mono",monospace;margin-top:2px}',
    '.startup-gcc-badge{background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a;font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0}',
    '.startup-body{padding:16px 20px}',
    '.startup-row{display:flex;gap:14px;margin-bottom:10px;align-items:flex-start}',
    '.startup-row:last-child{margin-bottom:0}',
    '.startup-lbl{font-size:9px;font-weight:700;color:#bbb;letter-spacing:0.1em;text-transform:uppercase;min-width:68px;padding-top:2px;font-family:"JetBrains Mono",monospace}',
    '.startup-val{font-size:13px;color:#333;line-height:1.55;flex:1}',
    '.startup-now{background:#fffbeb;border-left:2px solid #f59e0b;padding:9px 12px;border-radius:0 6px 6px 0;margin-top:4px}',
    '.startup-gcc{background:#f0fdf4;border-left:2px solid #16a34a;padding:9px 12px;border-radius:0 6px 6px 0;font-size:12px;color:#166534;font-weight:600;margin-top:6px}',

    '.watch-card{background:#fff;border:1px solid #e8e8e2;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:8px}',
    '.watch-card:last-child{margin-bottom:0}',
    '.watch-sig{font-size:13px;font-weight:600;color:#1a1a1a;margin-bottom:4px}',
    '.watch-why{font-size:12px;color:#777;line-height:1.55}',

    '.question-section{background:#1A3E5C}',
    '.question-section .sec-hdr{border-bottom-color:rgba(255,255,255,0.08)}',
    '.question-section .sec-num{color:rgba(255,255,255,0.2)}',
    '.question-section .sec-title{color:#fff}',
    '.qbox{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:24px}',
    '.q-text{font-size:20px;font-weight:800;color:#fff;line-height:1.4;margin-bottom:10px}',
    '.q-ctx{font-size:13px;color:rgba(255,255,255,0.45);line-height:1.65}',

    '.inspo-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.inspo-card{background:#FAFAF3;border:1px solid #e8e8e2;border-radius:8px;padding:18px;position:relative;overflow:hidden}',
    '.inspo-card::before{content:"\u2726";position:absolute;top:12px;right:14px;font-size:14px;color:#ddd}',
    '.inspo-item{font-size:14px;font-weight:600;color:#1a1a1a;line-height:1.45;margin-bottom:7px;padding-right:22px}',
    '.inspo-riff{font-size:12px;color:#888;line-height:1.6;font-style:italic}',

    '.footer{background:#1A3E5C;padding:40px;text-align:center}',
    '.footer-logo{font-size:22px;font-weight:900;color:#fff;letter-spacing:0.02em;margin-bottom:2px;font-family:"Playfair Display","Georgia",serif}',
    '.footer-sub{font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);letter-spacing:0.18em;text-transform:uppercase;margin-bottom:4px}',
    '.footer-tagline{font-size:11px;color:#DAA520;letter-spacing:0.04em;font-style:italic;margin-bottom:20px}',
    '.footer-closer{font-size:15px;font-weight:600;color:rgba(255,255,255,0.75);max-width:460px;margin:0 auto 8px;line-height:1.5}',
    '.footer-compliance{font-size:11px;color:rgba(255,255,255,0.35);line-height:1.8;margin-top:16px}',
    '.footer-compliance a{color:#DAA520;text-decoration:underline;text-underline-offset:2px}',
    '.footer-meta{font-size:11px;color:rgba(255,255,255,0.2);font-family:"JetBrains Mono",monospace;margin-top:16px;padding-top:16px;border-top:1px solid rgba(218,165,32,0.2)}',

    '@media(max-width:640px){',
    '.masthead-inner,.section,.fitness,.footer{padding-left:20px;padding-right:20px}',
    '.mast-sod,.mast-themes{margin-left:20px;margin-right:20px}',
    '.mast-wordmark{font-size:36px}',
    '.toc-section{padding:10px 20px}',
    '.toc-item{padding:4px 8px;font-size:10px}',
    '.inspo-grid{grid-template-columns:1fr}',
    '.startup-row{flex-direction:column;gap:4px}',
    '.startup-lbl{min-width:unset}',
    '.mast-stats{flex-wrap:wrap}',
    '}',
  ].join('\n');
}


// === templates/scout/scout.renderers.js ===
// ========================================================================
// SCOUT INTERNAL -- Section Renderers
// ========================================================================

function renderShareBar(shareUrl, sod) {
  if (!shareUrl) return '';
  var preview = sod ? sod.substring(0, 80) + (sod.length > 80 ? '...' : '') : 'Read today\'s Startup Scout';
  return '<div class="share-bar">\n' +
    '<div class="share-inner">\n' +
    '<div class="share-label">\&#128242; Share on WhatsApp</div>\n' +
    '<div class="share-url" onclick="navigator.clipboard.writeText(\'' + shareUrl + '\').then(function(){var el=document.getElementById(\'share-copied\');el.style.opacity=1;setTimeout(function(){el.style.opacity=0},2000)})" title="Click to copy">' + shareUrl + '</div>\n' +
    '<div id="share-copied" class="share-copied">\u2705 Copied!</div>\n' +
    '<a class="share-btn" href="https://wa.me/?text=' + encodeURIComponent('\&#128225; ' + preview + ' ' + shareUrl) + '" target="_blank">Share via WhatsApp</a>\n' +
    '</div>\n</div>\n';
}

function renderMasthead(dateStr, nlCount, sigCount, brief, streakTxt, cost, runMin) {
  var themes = brief.themes ? brief.themes.split('\u00b7').map(function(t){
    return '<span class="mast-theme">' + h(t.trim()) + '</span>';
  }).join('') : '';
  var issueNum = updateIssueNumber();
  return '<div class="masthead">\n' +
    '<div class="masthead-inner">\n' +
    '<div class="mast-top">\n' +
    '<span class="mast-issue">Issue #' + issueNum + '</span>' +
    '<span class="mast-date">' + h(dateStr) + streakTxt + '</span>\n' +
    '</div>\n' +
    '<div class="mast-wordmark">THE GAHWA</div>\n' +
    '<div class="mast-sub">THE GULF BRIEF</div>\n' +
    '<div class="mast-tagline">A Premium Daily Brew of Gulf Insight</div>\n' +
    '<div class="mast-stats">\n' +
    '<div class="mast-stat"><div class="mast-stat-n">' + nlCount + '</div><div class="mast-stat-l">Newsletters</div></div>\n' +
    '<div class="mast-stat"><div class="mast-stat-n">' + sigCount + '</div><div class="mast-stat-l">Signals</div></div>\n' +
    '</div>\n' +
    '</div>\n' +
    (brief.sod ? '<div class="mast-sod"><div class="mast-sod-label">Signal of the Day</div><div class="mast-sod-text">' + h(brief.sod) + '</div></div>\n' : '') +
    (brief.bigStory ? '<div class="mast-big-story"><div class="mast-big-story-label">Today\'s Big Story</div><div class="mast-big-story-text">' + h(brief.bigStory) + '</div></div>\n' : '') +
    (themes ? '<div class="mast-themes">' + themes + '</div>\n' : '') +
    '<div style="height:24px"></div>\n' +
    '<div class="mast-bottom"></div>\n' +
    '</div>\n';
}

function renderFitness(fit) {
  if (!fit || fit.trim().length < 5) return '';
  return '<div class="fitness">\n' +
    '<div class="fitness-label">TODAY\'S MARCHING ORDERS</div>\n' +
    '<div class="fitness-text">' + h(fit).replace(/\n/g,'<br>').replace(/\r/g,'<br>').replace(/---/g,'<span style="color:#374151">\u2014</span>') + '</div>\n' +
    '</div>\n';
}

function renderBrief(brief) {
  return '<div class="section brief-section">\n' +
    '<div class="sec-hdr"><span class="sec-num">00</span><span class="sec-title">Executive Brief</span></div>\n' +
    (brief.watch ?
      '<div class="watch-bar"><div class="watch-bar-label">WATCHING</div><div class="watch-bar-text">' + stripScores(h(brief.watch)) + '</div></div>\n'
      : '') +
    '</div>\n';
}

function renderTOC() {
  var items = [
    ['01','Signals','#signals'],
    ['02','Themes','#themes'],
    ['03','Viral','#viral'],
    ['04','Startups','#startup'],
    ['05','Watch','#watch'],
    ['06','Question','#question'],
    ['07','Inspiration','#inspiration'],
  ];
  return '<div class="toc-section">\n' +
    items.map(function(it) {
      return '<a href="' + it[2] + '" class="toc-item"><span class="toc-n">' + it[0] + '</span>&nbsp;<span class="toc-label">' + it[1] + '</span></a>';
    }).join('') +
    '\n</div>\n';
}

function renderSignals(signals, voice) {
  if (!signals || !signals.length) return '';

  var CAT_COLORS = {
    'AI & TECH':           {dot:'#DAA520', name:'#DAA520'},
    'GCC & SAUDI':         {dot:'#34d399', name:'#34d399'},
    'FINTECH & CRYPTO':    {dot:'#fbbf24', name:'#fbbf24'},
    'MACRO & GEO':         {dot:'#f87171', name:'#f87171'},
    'MEDIA & MARKETING':   {dot:'#60a5fa', name:'#60a5fa'},
    'PEOPLE':              {dot:'#c084fc', name:'#c084fc'},
    'PRODUCT':             {dot:'#fb923c', name:'#fb923c'},
    'CULTURE':             {dot:'#94a3b8', name:'#94a3b8'},
  };
  var DEFAULT = {dot:'#4b5563', name:'#4b5563'};

  var html = '<div class="section" id="signals">\n' +
    '<div class="sec-hdr"><span class="sec-num">01</span><div class="sec-accent" style="background:#DAA520"></div><span class="sec-title">Ranked Signals</span>' +
    '<span class="sec-count">' + signals.length + ' signals</span></div>\n';

  if (voice) {
    var vLine = getField(voice, 'V') || voice.trim();
    if (vLine) html += '<div class="editorial">' + h(vLine) + '</div>\n';
  }

  var lastCat = '';
  signals.forEach(function(s, idx) {
    var cat    = s.cat || 'OTHER';
    var colors = CAT_COLORS[cat] || DEFAULT;
    var isPri  = s.pri === 'YES';
    var isTrd  = s.trd === 'YES';

    if (cat !== lastCat) {
      html += '<div class="cat-divider">' +
        '<div class="cat-dot" style="background:' + colors.dot + '"></div>' +
        '<div class="cat-name" style="color:' + colors.name + '">' + h(cat) + '</div>' +
        '<div class="cat-line"></div>' +
        '</div>\n';
      lastCat = cat;
    }

    var cardClass = 'sig' + (isPri ? ' pri' : (isTrd ? ' trd' : ''));
    var typeBadge = s.type === 'OPP' ? 'b-opp' : (s.type === 'GAP' ? 'b-gap' : 'b-cat');

    html += '<div class="' + cardClass + '" id="s' + (idx+1) + '">\n';
    html += '<div class="sig-top">\n';
    if (isPri) html += '<span class="badge b-pri">PRIORITY</span>\n';
    if (isTrd) html += '<span class="badge b-trd">TREND' + (s.src > 1 ? ' x' + s.src : '') + '</span>\n';
    if (s.type) html += '<span class="badge ' + typeBadge + '">' + h(s.type) + '</span>\n';
    if (s.aud)  html += '<span class="badge b-aud">' + h(s.aud) + '</span>\n';
    html += '<span class="sig-num">#' + (idx+1) + '</span>\n';
    html += '</div>\n';
    html += '<div class="sig-bottom">\n';
    if (isPri && idx < 8) {
      var nm = s.headline.match(/[$€£][\d\.]+[BMKbmk]?|[\d]{4,}[BMKbmk%]?|[\d\.]+[BMK][+]?|[\d\.]+%|[\d\.]+x/);
      if (nm) html += '<div class="sig-stat">' + h(nm[0].trim()) + '</div>\n';
    }
    html += '<div class="sig-h">' + h(s.headline) + '</div>\n';
    if (idx < 8) {
      html += '<div class="sig-i">' + h(s.insight) + '</div>\n';
      if (s.ctx && s.ctx.length > 5 && s.ctx !== 'REMEMBER:') {
        var ctxText = s.ctx.replace(/^REMEMBER:\s*/i, '');
        html += '<div class="sig-ctx"><strong>REMEMBER</strong> ' + h(ctxText) + '</div>\n';
      }
      if (s.url && s.url.length > 5 && s.url !== 'N/A') {
        html += '<div class="sig-src">\&#128206; <a href="' + h(s.url) + '" target="_blank" rel="noopener">Read source</a></div>\n';
      }
      html += '<div class="sig-w"><strong>\u2192</strong> ' + h(s.whynow) + '</div>\n';
    } else {
      html += '<div class="sig-compact">' + h(s.whynow) + '</div>\n';
      if (s.url && s.url.length > 5 && s.url !== 'N/A') {
        html += '<div class="sig-src">\&#128206; <a href="' + h(s.url) + '" target="_blank" rel="noopener">Read source</a></div>\n';
      }
    }
    html += '</div>\n</div>\n';
  });

  html += '</div>\n';
  return html;
}

function renderThemes(text) {
  if (!text) return '';
  var html   = '<div class="section" id="themes">\n<div class="sec-hdr"><span class="sec-num">02</span><div class="sec-accent" style="background:#C9981A"></div><span class="sec-title">Themes</span></div>\n';
  var blocks = text.split('\n---\n');
  blocks.forEach(function(block) {
    var title  = getField(block, 'T');
    var sigs   = getField(block, 'SIGS');
    var saudi  = getField(block, 'SAUDI');
    var mena   = getField(block, 'MENA');
    var global = getField(block, 'GLOBAL');
    var action = getField(block, 'DO');
    if (!title) return;
    html += '<div class="theme">\n';
    html += '<div class="theme-title">' + h(title) + '</div>\n';
    if (sigs)   html += '<div class="theme-sigs">SIGNALS ' + h(sigs) + '</div>\n';
    if (saudi)  html += '<div class="theme-block"><div class="theme-geo geo-sa">\&#127480;\&#127462; Saudi / GCC</div><div class="theme-txt">' + h(saudi) + '</div></div>\n';
    if (mena)   html += '<div class="theme-block"><div class="theme-geo geo-me">\&#127757; MENA</div><div class="theme-txt theme-txt-sm">' + h(mena) + '</div></div>\n';
    if (global) html += '<div class="theme-block"><div class="theme-geo geo-gl">\&#127760; Global</div><div class="theme-txt theme-txt-sm">' + h(global) + '</div></div>\n';
    if (action) html += '<div class="theme-do">' + h(action) + '</div>\n';
    html += '</div>\n';
  });
  html += '</div>\n';
  return html;
}

function renderViral(text) {
  if (!text) return '';
  var html  = '<div class="section" id="viral">\n<div class="sec-hdr"><span class="sec-num">03</span><div class="sec-accent" style="background:#ec4899"></div><span class="sec-title">Viral Signals</span></div>\n<div class="viral-grid">\n';
  var lines = text.split('\n');
  lines.forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var hookIdx = line.indexOf('HOOK:');
    var whyIdx  = line.indexOf('| WHY:');
    if (hookIdx === -1) return;
    var hook = whyIdx !== -1 ? line.substring(hookIdx+5, whyIdx).trim() : line.substring(hookIdx+5).trim();
    var why  = whyIdx !== -1 ? line.substring(whyIdx+6).trim() : '';
    html += '<div class="viral-card"><div class="viral-hook">' + h(hook) + '</div>';
    if (why) html += '<div class="viral-why">' + h(why) + '</div>';
    html += '</div>\n';
  });
  html += '</div>\n</div>\n';
  return html;
}

function srow(lbl, val) {
  return '<div class="startup-row"><span class="startup-lbl">' + lbl + '</span><div class="startup-val">' + h(val) + '</div></div>\n';
}

function renderStartup(text) {
  if (!text) return '';
  var html   = '<div class="section" id="startup">\n<div class="sec-hdr"><span class="sec-num">04</span><div class="sec-accent" style="background:#10b981"></div><span class="sec-title">Startup Engine</span></div>\n';
  var blocks = text.split('\n---\n');
  blocks.forEach(function(block) {
    var name = getField(block, 'NAME');
    if (!name) return;
    var sigs = getField(block, 'SIGS');
    var prob = getField(block, 'PROB');
    var sol  = getField(block, 'SOL');
    var cus  = getField(block, 'CUS');
    var mod  = getField(block, 'MOD');
    var now  = getField(block, 'NOW');
    var gcc  = getField(block, 'GCC');
    html += '<div class="startup">\n';
    html += '<div class="startup-hdr"><div><div class="startup-name">' + h(name) + '</div>';
    if (sigs) html += '<div class="startup-sigs">Combines signals ' + h(sigs) + '</div>';
    html += '</div>';
    if (gcc) html += '<div class="startup-gcc-badge">\&#127480;\&#127462; GCC First</div>';
    html += '</div>\n<div class="startup-body">\n';
    if (prob) html += srow('Problem', prob);
    if (sol)  html += srow('Solution', sol);
    if (cus)  html += srow('Customer', cus);
    if (mod)  html += srow('Model', mod);
    if (now)  html += '<div class="startup-row"><span class="startup-lbl">Why Now</span><div class="startup-val"><div class="startup-now">' + h(now) + '</div></div></div>\n';
    if (gcc)  html += '<div class="startup-gcc">\&#127480;\&#127462; ' + h(gcc) + '</div>\n';
    html += '</div>\n</div>\n';
  });
  html += '</div>\n';
  return html;
}

function renderWatch(text) {
  if (!text) return '';
  var html  = '<div class="section" id="watch">\n<div class="sec-hdr"><span class="sec-num">05</span><div class="sec-accent" style="background:#f59e0b"></div><span class="sec-title">Watch List</span><span class="sec-count">Near-threshold signals</span></div>\n';
  var lines = text.split('\n');
  var sig = '', why = '';
  function flush() {
    if (!sig) return;
    html += '<div class="watch-card"><div class="watch-sig">' + h(sig) + '</div>';
    if (why) html += '<div class="watch-why">' + h(why) + '</div>';
    html += '</div>\n';
    sig = ''; why = '';
  }
  lines.forEach(function(line) {
    line = line.trim();
    if (line.startsWith('SIG:'))  { flush(); sig = line.substring(4).trim(); }
    else if (line.startsWith('WHY:')) why = line.substring(4).trim();
  });
  flush();
  html += '</div>\n';
  return html;
}

function renderInspiration(text) {
  if (!text) return '';
  var html = '<div class="section" id="inspiration">\n' +
    '<div class="sec-hdr"><span class="sec-num">07</span>' +
    '<span class="sec-title">Inspiration</span>' +
    '<span class="sec-count">decompress</span></div>\n' +
    '<div class="inspo-grid">\n';
  var lines = text.split('\n');
  lines.forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var itemIdx = line.indexOf('ITEM:');
    var riffIdx = line.indexOf('| RIFF:');
    if (itemIdx === -1) return;
    var item = riffIdx !== -1 ? line.substring(itemIdx+5, riffIdx).trim() : line.substring(itemIdx+5).trim();
    var riff = riffIdx !== -1 ? line.substring(riffIdx+7).trim() : '';
    html += '<div class="inspo-card">';
    html += '<div class="inspo-item">' + h(item) + '</div>';
    if (riff) html += '<div class="inspo-riff">' + h(riff) + '</div>';
    html += '</div>\n';
  });
  html += '</div>\n</div>\n';
  return html;
}

function renderQuestion(text) {
  if (!text) return '';
  var q   = getField(text, 'Q');
  var ctx = getField(text, 'CTX');
  if (!q) return '';
  return '<div class="section question-section" id="question">\n' +
    '<div class="sec-hdr"><span class="sec-num">06</span><span class="sec-title">Question of the Day</span></div>\n' +
    '<div class="qbox"><div class="q-text">' + h(q) + '</div>' +
    (ctx ? '<div class="q-ctx">' + h(ctx) + '</div>' : '') +
    '</div>\n</div>\n';
}

function renderFooter(dateStr, nlCount, cost, runMin, closer) {
  return '<div class="footer">\n' +
    '<div class="footer-logo">THE GAHWA</div>\n' +
    '<div class="footer-sub">THE GULF BRIEF</div>\n' +
    '<div class="footer-tagline">A Premium Daily Brew of Gulf Insight</div>\n' +
    (closer ? '<div class="footer-closer">' + h(closer) + '</div>\n' :
    '<div class="footer-closer">See you tomorrow \u2014 same time, same Gulf, different signals.</div>\n') +
    '<div class="footer-compliance">\n' +
    h(CONFIG.MAILING_ADDRESS) + '<br>\n' +
    '<a href="' + CONFIG.UNSUBSCRIBE_URL + '">Unsubscribe</a> \u00b7 ' +
    '<a href="' + CONFIG.MANAGE_URL + '">Manage Preferences</a>\n' +
    '</div>\n' +
    '<div class="footer-meta">' + h(dateStr) + ' \u00b7 ' + nlCount + ' newsletters \u00b7 ' +
    (cost ? '$' + cost.toFixed(2) + ' \u00b7 ' : '') +
    (runMin ? runMin + ' min' : '') + '</div>\n' +
    '</div>\n';
}


// === templates/scout/scout.html.js ===
// ========================================================================
// SCOUT INTERNAL -- HTML Builder
// ========================================================================

/**
 * Build the full Scout internal newsletter HTML
 * @param {string} part1      -- The ===PART 1=== raw text
 * @param {string} parts2to7  -- The ===PARTS 2-7=== raw text
 * @param {string} shareUrl   -- Optional WhatsApp share URL
 * @returns {string} Full HTML document
 */
function buildScoutHTML(part1, parts2to7, shareUrl) {
  var dateStr    = new Date().toDateString();
  var allSignals = parseSignals(part1);
  var brief      = parseBrief(part1);

  // -- Parse sections -------------------------------------------------
  var gOpen       = parseSection(parts2to7, '===GAHWA_OPEN===',   '===END GAHWA_OPEN===');
  var voice       = parseSection(parts2to7, '===VOICE===',        '===END VOICE===');
  var fitness     = parseSection(parts2to7, '===FITNESS===',      '===END FITNESS===');
  var themes      = parseSection(parts2to7, '===THEMES===',       '===END THEMES===');
  var viral       = parseSection(parts2to7, '===VIRAL===',        '===END VIRAL===');
  var startup     = parseSection(parts2to7, '===STARTUP===',      '===END STARTUP===');
  var watch       = parseSection(parts2to7, '===WATCH===',        '===END WATCH===');
  var morningQ    = parseSection(parts2to7, '===QUESTION===',     '===END QUESTION===');
  var inspiration = parseSection(parts2to7, '===INSPIRATION===',  '===END INSPIRATION===');
  var closer      = parseSection(parts2to7, '===CLOSER===',       '===END CLOSER===');

  // -- Stats ----------------------------------------------------------
  var nlCount  = getField(part1, 'COUNT') || '0';
  var sigCount = allSignals.length;
  var cost     = parseFloat(getField(part1, 'COST') || '0');
  var runMin   = getField(part1, 'RUN_MIN') || '';

  // -- Streak ---------------------------------------------------------
  var streakTxt = '';
  var streakVal = getField(part1, 'STREAK');
  if (streakVal && parseInt(streakVal) > 1) {
    streakTxt = ' \u00b7 \ud83d\udd25 ' + streakVal + '-day streak';
  }

  // -- Subject line ---------------------------------------------------
  var subject = parseWinningSubject(parts2to7, dateStr);

  // -- Assemble -------------------------------------------------------
  var css = getCSS();

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1.0">\n' +
    '<title>' + h(subject) + '</title>\n' +
    '<style>\n' + css + '\n</style>\n' +
    '</head>\n<body>\n' +
    '<div class="page">\n' +
      renderShareBar(shareUrl, brief.sod) +
      renderMasthead(dateStr, nlCount, sigCount, brief, streakTxt, cost, runMin) +
      renderFitness(fitness) +
      renderBrief(brief) +
      renderTOC() +
      renderSignals(allSignals, voice) +
      renderThemes(themes) +
      renderViral(viral) +
      renderStartup(startup) +
      renderWatch(watch) +
      renderQuestion(morningQ) +
      renderInspiration(inspiration) +
      renderFooter(dateStr, nlCount, cost, runMin, closer) +
    '</div>\n' +
    '</body>\n</html>';
}


// === templates/gahwa/gahwa.css.js ===
// ========================================================================
// GAHWA PUBLIC -- CSS (matches preview.html design tokens exactly)
// ========================================================================

function getGahwaCSS() {
  return [
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
    '',
    'body{background:#FFFFFF;font-family:\'Work Sans\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#1C2E3F;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}',
    'a{color:inherit;text-decoration:none}',
    '.gw{max-width:600px;margin:0 auto;background:#FFFFFF;}@media only screen and (max-width:480px){.gw{max-width:100%!important;border-left:none!important;border-right:none!important;}}',

    // Topbar
    '.gw-topbar{background:#FFFFFF;padding:8px 20px 7px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #F0EDE6;}',
    '.gw-topbar__link{font-family:\'Montserrat\',sans-serif;font-size:8.5px;font-weight:600;letter-spacing:0.08em;color:#4A7A9B;text-decoration:underline;text-underline-offset:2px;text-transform:lowercase;}',
    '.gw-topbar__link:hover{color:#1A3E5C;}',
    '.gw-topbar__date{font-family:\'Montserrat\',sans-serif;font-size:8.5px;font-weight:600;letter-spacing:0.08em;color:#5C6470;text-transform:uppercase;}',

    // Masthead
    '.gw-mast{background:#FFFFFF;padding:20px 24px 16px;border-bottom:none;display:flex;align-items:center;justify-content:center;}',
    '.gw-mast__inner{display:flex;align-items:center;justify-content:center;}',
    '.gw-mast__finjan{display:block;width:80px;height:auto;}',
    '.gw-mast__wordmark{display:none;}',

    // Intro
    '.gw-intro{padding:18px 24px 20px;border-top:1px solid #E8E2D5;border-bottom:1px solid #E8E2D5;background:#FFFFFF;}',
    '.gw-intro__p{font-family:\'Work Sans\',sans-serif;font-size:15px;font-weight:500;font-style:normal;color:#2A3D4F;line-height:1.7;padding-left:16px;border-left:4px solid #1A3E5C;margin:0;}',

    // Section labels
    '.gw-label{display:flex;align-items:center;gap:10px;padding:20px 24px 0}',
    '.gw-label__icon{font-size:12px;line-height:1;flex-shrink:0}',
    '.gw-label__text{font-family:\'Montserrat\',sans-serif;font-size:9px;font-weight:800;letter-spacing:0.28em;text-transform:uppercase;color:#5C6470;white-space:nowrap;}',
    '.gw-label__rule{flex:1;height:1px;background:#C4BFB8}',

    // Section body
    '.gw-body{padding:14px 24px 28px;border-bottom:1px solid #E8E2D5}' + '@media only screen and (max-width:480px){.gw-body{padding:12px 16px 24px!important}.gw-hero__hed{font-size:22px!important}.gw-intro{padding:14px 16px 16px!important}.gw-mast{padding:16px 16px 12px!important}}',

    // Hero
    '.gw-hero__eyebrow{font-family:\'Montserrat\',sans-serif;font-size:8px;font-weight:800;letter-spacing:0.24em;text-transform:uppercase;color:#5C6470;margin-bottom:10px;display:flex;align-items:center;gap:6px;}',
    '.gw-hero__eyebrow::after{content:\'\';display:inline-block;width:32px;height:1px;background:#C4BFB8}',
    '.gw-hero__lbl{font-family:\'Montserrat\',sans-serif;font-size:8px;font-weight:800;letter-spacing:0.24em;text-transform:uppercase;color:#5C6470;margin-bottom:10px;}',
    '.gw-hero__hed{font-family:\'Poppins\',\'Montserrat\',sans-serif;font-size:30px;font-weight:900;color:#163550;line-height:1.1;letter-spacing:-0.03em;text-transform:none;margin-bottom:16px;}',
    '.gw-hero__body{font-size:14px;line-height:1.65;color:#2A3D4F;font-weight:400;}',

    // Watch callout
    '.gw-hero__watch{margin-top:16px;padding:14px 18px;background:#FFFFFF;border:1px solid #E8E2D5;border-left:4px solid #1A3E5C;border-radius:0 3px 3px 0;box-shadow:none;}',
    '.gw-hero__watch-lbl{font-family:\'Montserrat\',sans-serif;font-size:7.5px;font-weight:800;letter-spacing:0.22em;text-transform:uppercase;color:#1A3E5C;margin-bottom:6px;}',
    '.gw-hero__watch-text{font-size:14.5px;font-weight:500;color:#2A3D4F;line-height:1.7;}',

    // Signal cards
    '.gw-cards{display:flex;flex-direction:column;gap:0}',
    '.gw-card{background:#FFFFFF;border-bottom:1px solid #C4BFB8;padding:20px 20px 20px 28px;position:relative;overflow:hidden;}',
    '.gw-card:last-child{border-bottom:none}',
    '.gw-card::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:4px;background:#1A3E5C}',
    '.gw-card__cat{font-family:\'Montserrat\',sans-serif;font-size:7.5px;font-weight:800;letter-spacing:0.24em;text-transform:uppercase;color:#5C6470;margin-bottom:6px;}',
    '.gw-card__hed{font-family:\'Poppins\',\'Montserrat\',sans-serif;font-size:18px;font-weight:900;text-transform:none;color:#163550;line-height:1.15;letter-spacing:-0.02em;margin-bottom:8px;}',
    '.gw-card__body{font-size:13.5px;line-height:1.75;color:#2A3D4F;font-weight:400;}',

    // "What This Means" callout
    '.gw-card__wtm{margin-top:12px;padding:12px 14px;background:#FFFFFF;border:1px solid #C4BFB8;border-left:6px solid #1A3E5C;border-radius:0 4px 4px 0;box-shadow:none;}',
    '.gw-card__wtm-lbl{font-family:\'Montserrat\',sans-serif;font-size:7px;font-weight:800;letter-spacing:0.2em;text-transform:uppercase;color:#1A3E5C;margin-bottom:4px;}',
    '.gw-card__wtm-text{font-size:13.5px;line-height:1.7;color:#2A3D4F;font-weight:500;}',

    // Skim-bold utility
    '.skim-bold{font-weight:800;color:#163550;letter-spacing:-0.01em;}',

    // Five Before Fajr — white only on navy
    '.gw-fajr{background:#163550;padding:36px 24px}',
    '.gw-fajr__header{display:flex;align-items:center;gap:12px;margin-bottom:24px}',
    '.gw-fajr__title{font-family:\'Montserrat\',sans-serif;font-size:9px;font-weight:800;letter-spacing:0.26em;text-transform:uppercase;color:#FFFFFF;white-space:nowrap;}',
    '.gw-fajr__rule{flex:1;height:1px;background:rgba(255,255,255,0.15)}',
    '.gw-fajr__item{display:flex;align-items:flex-start;gap:20px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.08)}',
    '.gw-fajr__item:last-child{border-bottom:none;padding-bottom:0}',
    '.gw-fajr__num{font-family:\'Poppins\',\'Montserrat\',sans-serif;font-size:22px;font-weight:900;color:#FFFFFF;line-height:1.1;min-width:34px;letter-spacing:-0.04em;flex-shrink:0;}',
    '.gw-fajr__text{font-size:13.5px;color:rgba(255,255,255,0.85);line-height:1.65;padding-top:4px;font-weight:500;}',
    '.gw-fajr__text strong{color:#fff;font-weight:700;}',

    // Gulf card
    '.gw-gulf__card{background:#F8FAFF;border:1px solid #C4BFB8;border-top:3px solid #1A3E5C;border-radius:4px;padding:22px 24px;}',
    '.gw-gulf__fact{font-family:\'Poppins\',\'Montserrat\',sans-serif;font-size:18px;font-weight:800;text-transform:none;color:#163550;line-height:1.25;margin-bottom:10px;}',
    '.gw-gulf__riff{font-size:13px;font-style:normal;color:#5C6470;line-height:1.65;font-weight:500;}',

    // Brewed idea
    '.gw-idea__badge{display:inline-flex;align-items:center;gap:5px;background:#FFFFFF;border:1px solid #C4BFB8;color:#1A3E5C;font-family:\'Montserrat\',sans-serif;font-size:7.5px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;padding:5px 12px;border-radius:2px;margin-bottom:14px;}',
    '.gw-idea__name{font-family:\'Poppins\',\'Montserrat\',sans-serif;font-size:22px;font-weight:900;text-transform:none;color:#163550;line-height:1.15;margin-bottom:24px;}',
    '.gw-idea__rows{display:flex;flex-direction:column;gap:12px}',
    '.gw-idea__row{display:flex;gap:16px;align-items:flex-start}',
    '.gw-idea__lbl{font-family:\'Montserrat\',sans-serif;font-size:7.5px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:#5C6470;min-width:72px;padding-top:3px;flex-shrink:0;}',
    '.gw-idea__val{font-size:13.5px;color:#2A3D4F;line-height:1.72;flex:1;font-weight:500;}',

    // Question box — white only on navy
    '.gw-q{background:#163550;border-radius:8px;padding:26px 28px}',
    '.gw-q__mark{font-family:\'Montserrat\',sans-serif;font-size:8px;font-weight:800;letter-spacing:0.24em;text-transform:uppercase;color:#FFFFFF;margin-bottom:12px;}',
    '.gw-q__text{font-family:\'Poppins\',\'Montserrat\',sans-serif;font-size:19px;font-weight:900;color:#FFFFFF;line-height:1.4;margin-bottom:10px;}',
    '.gw-q__ctx{font-size:13.5px;color:rgba(255,255,255,0.6);line-height:1.65;font-weight:500;}',

    // Forward CTA — navy background, white text, navy button
    '.gw-fwd{margin:0 24px;background:#163550;border-radius:0;padding:28px 32px;text-align:center;position:relative;overflow:hidden;}',
    '.gw-fwd::before{content:\"\";position:absolute;top:0;left:0;right:0;height:3px;background:#2A5278}',
    '.gw-fwd__hed{font-family:\'Poppins\',\'Montserrat\',sans-serif;font-size:20px;font-weight:900;text-transform:none;color:#FFFFFF;line-height:1.2;margin-bottom:6px}',
    '.gw-fwd__sub{font-size:13px;color:rgba(255,255,255,0.55);line-height:1.55;margin-bottom:20px;font-weight:500;}',
    '.gw-fwd__btn{display:inline-block;background:transparent;color:#FFFFFF;font-family:\'Montserrat\',sans-serif;font-size:10.5px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;padding:13px 32px;border-radius:2px;text-decoration:none;border:2px solid #FFFFFF;}',
    '.gw-fwd__btn:hover{opacity:0.88;}',

    // Subscribe section
    '.gw-sub{padding:36px 24px;text-align:center;background:#FFFFFF;border-top:1px solid #C4BFB8}',
    '.gw-sub__hed{font-family:\'Poppins\',\'Montserrat\',sans-serif;font-size:22px;font-weight:900;text-transform:none;color:#163550;margin-bottom:8px;line-height:1.15;}',
    '.gw-sub__body{font-size:13.5px;color:#5C6470;line-height:1.65;margin-bottom:20px;font-weight:500;}',
    '.gw-sub__btn{display:inline-block;background:#163550;color:#FFFFFF;font-family:\'Montserrat\',sans-serif;font-size:10.5px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;padding:13px 32px;border-radius:2px;text-decoration:none;}',
    '.gw-sub__btn:hover{background:#1A3E5C;}',

    // Footer
    '.gw-footer{background:#FFFFFF;padding:22px 24px 24px;text-align:center;border-top:3px solid #2A5278;}',
    '.gw-footer__lockup{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;}',
    '.gw-footer__finjan{width:44px;height:auto;display:block;}',
    '.gw-footer__wordmark{display:none;}',
    '.gw-footer__links{font-size:11px;color:#5C6470;line-height:2}',
    '.gw-footer__links a{color:#1A3E5C;text-decoration:underline;text-underline-offset:2px}',
    '.gw-footer__meta{font-family:\'Montserrat\',sans-serif;font-size:9px;letter-spacing:0.08em;color:#5C6470;margin-top:14px;padding-top:14px;border-top:1px solid #C4BFB8;}',
    '.gw-visual{margin-top:20px}',

    '@media(max-width:640px){',
    '  .gw{border-left:none;border-right:none}',
    '  .gw-mast,.gw-intro,.gw-body,.gw-sub,.gw-footer{padding-left:20px;padding-right:20px}',
    '  .gw-topbar{padding-left:20px;padding-right:20px}',
    '  .gw-label{padding-left:20px;padding-right:20px}',
    '  .gw-fajr{padding-left:20px;padding-right:20px}',
    '  .gw-fwd{margin:0 20px}',
    '  .gw-mast__finjan{width:52px}',
    '  .gw-mast__wordmark{font-size:32px}',
    '  .gw-hero__hed{font-size:24px}',
    '  .gw-card__hed{font-size:16px}',
    '  .gw-idea__name{font-size:20px}',
    '}',
  ].join('\n');
}


// === templates/gahwa/gahwa.visuals.js ===
// ========================================================================
// GAHWA PUBLIC -- SVG Visual Builders (Chart, Stat Card, Infographic, Timeline, Numbers)
// ========================================================================

/**
 * Build a horizontal bar chart SVG from structured ===CHART_DATA=== block
 */
function buildChartSVG(chartBlock) {
  if (!chartBlock || chartBlock.trim().length < 10) return '';
  if (chartBlock.trim() === '[SKIP]' || chartBlock.indexOf('SKIP') === 0) return '';

  var chartTitle   = getField(chartBlock, 'CHART_TITLE');
  var chartInsight = getField(chartBlock, 'CHART_INSIGHT');
  var chartUnit    = getField(chartBlock, 'CHART_UNIT') || '';

  var items = [];
  chartBlock.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    if (/^(CHART_TITLE|CHART_INSIGHT|CHART_UNIT):/i.test(line)) return;
    var li = line.indexOf('LABEL:');
    var vi = line.indexOf('| VAL:');
    var di = line.indexOf('| DELTA:');
    if (li === -1 || vi === -1) return;
    var label = line.substring(li+6, vi).trim();
    var val   = di !== -1 ? line.substring(vi+6, di).trim() : line.substring(vi+6).trim();
    var delta = di !== -1 ? line.substring(di+8).trim() : '';
    var hero  = line.indexOf('*') !== -1;
    if (label && val) items.push({ label: label, val: val, delta: delta, hero: hero, unit: chartUnit });
  });

  if (items.length === 0) return '';
  items = items.slice(0, 6);

  var PAD_LEFT   = 120;
  var PAD_RIGHT  = 20;
  var BAR_H      = 22;
  var GAP        = 8;
  var svgW       = 560;
  var svgH       = items.length * (BAR_H + GAP) + 20;
  var maxVal     = 0;
  items.forEach(function(item) {
    var n = parseFloat(item.val.replace(/[^0-9.]/g, ''));
    if (n > maxVal) maxVal = n;
  });
  var maxBarW = svgW - PAD_LEFT - PAD_RIGHT - 80;
  var DELTA_SPACE = 70;

  var bars = '';
  items.forEach(function(item, idx) {
    var y     = 10 + idx * (BAR_H + GAP);
    var n     = parseFloat(item.val.replace(/[^0-9.]/g, ''));
    var bw    = maxVal > 0 ? Math.max(20, (n / maxVal) * maxBarW) : 20;
    var fill  = item.hero ? '#AE7C3F' : '#163550';
    var txtFill = item.hero ? '#fff' : '#fff';
    var deltaEmoji = '';
    var deltaBg    = '#7C848C';
    if (item.delta && item.delta.trim() && item.delta !== '[leave blank]' && item.delta !== 'blank') {
      var isPos = item.delta.charAt(0) === '+';
      var isNeg = item.delta.charAt(0) === '-';
      deltaBg    = isPos ? '#16a34a' : (isNeg ? '#dc2626' : '#7C848C');
      deltaEmoji = isPos ? '\u25b2' : (isNeg ? '\u25bc' : '\u2192');
    }

    bars +=
      '<text x="' + (PAD_LEFT - 10) + '" y="' + (y + BAR_H/2 + 4) + '" ' +
        'font-family="Montserrat,sans-serif" font-size="' + (item.hero ? '11' : '10') + '" ' +
        'font-weight="' + (item.hero ? '700' : '600') + '" ' +
        'fill="' + (item.hero ? '#DAA520' : '#7C848C') + '" text-anchor="end">' +
        h(item.label) +
      '</text>';

    bars +=
      '<rect x="' + PAD_LEFT + '" y="' + y + '" width="' + bw + '" height="' + BAR_H + '" ' +
        'rx="4" fill="' + fill + '"/>';

    bars +=
      '<text x="' + (PAD_LEFT + bw + 8) + '" y="' + (y + BAR_H/2 + 5) + '" ' +
        'font-family="Montserrat,sans-serif" font-size="12" font-weight="700" fill="' + txtFill + '">' +
        h(item.val + (item.unit ? ' ' + item.unit : '')) +
      '</text>';

    if (item.delta && item.delta.trim() && item.delta !== '[leave blank]' && item.delta !== 'blank') {
      var pillX  = svgW - DELTA_SPACE + 4;
      var pillY  = y + BAR_H/2 - 9;
      var pillTxt = (deltaEmoji ? deltaEmoji + ' ' : '') + item.delta;
      bars +=
        '<rect x="' + pillX + '" y="' + pillY + '" width="' + (DELTA_SPACE - 8) + '" height="18" ' +
          'rx="9" fill="' + deltaBg + '"/>' +
        '<text x="' + (pillX + (DELTA_SPACE - 8)/2) + '" y="' + (pillY + 12) + '" ' +
          'font-family="Montserrat,sans-serif" font-size="10" font-weight="700" ' +
          'fill="#fff" text-anchor="middle">' +
          h(pillTxt) +
        '</text>';
    }
  });

  var titleHtml = chartTitle
    ? '<div style="font-family:Montserrat,sans-serif;font-size:14px;font-weight:800;' +
        'color:#163550;line-height:1.35;margin-bottom:4px;">' + h(chartTitle) + '</div>'
    : '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;' +
        'letter-spacing:0.12em;text-transform:uppercase;color:#7C848C;margin-bottom:10px;">' +
        'Today\'s numbers</div>';

  var insightHtml = chartInsight
    ? '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:#7C848C;' +
        'line-height:1.55;margin-top:10px;padding-top:10px;' +
        'border-top:1px solid #E8E2D5;font-style:italic;">' + h(chartInsight) + '</div>'
    : '';

  var hasHero = items.some(function(i){ return i.hero; });
  var legendHtml = hasHero
    ? '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:600;' +
        'color:#AE7C3F;letter-spacing:0.06em;text-transform:uppercase;' +
        'margin-bottom:8px;">\u2605 Story bar highlighted</div>'
    : '';

  return '<div style="margin:0 0 20px;padding:18px 20px 14px;background:#FFFFFF;' +
    'border-radius:8px;border:1px solid rgba(174,124,63,0.3);border-left:6px solid #163550;">' +
    titleHtml +
    legendHtml +
    '<svg width="100%" viewBox="0 0 ' + svgW + ' ' + svgH + '" ' +
      'style="display:block;overflow:visible;">' + bars + '</svg>' +
    insightHtml +
  '</div>';
}

/**
 * Build a stat card from ===STAT_CARD=== block
 */
function buildStatCardSVG(statBlock) {
  if (!statBlock || statBlock.trim().length < 5) return '';
  if (statBlock.trim() === '[SKIP]' || statBlock.indexOf('SKIP') === 0) return '';

  var num     = getField(statBlock, 'NUM');
  var label   = getField(statBlock, 'LABEL');
  var context = getField(statBlock, 'CONTEXT');
  var delta   = getField(statBlock, 'DELTA');

  if (!num || !label) return '';

  var ctxSentences = context ? context.replace(/([.!?])\s+/g, '$1\n').split('\n').filter(function(s){ return s.trim().length > 3; }) : [];
  var ctx1 = ctxSentences[0] || '';
  var ctx2 = ctxSentences[1] || '';

  var deltaHtml = '';
  if (delta && delta.trim() && delta.trim() !== '[leave blank]' && delta.trim() !== 'blank') {
    var isPos = delta.charAt(0) === '+';
    var isNeg = delta.charAt(0) === '-';
    var deltaBg    = isPos ? '#16a34a' : (isNeg ? '#dc2626' : '#7C848C');
    var deltaEmoji = isPos ? '\u25b2' : (isNeg ? '\u25bc' : '\u2192');
    deltaHtml =
      '<div style="position:absolute;top:16px;right:16px;background:' + deltaBg + ';' +
        'color:#fff;font-family:Montserrat,sans-serif;font-size:11px;font-weight:700;' +
        'letter-spacing:0.06em;padding:4px 10px;border-radius:20px;white-space:nowrap;">' +
        deltaEmoji + ' ' + h(delta) +
      '</div>';
  }

  return '<div style="margin:0 0 20px;padding:22px 24px;background:#163550;border-radius:8px;' +
    'border-top:3px solid #AE7C3F;position:relative;overflow:hidden;">' +

    '<div style="position:absolute;top:-40px;left:-40px;width:180px;height:180px;' +
      'background:radial-gradient(circle,rgba(174,124,63,0.12) 0%,transparent 70%);' +
      'pointer-events:none;"></div>' +

    deltaHtml +

    '<div style="display:flex;align-items:flex-start;gap:24px;">' +

      '<div style="flex-shrink:0;min-width:0;">' +
        '<div style="font-family:Montserrat,sans-serif;font-size:44px;font-weight:900;' +
          'color:#AE7C3F;line-height:1;letter-spacing:-0.02em;">' + h(num) + '</div>' +
      '</div>' +

      '<div style="flex:1;min-width:0;padding-top:4px;">' +
        '<div style="font-family:Montserrat,sans-serif;font-size:13px;font-weight:700;' +
          'color:#fff;line-height:1.35;margin-bottom:10px;font-style:italic;">' +
          h(label) +
        '</div>' +

        (ctx1 ?
          '<div style="font-family:Work Sans,sans-serif;font-size:13px;' +
            'color:rgba(255,255,255,0.8);line-height:1.6;margin-bottom:0;">' +
            h(ctx1) +
          '</div>' : '') +

        (ctx2 ?
          '<div style="font-family:Work Sans,sans-serif;font-size:12px;' +
            'color:rgba(174,124,63,0.85);line-height:1.6;margin-top:6px;' +
            'padding-left:10px;border-left:2px solid rgba(174,124,63,0.4);">' +
            h(ctx2) +
          '</div>' : '') +

      '</div>' +
    '</div>' +
  '</div>';
}

/**
 * Build an infographic from ===INFOGRAPHIC=== block
 */
function buildInfographicSVG(infoBlock) {
  if (!infoBlock || infoBlock.trim().length < 10) return '';
  if (infoBlock.trim() === '[SKIP]' || infoBlock.indexOf('SKIP') === 0) return '';

  var infoTitle   = getField(infoBlock, 'INFOGRAPHIC_TITLE');
  var infoFraming = getField(infoBlock, 'INFOGRAPHIC_FRAMING');
  var connector   = getField(infoBlock, 'CONNECTOR') || '\u2192';

  var items = [];
  infoBlock.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    if (/^(INFOGRAPHIC_TITLE|INFOGRAPHIC_FRAMING|CONNECTOR|TONE_NOTE):/i.test(line)) return;
    var ii = line.indexOf('ITEM:');
    var si = line.indexOf('| STAT:');
    var ni = line.indexOf('| NOTE:');
    if (ii === -1 || si === -1) return;
    var item = line.substring(ii+5, si).trim();
    var stat = ni !== -1 ? line.substring(si+7, ni).trim() : line.substring(si+7).trim();
    var note = ni !== -1 ? line.substring(ni+7).trim() : '';
    if (item && stat) items.push({ item: item, stat: stat, note: note });
  });

  if (items.length === 0) return '';
  items = items.slice(0, 3);

  var connectorDisplay = h(connector);

  var panelCells = [];
  items.forEach(function(item, i) {
    panelCells.push(
      '<td style="width:' + Math.floor(82/items.length) + '%;padding:0 10px;vertical-align:top;">' +

        '<div style="font-family:Montserrat,sans-serif;font-size:26px;font-weight:900;' +
          'color:#163550;line-height:1;margin-bottom:6px;letter-spacing:-0.02em;">' +
          h(item.stat) +
        '</div>' +

        '<div style="font-family:Montserrat,sans-serif;font-size:10px;font-weight:700;' +
          'letter-spacing:0.1em;text-transform:uppercase;color:#AE7C3F;margin-bottom:8px;">' +
          h(item.item) +
        '</div>' +

        (item.note ?
          '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:#7C848C;' +
            'line-height:1.5;font-style:italic;">' +
            h(item.note) +
          '</div>' : '') +

      '</td>'
    );

    if (i < items.length - 1) {
      panelCells.push(
        '<td style="width:' + Math.floor(18/(items.length-1)) + '%;text-align:center;' +
          'vertical-align:middle;padding:0 4px;">' +
          '<div style="font-family:Montserrat,sans-serif;font-size:16px;font-weight:900;' +
            'color:#AE7C3F;line-height:1;">' +
            connectorDisplay +
          '</div>' +
        '</td>'
      );
    }
  });

  var titleHtml = infoTitle
    ? '<div style="font-family:Montserrat,sans-serif;font-size:14px;font-weight:800;' +
        'color:#163550;line-height:1.35;margin-bottom:' + (infoFraming ? '4px' : '14px') + ';">' +
        h(infoTitle) +
      '</div>'
    : '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;' +
        'letter-spacing:0.12em;text-transform:uppercase;color:#7C848C;margin-bottom:14px;">' +
        'By the numbers' +
      '</div>';

  var framingHtml = infoFraming
    ? '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:#7C848C;' +
        'line-height:1.5;margin-bottom:16px;font-style:italic;">' +
        h(infoFraming) +
      '</div>'
    : '<div style="margin-bottom:14px;"></div>';

  return '<div style="margin:0 0 20px;padding:18px 20px;background:#FFFFFF;' +
    'border:1px solid rgba(174,124,63,0.3);border-radius:8px;">' +
    titleHtml +
    framingHtml +
    '<div style="height:2px;background:linear-gradient(90deg,#AE7C3F,rgba(174,124,63,0.1));' +
      'border-radius:2px;margin-bottom:16px;"></div>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' +
    '<tr>' + panelCells.join('') + '</tr>' +
    '</table>' +
  '</div>';
}

/**
 * Build a vertical timeline SVG from ===TIMELINE=== block (Axios editorial style)
 * Input: { events: [ { marker: string, event: string, note: string } ] }
 * Max events: 6 (compress if more)
 */
function buildTimelineSVG(timelineBlock) {
  if (!timelineBlock || timelineBlock.trim().length < 10) return '';
  if (timelineBlock.trim() === '[SKIP]' || timelineBlock.indexOf('SKIP') === 0) return '';

  var tlTitle   = getField(timelineBlock, 'TIMELINE_TITLE');
  var tlInsight = getField(timelineBlock, 'TIMELINE_INSIGHT');

  var events = [];
  timelineBlock.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    if (/^(TIMELINE_TITLE|TIMELINE_INSIGHT|TONE_NOTE):/i.test(line)) return;
    var ei = line.indexOf('EVENT:');
    var ti = line.indexOf('| TITLE:');
    var ni = line.indexOf('| NOTE:');
    if (ei === -1 || ti === -1) return;
    var marker = line.substring(ei + 6, ti).trim();
    var event  = ni !== -1 ? line.substring(ti + 8, ni).trim() : line.substring(ti + 8).trim();
    var note   = ni !== -1 ? line.substring(ni + 7).trim() : '';
    if (marker && event) events.push({ marker: marker, event: event, note: note });
  });

  if (events.length === 0) return '';
  events = events.slice(0, 6);

  var DOT_R    = 6;
  var LINE_W   = 2;
  var ROW_H    = 60;
  var PAD_LEFT = 100;
  var PAD_TOP  = 10;
  var svgW     = 560;
  var svgH     = PAD_TOP + events.length * ROW_H + 10;

  var svgContent = '';
  events.forEach(function(ev, i) {
    var y = PAD_TOP + i * ROW_H;
    var dotCy = y + ROW_H / 2;

    // Vertical line
    if (i < events.length - 1) {
      svgContent += '<line x1="' + PAD_LEFT + '" y1="' + (dotCy + DOT_R + 2) + '" ' +
        'x2="' + PAD_LEFT + '" y2="' + (dotCy + ROW_H - DOT_R - 2) + '" ' +
        'stroke="#B8CDD9" stroke-width="' + LINE_W + '"/>';
    }

    // Dot marker
    svgContent += '<circle cx="' + PAD_LEFT + '" cy="' + dotCy + '" r="' + DOT_R + '" ' +
      'fill="#1A3E5C" stroke="#FFFFFF" stroke-width="2"/>';

    // Marker label (left of dot)
    svgContent += '<text x="' + (PAD_LEFT - 12) + '" y="' + (dotCy + 4) + '" ' +
      'font-family="Montserrat,sans-serif" font-size="10" font-weight="600" ' +
      'fill="#7C848C" text-anchor="end">' + h(ev.marker) + '</text>';

    // Event title (right of dot)
    svgContent += '<text x="' + (PAD_LEFT + 16) + '" y="' + (dotCy - 2) + '" ' +
      'font-family="Montserrat,sans-serif" font-size="13" font-weight="700" ' +
      'fill="#163550">' + h(ev.event) + '</text>';

    // Note (below event title)
    if (ev.note) {
      svgContent += '<text x="' + (PAD_LEFT + 16) + '" y="' + (dotCy + 14) + '" ' +
        'font-family="Work Sans,sans-serif" font-size="11" font-weight="400" ' +
        'fill="#7C848C">' + h(ev.note) + '</text>';
    }
  });

  var titleHtml = tlTitle
    ? '<div style="font-family:Montserrat,sans-serif;font-size:14px;font-weight:800;' +
        'color:#163550;line-height:1.35;margin-bottom:4px;">' + h(tlTitle) + '</div>'
    : '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;' +
        'letter-spacing:0.12em;text-transform:uppercase;color:#7C848C;margin-bottom:10px;">' +
        'Timeline</div>';

  var insightHtml = tlInsight
    ? '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:#7C848C;' +
        'line-height:1.55;margin-top:10px;padding-top:10px;' +
        'border-top:1px solid #E8E2D5;font-style:italic;">' + h(tlInsight) + '</div>'
    : '';

  return '<div style="margin:0 0 20px;padding:18px 20px 14px;background:#FFFFFF;' +
    'border-radius:8px;border:1px solid rgba(174,124,63,0.3);border-left:6px solid #163550;">' +
    titleHtml +
    '<svg width="100%" viewBox="0 0 ' + svgW + ' ' + svgH + '" ' +
      'style="display:block;overflow:visible;">' + svgContent + '</svg>' +
    insightHtml +
  '</div>';
}

/**
 * Build a numbers block SVG from ===NUMBERS=== block (Morning Brew editorial style)
 * Input: { stats: [ { value: string, unit: string, label: string, delta: string } ] }
 * 2-4 stats displayed side by side
 */
function buildNumbersSVG(numbersBlock) {
  if (!numbersBlock || numbersBlock.trim().length < 10) return '';
  if (numbersBlock.trim() === '[SKIP]' || numbersBlock.indexOf('SKIP') === 0) return '';

  var numTitle   = getField(numbersBlock, 'NUMBERS_TITLE');
  var numInsight = getField(numbersBlock, 'NUMBERS_INSIGHT');

  var stats = [];
  numbersBlock.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    if (/^(NUMBERS_TITLE|NUMBERS_INSIGHT|TONE_NOTE):/i.test(line)) return;
    var si = line.indexOf('STAT:');
    var ui = line.indexOf('| UNIT:');
    var li = line.indexOf('| LABEL:');
    var di = line.indexOf('| DELTA:');
    if (si === -1 || ui === -1 || li === -1) return;
    var value = line.substring(si + 5, ui).trim();
    var unit  = line.substring(ui + 7, li).trim();
    var label = di !== -1 ? line.substring(li + 8, di).trim() : line.substring(li + 8).trim();
    var delta = di !== -1 ? line.substring(di + 8).trim() : '';
    if (value && unit && label) stats.push({ value: value, unit: unit, label: label, delta: delta });
  });

  if (stats.length < 2) return '';
  stats = stats.slice(0, 4);

  var colW = Math.floor(100 / stats.length);

  var cells = '';
  stats.forEach(function(s) {
    var deltaBadge = '';
    if (s.delta && s.delta.trim() && s.delta !== '[leave blank]' && s.delta !== 'blank' && s.delta !== 'flat') {
      var isPos = s.delta.charAt(0) === '+';
      var isNeg = s.delta.charAt(0) === '-';
      var dColor = isPos ? '#16a34a' : (isNeg ? '#dc2626' : '#6b7280');
      var dArrow = isPos ? '\u25b2' : (isNeg ? '\u25bc' : '\u2192');
      deltaBadge = '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;' +
        'color:' + dColor + ';margin-top:6px;letter-spacing:0.04em;">' +
        dArrow + ' ' + h(s.delta) + '</div>';
    } else if (s.delta && s.delta.trim() === 'flat') {
      deltaBadge = '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;' +
        'color:#6b7280;margin-top:6px;letter-spacing:0.04em;">\u2192 flat</div>';
    }

    cells +=
      '<td style="width:' + colW + '%;padding:0 8px;vertical-align:top;text-align:center;">' +
        '<div style="font-family:Montserrat,sans-serif;font-size:28px;font-weight:900;' +
          'color:#163550;line-height:1.1;letter-spacing:-0.02em;">' +
          h(s.value) + '<span style="font-size:16px;font-weight:600;color:#7C848C;">' + h(s.unit) + '</span>' +
        '</div>' +
        '<div style="font-family:Work Sans,sans-serif;font-size:11px;font-weight:500;' +
          'color:#7C848C;line-height:1.4;margin-top:4px;">' + h(s.label) + '</div>' +
        deltaBadge +
      '</td>';
  });

  var titleHtml = numTitle
    ? '<div style="font-family:Montserrat,sans-serif;font-size:14px;font-weight:800;' +
        'color:#163550;line-height:1.35;margin-bottom:4px;">' + h(numTitle) + '</div>'
    : '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;' +
        'letter-spacing:0.12em;text-transform:uppercase;color:#7C848C;margin-bottom:10px;">' +
        'By the numbers</div>';

  var insightHtml = numInsight
    ? '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:#7C848C;' +
        'line-height:1.55;margin-top:10px;padding-top:10px;' +
        'border-top:1px solid #E8E2D5;font-style:italic;">' + h(numInsight) + '</div>'
    : '';

  return '<div style="margin:0 0 20px;padding:18px 20px 14px;background:#FFFFFF;' +
    'border-radius:8px;border:1px solid rgba(174,124,63,0.3);border-left:6px solid #163550;">' +
    titleHtml +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' +
    '<tr>' + cells + '</tr>' +
    '</table>' +
    insightHtml +
  '</div>';
}


// === templates/gahwa/gahwa.html.js ===
// ========================================================================
// GAHWA PUBLIC -- HTML Builder (v7.1 "Gmail-Safe Compiler")
// ========================================================================
// Phase   : 2 — Runtime-Agnostic Compiler
// Emoji   : HTML decimal entities only — no Unicode escapes
// Layout  : Inline styles on all Gmail-critical rules
// CSS     : Delegates to getGahwaCSS() global (loaded by test + Apps Script)
// Visuals : Delegates to buildChartSVG / buildStatCardSVG / buildInfographicSVG /
//           buildTimelineSVG / buildNumbersSVG globals
// Slots   : visual_primary + visual_secondary — Claude selects both per issue
// Runtime : Apps Script V8 + Node.js compatible
// ========================================================================

/**
 * Build the full Gahwa public newsletter HTML from marker-format strings
 * @param {string} part1      — The ===PART 1=== raw text
 * @param {string} parts2to7  — The ===PARTS 2-7=== raw text
 * @param {string} shareUrl   — Optional WhatsApp share URL
 * @param {Object} ctx        — Optional context object (for test injection)
 * @returns {string} Full HTML document
 */
function buildGahwaHTMLFromMarkers(part1, parts2to7, shareUrl, ctx) {
  ctx = ctx || {};
  var finjanSrc   = ctx.finjanSrc   || (typeof getFinjanUrl    === 'function' ? getFinjanUrl()    : null);
  if (!finjanSrc && typeof loadFinjanB64 === 'function') finjanSrc = loadFinjanB64();
  if (!finjanSrc) finjanSrc = '';
  var issueNum    = ctx.issueNum    || (typeof updateIssueNumber === 'function' ? updateIssueNumber() : '');
  var dateStr     = ctx.dateStr     || new Date().toDateString();
  var beehiivUrl  = ctx.beehiivUrl  || (typeof CONFIG !== 'undefined' ? CONFIG.BEEHIIV_URL     : '#');
  var unsubUrl    = ctx.unsubUrl    || (typeof CONFIG !== 'undefined' ? CONFIG.UNSUBSCRIBE_URL  : '#');
  var prefsUrl    = ctx.prefsUrl    || (typeof CONFIG !== 'undefined' ? CONFIG.PREFERENCES_URL  : '#');
  var mailingAddr = ctx.mailingAddr || (typeof CONFIG !== 'undefined' ? CONFIG.MAILING_ADDRESS   : '');

  // -- Parse input data -------------------------------------------------
  var allSignals = typeof sortSignalsForGahwa === 'function'
    ? sortSignalsForGahwa(parseSignals(part1))
    : parseSignals(part1);
  var brief = parseBrief(part1);

  // -- Parse sections ---------------------------------------------------
  var gahwaRaw    = parseSection(parts2to7, '===GAHWA_OPEN===',   '===END GAHWA_OPEN===');
  var gOpen       = getField(gahwaRaw, 'G') || gahwaRaw.trim();
  var bigPicture  = parseSection(parts2to7, '===BIG_PICTURE===',  '===END BIG_PICTURE===');
  var viral       = parseSection(parts2to7, '===VIRAL===',        '===END VIRAL===');
  var startup     = parseSection(parts2to7, '===STARTUP===',      '===END STARTUP===');
  var inspiration = parseSection(parts2to7, '===INSPIRATION===',  '===END INSPIRATION===');
  var morningQ    = parseSection(parts2to7, '===QUESTION===',     '===END QUESTION===');
  var subjectBlock= parseSection(parts2to7, '===SUBJECT_LINES===','===END SUBJECT_LINES===');
  var chartBlock  = parseSection(parts2to7, '===CHART_DATA===',   '===END CHART_DATA===');
  var statBlock   = parseSection(parts2to7, '===STAT_CARD===',    '===END STAT_CARD===');
  var infoBlock   = parseSection(parts2to7, '===INFOGRAPHIC===',  '===END INFOGRAPHIC===');
  var timelineBlock = parseSection(parts2to7, '===TIMELINE===',   '===END TIMELINE===');
  var numbersBlock  = parseSection(parts2to7, '===NUMBERS===',    '===END NUMBERS===');
  var visualSlots   = parseSection(parts2to7, '===VISUAL_SLOTS===','===END VISUAL_SLOTS===');

  // -- Build visuals via guard pattern ----------------------------------
  var chartSVG    = typeof buildChartSVG       === 'function' ? buildChartSVG(chartBlock)         : '';
  var statCardSVG = typeof buildStatCardSVG     === 'function' ? buildStatCardSVG(statBlock)       : '';
  var infogSVG    = typeof buildInfographicSVG  === 'function' ? buildInfographicSVG(infoBlock)    : '';
  var timelineSVG = typeof buildTimelineSVG     === 'function' ? buildTimelineSVG(timelineBlock)   : '';
  var numbersSVG  = typeof buildNumbersSVG      === 'function' ? buildNumbersSVG(numbersBlock)     : '';

  // -- Visual slot dispatch ---------------------------------------------
  var visualPrimary   = getField(visualSlots, 'VISUAL_PRIMARY')   || '';
  var visualSecondary = getField(visualSlots, 'VISUAL_SECONDARY') || '';

  function renderVisualByType(type) {
    switch (type) {
      case 'chart':       return chartSVG;
      case 'stat_card':   return statCardSVG;
      case 'infographic': return infogSVG;
      case 'timeline':    return timelineSVG;
      case 'numbers':     return numbersSVG;
      default:            return '';
    }
  }

  var primaryVisualHTML   = renderVisualByType(visualPrimary);
  var secondaryVisualHTML = renderVisualByType(visualSecondary);

  // -- Today's Signal ---------------------------------------------------
  var topSig = null;
  for (var i = 0; i < allSignals.length; i++) {
    if (allSignals[i].pri === 'YES') { topSig = allSignals[i]; break; }
  }
  if (!topSig && allSignals.length > 0) topSig = allSignals[0];

  var todayHedline   = topSig ? topSig.headline : '';
  var todayBody      = brief.bigStory || (topSig ? topSig.insight  : '');
  var todayAction    = topSig ? topSig.whynow   : '';
  var todayWatch     = brief.watch || '';

  // -- Signals to Know (max 4, skip top signal) -------------------------
  var signalCards = [];
  var usedHed = topSig ? topSig.headline : '';
  for (var j = 0; j < allSignals.length && signalCards.length < 4; j++) {
    if (allSignals[j].headline === usedHed) continue;
    signalCards.push(allSignals[j]);
  }

  // -- Five Before Fajr (from VIRAL hooks, max 5) -----------------------
  var fajrItems = [];
  viral.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var hi = line.indexOf('HOOK:');
    if (hi === -1) return;
    var wi   = line.indexOf('| WHY:');
    var hook = wi !== -1 ? line.substring(hi+5, wi).trim() : line.substring(hi+5).trim();
    if (hook) fajrItems.push(hook);
  });

  // -- Only in the Gulf (first INSPIRATION item) ------------------------
  var gulfItem = null;
  inspiration.split('\n').forEach(function(line) {
    if (gulfItem) return;
    line = line.trim();
    var ii = line.indexOf('ITEM:');
    var ri = line.indexOf('| RIFF:');
    if (ii === -1) return;
    var item = ri !== -1 ? line.substring(ii+5, ri).trim() : line.substring(ii+5).trim();
    var riff = ri !== -1 ? line.substring(ri+7).trim() : '';
    if (item) gulfItem = { item: item, riff: riff };
  });

  // -- Brewed Idea (first startup block) --------------------------------
  var startupBlocks = startup.split('\n---\n');
  var bestStartup   = startupBlocks[0] || '';
  var ideaName = getField(bestStartup, 'NAME');
  var ideaProb = getField(bestStartup, 'PROB');
  var ideaSol  = getField(bestStartup, 'SOL');
  var ideaNow  = getField(bestStartup, 'NOW');

  // -- Morning Question -------------------------------------------------
  var mqText = getField(morningQ, 'Q')   || '';
  var mqCtx  = getField(morningQ, 'CTX') || '';

  // -- Emoji constants (HTML entities — Gmail-safe) --------------------
  var EMOJI_COFFEE    = '&#9749;';   // ☕
  var EMOJI_BOLT      = '&#9889;';   // ⚡
  var EMOJI_SATELLITE = '&#128225;'; // 📡
  var EMOJI_MOUNTAIN  = '&#127956;'; // 🏔
  var EMOJI_BULB      = '&#128161;'; // 💡
  var EMOJI_EYE       = '&#128065;'; // 👁
  var EMOJI_QUESTION  = '&#10067;';  // ❓

  // -- Word truncation helpers ------------------------------------------
  function truncate75(text) {
    if (!text) return '';
    var words = text.trim().split(/\s+/);
    return words.length <= 75 ? text.trim() : words.slice(0, 75).join(' ') + '\u2026';
  }
  function truncateWords(text, limit) {
    if (!text) return '';
    var words = text.trim().split(/\s+/);
    return words.length <= limit ? text.trim() : words.slice(0, limit).join(' ') + '\u2026';
  }

  // -- Section label helper ---------------------------------------------
  function sLabel(icon, text) {
    return (
      '<div class="gw-label">' +
        '<span class="gw-label__icon">' + icon + '</span>' +
        '<span class="gw-label__text">' + text + '</span>' +
        '<div class="gw-label__rule" style="flex:1;"></div>' +
      '</div>\n'
    );
  }

  // -- A. MASTHEAD ------------------------------------------------------
  var topbarHtml =
    '<div class="gw-topbar">\n' +
      '<a href="' + h(beehiivUrl) + '" class="gw-topbar__link">Open in browser</a>\n' +
      '<span class="gw-topbar__date">' + h(dateStr) + '</span>\n' +
    '</div>\n';

  var mastheadHtml =
    topbarHtml +
    '<div class="gw-mast">\n' +
      '<img class="gw-mast__finjan" src="' + finjanSrc + '" alt="" width="80" style="width:80px;height:auto;display:block;">\n' +
    '</div>\n';

  // -- B. BIG PICTURE ---------------------------------------------------
  var bigPicHtml = '';
  if (bigPicture) {
    var bpText = getField(bigPicture, 'TEXT') || bigPicture.trim();
    if (bpText) {
      bigPicHtml =
        sLabel(EMOJI_COFFEE, 'The Big Picture') +
        '<div class="gw-body">\n' +
          '<p style="font-size:14px;line-height:1.75;color:#2A3D4F;font-weight:500;">' +
            h(truncate75(bpText)) +
          '</p>\n' +
        '</div>\n';
    }
  }

  // -- C. TODAY'S SIGNAL ------------------------------------------------
  var todaySigHtml =
    sLabel(EMOJI_BOLT, "Today's Signal") +
    '<div class="gw-body">\n' +
      '<div class="gw-hero__hed">' + h(todayHedline) + '</div>\n' +
      '<div class="gw-hero__lbl">What happened</div>\n' +
      '<div class="gw-hero__body">' + h(truncate75(todayBody)) + '</div>\n' +
      (todayWatch ?
        '<div class="gw-hero__watch">' +
          '<div class="gw-hero__watch-lbl">' + EMOJI_EYE + ' Watch</div>' +
          '<div class="gw-hero__watch-text">' + h(todayWatch) + '</div>' +
        '</div>\n' : '') +
      (primaryVisualHTML ? '<div class="gw-visual">' + primaryVisualHTML + '</div>\n' : '') +
    '</div>\n';

  // -- D. SIGNALS TO KNOW -----------------------------------------------
  var sigCardsHtml =
    sLabel(EMOJI_SATELLITE, 'Signals to Know') +
    '<div class="gw-body">\n' +
      '<div class="gw-cards">\n';
  signalCards.forEach(function(s) {
    var bodyWords = (s.insight || '').trim().split(/\s+/);
    var bodyText  = bodyWords.length > 75
      ? bodyWords.slice(0, 75).join(' ') + '\u2026'
      : bodyWords.join(' ');
    sigCardsHtml +=
      '<div class="gw-card">\n' +
        '<div class="gw-card__cat">' + h(s.cat) + '</div>\n' +
        '<div class="gw-card__hed">' + h(s.headline) + '</div>\n' +
        '<div class="gw-card__body">' + h(bodyText) + '</div>\n' +
      '</div>\n';
  });
  sigCardsHtml += '</div>\n';
  if (chartSVG) {
    sigCardsHtml += '<div class="gw-visual">' + chartSVG + '</div>\n';
  }
  sigCardsHtml += '</div>\n';

  // -- E. FIVE BEFORE FAJR ----------------------------------------------
  var fajrHtml =
    '<div class="gw-fajr">\n' +
      '<div class="gw-fajr__header">' +
        '<span class="gw-fajr__title">' + EMOJI_BOLT + ' Five Before Fajr</span>' +
        '<div class="gw-fajr__rule"></div>' +
      '</div>\n';
  fajrItems.slice(0, 5).forEach(function(item, i) {
    fajrHtml +=
      '<div class="gw-fajr__item">' +
        '<div class="gw-fajr__num">0' + (i + 1) + '</div>' +
        '<div class="gw-fajr__text">' + h(item) + '</div>' +
      '</div>\n';
  });
  fajrHtml += '</div>\n';
  if (infogSVG) {
    fajrHtml +=
      '<div style="padding:0 40px;background:#FFFFFF">' +
        infogSVG +
      '</div>\n';
  }

  // -- F. ONLY IN THE GULF ----------------------------------------------
  var gulfHtml = '';
  if (gulfItem) {
    gulfHtml =
      sLabel(EMOJI_MOUNTAIN, 'Only in the Gulf') +
      '<div class="gw-body">\n' +
        '<div class="gw-gulf__card">\n' +
          '<div class="gw-gulf__fact">' + h(gulfItem.item) + '</div>\n' +
          (gulfItem.riff ? '<div class="gw-gulf__riff">' + h(gulfItem.riff) + '</div>\n' : '') +
        '</div>\n' +
      '</div>\n';
  }

  // -- G. BREWED IDEA ---------------------------------------------------
  var ideaHtml = '';
  if (ideaName) {
    ideaHtml =
      sLabel(EMOJI_BULB, 'Brewed Idea') +
      '<div class="gw-body">\n' +
        '<div class="gw-idea__badge">' + EMOJI_COFFEE + ' GCC Opportunity</div>\n' +
        '<div class="gw-idea__name">' + h(ideaName) + '</div>\n' +
        '<div class="gw-idea__rows">\n' +
          (ideaProb ? '<div class="gw-idea__row"><span class="gw-idea__lbl">The gap</span><div class="gw-idea__val">' + h(truncateWords(ideaProb, 20)) + '</div></div>\n' : '') +
          (ideaSol  ? '<div class="gw-idea__row"><span class="gw-idea__lbl">The play</span><div class="gw-idea__val">' + h(truncateWords(ideaSol, 25)) + '</div></div>\n' : '') +
          (ideaNow  ? '<div class="gw-idea__row"><span class="gw-idea__lbl">Why now</span><div class="gw-idea__val">' + h(truncateWords(ideaNow, 15)) + '</div></div>\n' : '') +
        '</div>\n' +
      '</div>\n';
  }

  // -- H. MORNING QUESTION ----------------------------------------------
  var qHtml = '';
  if (mqText) {
    qHtml =
      sLabel(EMOJI_QUESTION, 'Morning Question') +
      '<div class="gw-body">\n' +
        '<div class="gw-q">\n' +
          '<div class="gw-q__mark">Today\'s question</div>\n' +
          '<div class="gw-q__text">' + h(mqText) + '</div>\n' +
          (mqCtx ? '<div class="gw-q__ctx">' + h(mqCtx) + '</div>\n' : '') +
        '</div>\n' +
      '</div>\n';
  }

  // -- I. FORWARD CTA ---------------------------------------------------
  var fwdHtml =
    '<div class="gw-fwd" style="background:#163550;">\n' +
      '<div class="gw-fwd__hed">Know an operator who needs this before markets open?</div>\n' +
      '<div class="gw-fwd__sub">Forward this to one person. That\'s how Gahwa grows.</div>\n' +
      '<a href="' + h(beehiivUrl) + '" class="gw-fwd__btn" style="display:inline-block;background:transparent;color:#FFFFFF;font-family:\'Montserrat\',sans-serif;font-size:10.5px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;padding:13px 32px;border-radius:2px;text-decoration:none;border:2px solid #FFFFFF;">Forward to someone who would be interested \u2192</a>\n' +
    '</div>\n';

  // -- J. SUBSCRIBE -----------------------------------------------------
  var subHtml =
    '<div class="gw-sub">\n' +
      '<div class="gw-sub__hed">Start every morning with Gahwa</div>\n' +
      '<a href="' + h(beehiivUrl) + '" class="gw-sub__btn" style="background:#163550;">Subscribe \u2192</a>\n' +
    '</div>\n';

  // -- K. FOOTER --------------------------------------------------------
  var footerHtml =
    '<div class="gw-footer">\n' +
      '<div class="gw-footer__lockup">\n' +
        '<img class="gw-footer__finjan" src="' + finjanSrc + '" alt="" width="44" style="width:44px;height:auto;display:block;">\n' +
      '</div>\n' +
      '<div class="gw-footer__links">\n' +
        h(mailingAddr) + '<br>\n' +
        '<a href="' + h(unsubUrl) + '">Unsubscribe</a> \u00b7 ' +
        '<a href="' + h(prefsUrl) + '">Manage Preferences</a>\n' +
      '</div>\n' +
      '<div class="gw-footer__meta">' + h(dateStr) + ' \u00b7 Issue #' + issueNum + '</div>\n' +
    '</div>\n';

  // ====================================================================
  // ASSEMBLE
  // ====================================================================
  var css = typeof getGahwaCSS === 'function' ? getGahwaCSS() : '';

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1.0">\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@900&family=Montserrat:wght@600;800;900&family=Work+Sans:wght@400;500;700&display=swap" rel="stylesheet">\n' +
    '<style>\n' + css + '\n</style>\n' +
    '</head>\n<body>\n' +
    '<div class="gw" style="max-width:600px;margin:0 auto;">\n' +
      mastheadHtml +
      bigPicHtml +
      todaySigHtml +
      sigCardsHtml +
      fajrHtml +
      gulfHtml +
      ideaHtml +
      qHtml +
      fwdHtml +
      subHtml +
      footerHtml +
    '</div>\n' +
    '</body>\n</html>';
}

/**
 * Build the full Gahwa public newsletter HTML from JSON issue data
 * @param {Object} issueData — Parsed JSON object matching output_schema.json
 * @param {string} shareUrl  — Optional WhatsApp share URL
 * @param {Object} ctx       — Optional context object (for test injection)
 * @returns {string} Full HTML document
 */
function buildGahwaHTMLFromJSON(issueData, shareUrl, ctx) {
  ctx = ctx || {};
  var finjanSrc   = ctx.finjanSrc   || (typeof getFinjanUrl    === 'function' ? getFinjanUrl()    : null);
  if (!finjanSrc && typeof loadFinjanB64 === 'function') finjanSrc = loadFinjanB64();
  if (!finjanSrc) finjanSrc = '';
  var issueNum    = ctx.issueNum    || (typeof updateIssueNumber === 'function' ? updateIssueNumber() : '');
  var dateStr     = ctx.dateStr     || (issueData.issue && issueData.issue.date) || new Date().toDateString();
  var beehiivUrl  = ctx.beehiivUrl  || (typeof CONFIG !== 'undefined' ? CONFIG.BEEHIIV_URL     : '#');
  var unsubUrl    = ctx.unsubUrl    || (typeof CONFIG !== 'undefined' ? CONFIG.UNSUBSCRIBE_URL  : '#');
  var prefsUrl    = ctx.prefsUrl    || (typeof CONFIG !== 'undefined' ? CONFIG.PREFERENCES_URL  : '#');
  var mailingAddr = ctx.mailingAddr || (typeof CONFIG !== 'undefined' ? CONFIG.MAILING_ADDRESS   : '');

  // -- Extract data from JSON structure ---------------------------------
  var sections   = issueData.sections || {};
  var brief      = sections.brief || issueData.brief || {};
  var signals    = sections.signals || issueData.signals || [];
  var voice      = issueData.voice || {};
  var gahwaOpen  = issueData.gahwa_open || '';

  // -- Build visuals via guard pattern ----------------------------------
  var chartSVG    = (issueData.chart    && typeof buildChartSVG       === 'function') ? buildChartSVG(issueData.chart)         : '';
  var statCardSVG = (issueData.stat_card && typeof buildStatCardSVG     === 'function') ? buildStatCardSVG(issueData.stat_card) : '';
  var infogSVG    = (issueData.infographic && typeof buildInfographicSVG  === 'function') ? buildInfographicSVG(issueData.infographic) : '';
  var timelineSVG = (issueData.timeline && typeof buildTimelineSVG     === 'function') ? buildTimelineSVG(issueData.timeline) : '';
  var numbersSVG  = (issueData.numbers  && typeof buildNumbersSVG      === 'function') ? buildNumbersSVG(issueData.numbers)   : '';

  // -- Visual slot dispatch ---------------------------------------------
  var visualPrimary   = issueData.visual_primary   || '';
  var visualSecondary = issueData.visual_secondary || '';

  function renderVisualByType(type) {
    switch (type) {
      case 'chart':       return chartSVG;
      case 'stat_card':   return statCardSVG;
      case 'infographic': return infogSVG;
      case 'timeline':    return timelineSVG;
      case 'numbers':     return numbersSVG;
      default:            return '';
    }
  }

  var primaryVisualHTML   = renderVisualByType(visualPrimary);
  var secondaryVisualHTML = renderVisualByType(visualSecondary);

  // -- Today's Signal ---------------------------------------------------
  var topSig = null;
  for (var i = 0; i < signals.length; i++) {
    if (signals[i].pri === true || signals[i].pri === 'YES') { topSig = signals[i]; break; }
  }
  if (!topSig && signals.length > 0) topSig = signals[0];

  var todayHedline   = topSig ? topSig.h : '';
  var todayBody      = brief.big_story || (topSig ? topSig.i : '');
  var todayAction    = topSig ? topSig.w : '';
  var todayWatch     = Array.isArray(brief.watch) ? brief.watch.join(' · ') : (brief.watch || '');

  // -- Signals to Know (max 4, skip top signal) -------------------------
  var signalCards = [];
  var usedHed = topSig ? topSig.h : '';
  for (var j = 0; j < signals.length && signalCards.length < 4; j++) {
    if (signals[j].h === usedHed) continue;
    signalCards.push(signals[j]);
  }

  // -- Five Before Fajr (from sections.viral hooks, max 5) --------------
  var fajrItems = [];
  if (sections.viral && Array.isArray(sections.viral)) {
    sections.viral.forEach(function(item) {
      if (item.hook && fajrItems.length < 5) fajrItems.push(item.hook);
    });
  }

  // -- Only in the Gulf (first sections.inspiration item) ---------------
  var gulfItem = null;
  if (sections.inspiration && Array.isArray(sections.inspiration) && sections.inspiration.length > 0) {
    var first = sections.inspiration[0];
    if (first.item) gulfItem = { item: first.item, riff: first.riff || '' };
  }

  // -- Brewed Idea (first sections.startup item) ------------------------
  var ideaName = '';
  var ideaProb = '';
  var ideaSol  = '';
  var ideaNow  = '';
  if (sections.startup && Array.isArray(sections.startup) && sections.startup.length > 0) {
    var firstStartup = sections.startup[0];
    ideaName = firstStartup.name || '';
    ideaProb = firstStartup.prob || '';
    ideaSol  = firstStartup.sol  || '';
    ideaNow  = firstStartup.now  || '';
  }

  // -- Morning Question -------------------------------------------------
  var mqText = (sections.question && sections.question.q)   || '';
  var mqCtx  = (sections.question && sections.question.ctx) || '';

  // -- Emoji constants (HTML entities — Gmail-safe) --------------------
  var EMOJI_COFFEE    = '&#9749;';   // ☕
  var EMOJI_BOLT      = '&#9889;';   // ⚡
  var EMOJI_SATELLITE = '&#128225;'; // 📡
  var EMOJI_MOUNTAIN  = '&#127956;'; // 🏔
  var EMOJI_BULB      = '&#128161;'; // 💡
  var EMOJI_EYE       = '&#128065;'; // 👁
  var EMOJI_QUESTION  = '&#10067;';  // ❓

  // -- Word truncation helpers ------------------------------------------
  function truncate75(text) {
    if (!text) return '';
    var words = text.trim().split(/\s+/);
    return words.length <= 75 ? text.trim() : words.slice(0, 75).join(' ') + '\u2026';
  }
  function truncateWords(text, limit) {
    if (!text) return '';
    var words = text.trim().split(/\s+/);
    return words.length <= limit ? text.trim() : words.slice(0, limit).join(' ') + '\u2026';
  }

  // -- Section label helper ---------------------------------------------
  function sLabel(icon, text) {
    return (
      '<div class="gw-label">' +
        '<span class="gw-label__icon">' + icon + '</span>' +
        '<span class="gw-label__text">' + text + '</span>' +
        '<div class="gw-label__rule" style="flex:1;"></div>' +
      '</div>\n'
    );
  }

  // -- A. MASTHEAD ------------------------------------------------------
  var topbarHtml =
    '<div class="gw-topbar">\n' +
      '<a href="' + h(beehiivUrl) + '" class="gw-topbar__link">Open in browser</a>\n' +
      '<span class="gw-topbar__date">' + h(dateStr) + '</span>\n' +
    '</div>\n';

  var mastheadHtml =
    topbarHtml +
    '<div class="gw-mast">\n' +
      '<img class="gw-mast__finjan" src="' + finjanSrc + '" alt="" width="80" style="width:80px;height:auto;display:block;">\n' +
    '</div>\n';

  // -- B. TODAY'S SIGNAL ------------------------------------------------
  var todaySigHtml =
    sLabel(EMOJI_BOLT, "Today's Signal") +
    '<div class="gw-body">\n' +
      '<div class="gw-hero__hed">' + h(todayHedline) + '</div>\n' +
      '<div class="gw-hero__lbl">What happened</div>\n' +
      '<div class="gw-hero__body">' + h(truncate75(todayBody)) + '</div>\n' +
      (todayWatch ?
        '<div class="gw-hero__watch">' +
          '<div class="gw-hero__watch-lbl">' + EMOJI_EYE + ' Watch</div>' +
          '<div class="gw-hero__watch-text">' + h(todayWatch) + '</div>' +
        '</div>\n' : '') +
      (primaryVisualHTML ? '<div class="gw-visual">' + primaryVisualHTML + '</div>\n' : '') +
    '</div>\n';

  // -- C. SIGNALS TO KNOW -----------------------------------------------
  var sigCardsHtml =
    sLabel(EMOJI_SATELLITE, 'Signals to Know') +
    '<div class="gw-body">\n' +
      '<div class="gw-cards">\n';
  signalCards.forEach(function(s) {
    var bodyWords = (s.i || '').trim().split(/\s+/);
    var bodyText  = bodyWords.length > 75
      ? bodyWords.slice(0, 75).join(' ') + '\u2026'
      : bodyWords.join(' ');
    sigCardsHtml +=
      '<div class="gw-card">\n' +
        '<div class="gw-card__cat">' + h(s.cat) + '</div>\n' +
        '<div class="gw-card__hed">' + h(s.h) + '</div>\n' +
        '<div class="gw-card__body">' + h(bodyText) + '</div>\n' +
      '</div>\n';
  });
  sigCardsHtml += '</div>\n';
  if (chartSVG) {
    sigCardsHtml += '<div class="gw-visual">' + chartSVG + '</div>\n';
  }
  sigCardsHtml += '</div>\n';

  // -- D. FIVE BEFORE FAJR ----------------------------------------------
  var fajrHtml =
    '<div class="gw-fajr">\n' +
      '<div class="gw-fajr__header">' +
        '<span class="gw-fajr__title">' + EMOJI_BOLT + ' Five Before Fajr</span>' +
        '<div class="gw-fajr__rule"></div>' +
      '</div>\n';
  fajrItems.slice(0, 5).forEach(function(item, i) {
    fajrHtml +=
      '<div class="gw-fajr__item">' +
        '<div class="gw-fajr__num">0' + (i + 1) + '</div>' +
        '<div class="gw-fajr__text">' + h(item) + '</div>' +
      '</div>\n';
  });
  fajrHtml += '</div>\n';
  if (infogSVG) {
    fajrHtml +=
      '<div style="padding:0 40px;background:#FFFFFF">' +
        infogSVG +
      '</div>\n';
  }

  // -- E. ONLY IN THE GULF ----------------------------------------------
  var gulfHtml = '';
  if (gulfItem) {
    gulfHtml =
      sLabel(EMOJI_MOUNTAIN, 'Only in the Gulf') +
      '<div class="gw-body">\n' +
        '<div class="gw-gulf__card">\n' +
          '<div class="gw-gulf__fact">' + h(gulfItem.item) + '</div>\n' +
          (gulfItem.riff ? '<div class="gw-gulf__riff">' + h(gulfItem.riff) + '</div>\n' : '') +
        '</div>\n' +
      '</div>\n';
  }

  // -- F. BREWED IDEA ---------------------------------------------------
  var ideaHtml = '';
  if (ideaName) {
    ideaHtml =
      sLabel(EMOJI_BULB, 'Brewed Idea') +
      '<div class="gw-body">\n' +
        '<div class="gw-idea__badge">' + EMOJI_COFFEE + ' GCC Opportunity</div>\n' +
        '<div class="gw-idea__name">' + h(ideaName) + '</div>\n' +
        '<div class="gw-idea__rows">\n' +
          (ideaProb ? '<div class="gw-idea__row"><span class="gw-idea__lbl">The gap</span><div class="gw-idea__val">' + h(truncateWords(ideaProb, 20)) + '</div></div>\n' : '') +
          (ideaSol  ? '<div class="gw-idea__row"><span class="gw-idea__lbl">The play</span><div class="gw-idea__val">' + h(truncateWords(ideaSol, 25)) + '</div></div>\n' : '') +
          (ideaNow  ? '<div class="gw-idea__row"><span class="gw-idea__lbl">Why now</span><div class="gw-idea__val">' + h(truncateWords(ideaNow, 15)) + '</div></div>\n' : '') +
        '</div>\n' +
      '</div>\n';
  }

  // -- G. MORNING QUESTION ----------------------------------------------
  var qHtml = '';
  if (mqText) {
    qHtml =
      sLabel(EMOJI_QUESTION, 'Morning Question') +
      '<div class="gw-body">\n' +
        '<div class="gw-q">\n' +
          '<div class="gw-q__mark">Today\'s question</div>\n' +
          '<div class="gw-q__text">' + h(mqText) + '</div>\n' +
          (mqCtx ? '<div class="gw-q__ctx">' + h(mqCtx) + '</div>\n' : '') +
        '</div>\n' +
      '</div>\n';
  }

  // -- H. FORWARD CTA ---------------------------------------------------
  var fwdHtml =
    '<div class="gw-fwd" style="background:#163550;">\n' +
      '<div class="gw-fwd__hed">Know an operator who needs this before markets open?</div>\n' +
      '<div class="gw-fwd__sub">Forward this to one person. That\'s how Gahwa grows.</div>\n' +
      '<a href="' + h(beehiivUrl) + '" class="gw-fwd__btn" style="display:inline-block;background:transparent;color:#FFFFFF;font-family:\'Montserrat\',sans-serif;font-size:10.5px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;padding:13px 32px;border-radius:2px;text-decoration:none;border:2px solid #FFFFFF;">Forward to someone who would be interested \u2192</a>\n' +
    '</div>\n';

  // -- I. SUBSCRIBE -----------------------------------------------------
  var subHtml =
    '<div class="gw-sub">\n' +
      '<div class="gw-sub__hed">Start every morning with Gahwa</div>\n' +
      '<a href="' + h(beehiivUrl) + '" class="gw-sub__btn" style="background:#163550;">Subscribe \u2192</a>\n' +
    '</div>\n';

  // -- J. FOOTER --------------------------------------------------------
  var footerHtml =
    '<div class="gw-footer">\n' +
      '<div class="gw-footer__lockup">\n' +
        '<img class="gw-footer__finjan" src="' + finjanSrc + '" alt="" width="44" style="width:44px;height:auto;display:block;">\n' +
      '</div>\n' +
      '<div class="gw-footer__links">\n' +
        h(mailingAddr) + '<br>\n' +
        '<a href="' + h(unsubUrl) + '">Unsubscribe</a> \u00b7 ' +
        '<a href="' + h(prefsUrl) + '">Manage Preferences</a>\n' +
      '</div>\n' +
      '<div class="gw-footer__meta">' + h(dateStr) + ' \u00b7 Issue #' + issueNum + '</div>\n' +
    '</div>\n';

  // ====================================================================
  // ASSEMBLE
  // ====================================================================
  var css = typeof getGahwaCSS === 'function' ? getGahwaCSS() : '';

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1.0">\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@900&family=Montserrat:wght@600;800;900&family=Work+Sans:wght@400;500;700&display=swap" rel="stylesheet">\n' +
    '<style>\n' + css + '\n</style>\n' +
    '</head>\n<body>\n' +
    '<div class="gw" style="max-width:600px;margin:0 auto;">\n' +
      mastheadHtml +
      todaySigHtml +
      sigCardsHtml +
      fajrHtml +
      gulfHtml +
      ideaHtml +
      qHtml +
      fwdHtml +
      subHtml +
      footerHtml +
    '</div>\n' +
    '</body>\n</html>';
}

function buildGahwaHTML(part1, parts2to7, shareUrl, ctx) {
  var trimmed1 = (part1 || '').trim();
  var isJSON = trimmed1.charAt(0) === '{';

  if (isJSON) {
    var issueData;
    try {
      issueData = JSON.parse(trimmed1);
    } catch (e) {
      return buildGahwaHTMLFromMarkers(part1, parts2to7, shareUrl, ctx);
    }

    // Merge parts2to7 JSON into issueData
    var trimmed2 = (parts2to7 || '').trim();
    if (trimmed2.charAt(0) === '{') {
      try {
        var data2 = JSON.parse(trimmed2);
        // Merge top-level keys from data2 into issueData
        var keys2 = Object.keys(data2);
        for (var k = 0; k < keys2.length; k++) {
          var key = keys2[k];
          if (key === 'sections' && issueData.sections && data2.sections) {
            // Deep merge sections objects
            var sectionKeys = Object.keys(data2.sections);
            for (var sk = 0; sk < sectionKeys.length; sk++) {
              issueData.sections[sectionKeys[sk]] = data2.sections[sectionKeys[sk]];
            }
          } else {
            issueData[key] = data2[key];
          }
        }
      } catch (e2) {
        // parts2to7 parse failed — proceed with part1 only
      }
    }

    return buildGahwaHTMLFromJSON(issueData, shareUrl, ctx);
  }

  return buildGahwaHTMLFromMarkers(part1, parts2to7, shareUrl, ctx);
}


// === templates/weekly/weekly.css.js ===
// ========================================================================
// WEEKLY ROLLUP -- CSS
// ========================================================================

function getWeeklyCSS() {
  return [
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
    'body{background:#F5F2EB;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1a1a1a;line-height:1.6;-webkit-font-smoothing:antialiased}',
    'a{color:inherit;text-decoration:none}',
    '.page{max-width:620px;margin:0 auto;background:#fff}',

    '.masthead{background:#163550;padding:36px 40px 28px;text-align:center}',
    '.masthead__wordmark{font-family:"Playfair Display","Georgia",serif;font-size:36px;font-weight:900;color:#fff;letter-spacing:0.02em;line-height:1.2}',
    '.masthead__sub{font-size:10px;font-weight:600;letter-spacing:0.18em;color:rgba(255,255,255,0.5);text-transform:uppercase;margin-top:2px}',
    '.masthead__date{font-size:11px;color:#AE7C3F;margin-top:8px;letter-spacing:0.06em}',
    '.masthead__stats{display:flex;justify-content:center;gap:24px;margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08)}',
    '.masthead__stat{text-align:center}',
    '.masthead__stat-n{font-size:24px;font-weight:900;color:#fff;font-family:"JetBrains Mono",monospace;line-height:1}',
    '.masthead__stat-l{font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.06em;margin-top:2px}',

    '.section{padding:28px 40px;border-bottom:1px solid #e8e8e2}',
    '.section:last-child{border-bottom:none}',
    '.sec-hdr{display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #f0f0ea}',
    '.sec-title{font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#1a1a1a}',
    '.sec-accent{width:20px;height:3px;border-radius:2px;flex-shrink:0}',

    '.sig-card{background:#fff;border:1px solid #e8e8e2;border-radius:6px;padding:14px 16px;margin-bottom:8px}',
    '.sig-card:last-child{margin-bottom:0}',
    '.sig-card__hed{font-size:14px;font-weight:700;color:#1a1a1a;line-height:1.35;margin-bottom:6px}',
    '.sig-card__body{font-size:12px;color:#555;line-height:1.6}',
    '.sig-card__meta{font-size:10px;color:#999;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap}',

    '.stat-card{background:#163550;border-radius:8px;padding:20px 24px;margin-bottom:12px}',
    '.stat-card__num{font-size:36px;font-weight:900;color:#AE7C3F;line-height:1;font-family:"JetBrains Mono",monospace}',
    '.stat-card__label{font-size:12px;font-weight:600;color:rgba(255,255,255,0.7);margin-top:4px}',
    '.stat-card__ctx{font-size:12px;color:rgba(255,255,255,0.5);line-height:1.55;margin-top:8px}',

    '.footer{background:#163550;padding:32px 40px;text-align:center}',
    '.footer__wordmark{font-family:"Playfair Display","Georgia",serif;font-size:18px;font-weight:900;color:#fff}',
    '.footer__meta{font-size:10px;color:rgba(255,255,255,0.3);margin-top:12px}',

    '@media(max-width:640px){',
    '  .masthead,.section,.footer{padding-left:20px;padding-right:20px}',
    '}',
  ].join('\n');
}


// === templates/weekly/weekly.html.js ===
// ========================================================================
// WEEKLY ROLLUP -- HTML Builder
// ========================================================================

/**
 * Build a weekly rollup newsletter from accumulated daily data
 * @param {Array} dailyData -- Array of { date, signals, brief, parts2to7 } objects
 * @returns {string} Full HTML document
 */
function buildWeeklyHTML(dailyData) {
  if (!dailyData || !dailyData.length) return '';

  var weekStart = dailyData[0].date;
  var weekEnd   = dailyData[dailyData.length - 1].date;
  var totalSignals = 0;
  var allSignals = [];
  var topSigs = [];

  dailyData.forEach(function(day) {
    var sigs = parseSignals(day.part1 || '');
    allSignals = allSignals.concat(sigs);
    totalSignals += sigs.length;

    // Collect priority signals
    sigs.forEach(function(s) {
      if (s.pri === 'YES') topSigs.push(s);
    });
  });

  // Sort by score descending
  allSignals.sort(function(a, b) { return (b.src || 0) - (a.src || 0); });
  topSigs.sort(function(a, b) { return (b.src || 0) - (a.src || 0); });

  var css = getWeeklyCSS();

  // -- Masthead -------------------------------------------------------
  var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1.0">\n' +
    '<style>\n' + css + '\n</style>\n' +
    '</head>\n<body>\n' +
    '<div class="page">\n' +
    '<div class="masthead">\n' +
    '<div class="masthead__wordmark">THE GAHWA</div>\n' +
    '<div class="masthead__sub">Weekly Rollup</div>\n' +
    '<div class="masthead__date">' + h(weekStart) + ' \u2013 ' + h(weekEnd) + '</div>\n' +
    '<div class="masthead__stats">\n' +
    '<div class="masthead__stat"><div class="masthead__stat-n">' + dailyData.length + '</div><div class="masthead__stat-l">Days</div></div>\n' +
    '<div class="masthead__stat"><div class="masthead__stat-n">' + totalSignals + '</div><div class="masthead__stat-l">Signals</div></div>\n' +
    '<div class="masthead__stat"><div class="masthead__stat-n">' + topSigs.length + '</div><div class="masthead__stat-l">Priorities</div></div>\n' +
    '</div>\n</div>\n';

  // -- Top Signals ----------------------------------------------------
  html += '<div class="section">\n' +
    '<div class="sec-hdr"><div class="sec-accent" style="background:#DAA520"></div><span class="sec-title">Top Signals This Week</span></div>\n';
  topSigs.slice(0, 10).forEach(function(s) {
    html += '<div class="sig-card">\n' +
      '<div class="sig-card__hed">' + h(s.headline) + '</div>\n' +
      '<div class="sig-card__body">' + h(s.insight) + '</div>\n' +
      '<div class="sig-card__meta">' +
        '<span>' + h(s.cat) + '</span>' +
        (s.src ? '<span>Sources: ' + s.src + '</span>' : '') +
      '</div>\n</div>\n';
  });
  html += '</div>\n';

  // -- All Signals ----------------------------------------------------
  html += '<div class="section">\n' +
    '<div class="sec-hdr"><div class="sec-accent" style="background:#163550"></div><span class="sec-title">All Signals (' + allSignals.length + ')</span></div>\n';
  allSignals.forEach(function(s) {
    html += '<div class="sig-card">\n' +
      '<div class="sig-card__hed">' + h(s.headline) + '</div>\n' +
      '<div class="sig-card__body">' + h(s.whynow) + '</div>\n' +
      '<div class="sig-card__meta">' +
        '<span>' + h(s.cat) + '</span>' +
        (s.pri === 'YES' ? '<span style="color:#DAA520;font-weight:700">PRIORITY</span>' : '') +
      '</div>\n</div>\n';
  });
  html += '</div>\n';

  // -- Footer ---------------------------------------------------------
  html += '<div class="footer">\n' +
    '<div class="footer__wordmark">THE GAHWA</div>\n' +
    '<div class="footer__meta">Weekly Rollup \u00b7 ' + h(weekStart) + ' \u2013 ' + h(weekEnd) + '</div>\n' +
    '</div>\n</div>\n</body>\n</html>';

  return html;
}


// === Html.gs ===
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  HTML.gs — Template assembly · CSS · Scout + Gahwa + Weekly HTML
// ║  THE GAHWA · STARTUP SCOUT OS v5
// ╚══════════════════════════════════════════════════════════════════════╝

// ════════════════════════════════════════════════════════════════════════
// SCOUT INTERNAL HTML (for NOTIFY_EMAIL recipients)
// ════════════════════════════════════════════════════════════════════════

// @agent-target: buildHTML
function buildHTML(part1, parts2to7, fitness, nlCount, cost, runMin, streak, shareUrl) {
  var dateStr     = new Date().toDateString();
  var brief       = parseBrief(part1);
  var signals     = parseSignals(part1);
  var voice       = parseSection(parts2to7, '===VOICE===',       '===END VOICE===');
  var themes      = parseSection(parts2to7, '===THEMES===',      '===END THEMES===');
  var viral       = parseSection(parts2to7, '===VIRAL===',       '===END VIRAL===');
  var startup     = parseSection(parts2to7, '===STARTUP===',     '===END STARTUP===');
  var fit         = parseSection(parts2to7, '===FITNESS===',     '===END FITNESS===');
  var watch       = parseSection(parts2to7, '===WATCH===',       '===END WATCH===');
  var question    = parseSection(parts2to7, '===QUESTION===',    '===END QUESTION===');
  var inspiration = parseSection(parts2to7, '===INSPIRATION===', '===END INSPIRATION===');

  var fitContent = (fit && fit.trim() !== 'NOT AVAILABLE') ? fit : fitness;
  var streakTxt  = streak > 1 ? ' · Day ' + streak : '';

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>' + CONFIG.TITLE + ' · ' + dateStr + '</title>\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&family=Playfair+Display:wght@700;800;900&display=swap" rel="stylesheet">\n' +
    '<style>' + getScoutCSS() + '</style>\n' +
    '</head>\n<body>\n' +
    '<div style="display:none">' + h(brief.sod) + '</div>\n' +
    '<div class="page">\n' +
    renderShareBar(shareUrl, brief.sod) +
    renderMasthead(dateStr, nlCount, signals.length, brief, streakTxt, cost, runMin) +
    renderFitness(fitContent) +
    renderQuestion(question) +
    renderBrief(brief) +
    renderTOC() +
    renderSignals(signals, voice) +
    renderThemes(themes) +
    renderViral(viral) +
    renderStartup(startup) +
    renderWatch(watch) +
    renderInspiration(inspiration) +
    renderFooter(dateStr, nlCount, cost, runMin, getField(voice, 'CLOSE')) +
    '</div>\n</body>\n</html>';
}

// ════════════════════════════════════════════════════════════════════════
// WEEKLY ROLLUP HTML — unified to Gahwa brand tokens
// ════════════════════════════════════════════════════════════════════════


// @agent-target: buildWeeklyRollupHTML
function buildWeeklyRollupHTML(rollup, dateStr) {
  function sec(marker) {
    var s = rollup.indexOf('===' + marker + '===');
    if (s === -1) return '';
    var content = rollup.substring(s + marker.length + 6);
    var e = content.indexOf('===END ' + marker + '===');
    return e !== -1 ? content.substring(0, e).trim() : content.trim();
  }

  var rising   = sec('RISING');
  var breakout = sec('BREAKOUT');
  var fading   = sec('FADING');
  var meta     = sec('META');
  var nextweek = sec('NEXTWEEK');

  function rollupSection(num, color, emoji, title, content) {
    if (!content) return '';
    var body = content.split('\n').filter(function(l) { return l.trim(); }).map(function(l) {
      return '<p style="margin:0 0 10px;font-size:14px;color:#2A3D4F;line-height:1.7;font-family:\'Work Sans\',sans-serif;">' +
        l.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') + '</p>';
    }).join('');
    return '<div style="background:#fff;border-radius:10px;margin-bottom:16px;overflow:hidden;border:1px solid rgba(26,62,92,0.2);">' +
      '<div style="padding:14px 20px;border-left:6px solid ' + color + ';display:flex;align-items:center;gap:10px;">' +
      '<span style="font-size:11px;font-weight:700;color:#ccc;font-family:\'Montserrat\',monospace;">' + num + '</span>' +
      '<span style="font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#1A3E5C;font-family:\'Montserrat\',sans-serif;">' + emoji + ' ' + title + '</span>' +
      '</div><div style="padding:18px 20px;">' + body + '</div></div>';
  }

  var nwLines = nextweek.split('\n').filter(function(l) { return l.indexOf('SIGNAL:') !== -1; });
  var nwHtml  = nwLines.map(function(l) {
    var si  = l.indexOf('SIGNAL:') + 7;
    var wi  = l.indexOf('| WHY:');
    var sig = wi !== -1 ? l.substring(si, wi).trim() : l.substring(si).trim();
    var why = wi !== -1 ? l.substring(wi + 6).trim() : '';
    return '<div style="background:#1A3E5C;border-radius:8px;padding:14px 16px;margin-bottom:8px;">' +
      '<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;font-family:\'Montserrat\',sans-serif;">' + sig + '</div>' +
      (why ? '<div style="font-size:12px;color:rgba(255,255,255,0.5);font-family:\'Work Sans\',sans-serif;">' + why + '</div>' : '') +
      '</div>';
  }).join('');

  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>THE GAHWA · Weekly Rollup · ' + dateStr + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">' +
    '</head><body style="margin:0;padding:0;background:#F5F2EB;">' +

    '<div style="background:#1A3E5C;padding:0;">' +
    '<div style="max-width:660px;margin:0 auto;padding:40px 36px 32px;">' +
    '<div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.25);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px;font-family:\'Montserrat\',sans-serif;">' + dateStr + '</div>' +
    '<div style="font-size:48px;font-weight:900;color:#fff;letter-spacing:0.04em;line-height:1;font-family:\'Montserrat\',sans-serif;">THE GAHWA</div>' +
    '<div style="font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-top:4px;font-family:\'Montserrat\',sans-serif;">THE GULF BRIEF</div>' +
    '<div style="font-size:13px;font-weight:700;color:#DAA520;letter-spacing:0.1em;text-transform:uppercase;margin-top:8px;font-family:\'Montserrat\',sans-serif;">Weekly Rollup</div>' +
    '<div style="height:3px;background:linear-gradient(90deg,#DAA520,#C9981A,#DAA520);margin-top:28px;border-radius:2px;"></div>' +
    '</div></div>' +

    (meta ? '<div style="background:#fff;border-bottom:1px solid rgba(218,165,32,0.2);">' +
    '<div style="max-width:660px;margin:0 auto;padding:28px 36px;">' +
    '<div style="font-size:9px;font-weight:700;color:#DAA520;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:10px;font-family:\'Montserrat\',sans-serif;">This Week\'s Theme</div>' +
    '<div style="font-size:17px;font-weight:700;color:#1A3E5C;line-height:1.55;border-left:6px solid #1A3E5C;padding-left:16px;font-family:\'Montserrat\',sans-serif;">' + meta + '</div>' +
    '</div></div>' : '') +

    '<div style="max-width:660px;margin:0 auto;padding:24px 36px;">' +
    rollupSection('01', '#DAA520', '📈', 'Rising — Dominant Narratives', rising) +
    rollupSection('02', '#1A3E5C', '🚀', 'Breakout — Watch These', breakout) +
    rollupSection('03', '#9ca3af', '📉', 'Fading — Cooling Down', fading) +
    (nwHtml ?
      '<div style="background:#fff;border-radius:10px;margin-bottom:16px;overflow:hidden;border:1px solid rgba(218,165,32,0.3);">' +
      '<div style="padding:14px 20px;border-left:6px solid #DAA520;">' +
      '<span style="font-size:11px;font-weight:700;color:#ccc;font-family:Montserrat,monospace;">04</span> ' +
      '<span style="font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#1A3E5C;font-family:\'Montserrat\',sans-serif;">🔭 Next Week Watch</span>' +
      '</div><div style="padding:18px 20px;">' + nwHtml + '</div></div>' : '') +
    '</div>' +

    '<div style="background:#1A3E5C;padding:28px 36px;text-align:center;">' +
    '<div style="font-size:16px;font-weight:900;color:#fff;margin-bottom:4px;font-family:\'Montserrat\',sans-serif;">THE GAHWA · THE GULF BRIEF</div>' +
    '<div style="font-size:11px;color:#DAA520;font-style:italic;margin-bottom:4px;font-family:\'Work Sans\',sans-serif;">A Premium Daily Brew of Gulf Insight</div>' +
    '<div style="font-size:11px;color:rgba(255,255,255,0.35);line-height:1.8;margin-top:10px;font-family:\'Work Sans\',sans-serif;">' +
    h(CONFIG.MAILING_ADDRESS) + '<br>' +
    '<a style="color:#DAA520;text-decoration:underline;" href="' + CONFIG.UNSUBSCRIBE_URL + '">Unsubscribe</a> &nbsp;·&nbsp; ' +
    '<a style="color:#DAA520;text-decoration:underline;" href="' + CONFIG.PREFERENCES_URL + '">Manage Preferences</a>' +
    '</div>' +
    '<div style="font-size:11px;color:rgba(255,255,255,0.2);font-family:\'Montserrat\',monospace;margin-top:12px;">' + dateStr + ' · Weekly Intelligence Rollup</div>' +
    '</div>' +
    '</body></html>';
}

// ════════════════════════════════════════════════════════════════════════
// CSS — SCOUT INTERNAL
// ════════════════════════════════════════════════════════════════════════

// @agent-target: getScoutCSS
function getScoutCSS() {
  return [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{background:#FDFDF7;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1a1a1a;line-height:1.6;-webkit-font-smoothing:antialiased}',
    'a{color:inherit;text-decoration:none}',
    '.page{max-width:680px;margin:0 auto;background:#FDFDF7}',
    '.share-bar{background:#25D366;padding:0}',
    '.share-inner{max-width:680px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
    '.share-label{font-size:12px;font-weight:700;color:#fff;white-space:nowrap}',
    '.share-url{font-size:11px;color:rgba(255,255,255,0.85);font-family:"JetBrains Mono",monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;padding:4px 8px;background:rgba(0,0,0,0.12);border-radius:4px;min-width:0}',
    '.share-url:hover{background:rgba(0,0,0,0.2)}',
    '.share-copied{font-size:11px;color:#fff;font-weight:700;opacity:0;transition:opacity 0.3s;white-space:nowrap}',
    '.share-btn{background:#fff;color:#25D366;font-size:12px;font-weight:700;padding:6px 14px;border-radius:20px;white-space:nowrap;text-decoration:none;flex-shrink:0}',
    '.masthead{background:#1A3E5C;padding:0;position:relative;overflow:hidden}',
    '.masthead::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 70% 40%,rgba(218,165,32,0.10) 0%,transparent 60%);pointer-events:none}',
    '.masthead-inner{padding:44px 40px 36px;position:relative}',
    '.mast-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}',
    '.mast-issue{font-size:11px;font-weight:700;color:rgba(255,255,255,0.25);letter-spacing:0.1em;font-family:"JetBrains Mono",monospace}',
    '.mast-date{font-size:11px;font-weight:600;letter-spacing:0.08em;color:#DAA520;text-transform:uppercase}',
    '.mast-wordmark{font-size:48px;font-weight:900;letter-spacing:-0.01em;line-height:1;color:#fff;font-family:"Playfair Display","Georgia",serif}',
    '.mast-sub{font-size:13px;font-weight:600;letter-spacing:0.18em;color:rgba(255,255,255,0.55);text-transform:uppercase;margin-top:4px}',
    '.mast-tagline{font-size:11px;color:#DAA520;margin-top:6px;letter-spacing:0.06em;text-transform:uppercase;font-style:italic}',
    '.mast-stats{display:flex;gap:32px;margin-top:32px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.07)}',
    '.mast-stat{display:flex;align-items:baseline;gap:8px}',
    '.mast-stat-n{font-size:28px;font-weight:900;color:#fff;font-family:"JetBrains Mono",monospace;line-height:1}',
    '.mast-stat-l{font-size:11px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.06em}',
    '.mast-sod{margin:28px 40px 0;padding:20px 24px;background:rgba(255,255,255,0.05);border-left:3px solid #DAA520;border-radius:0 8px 8px 0}',
    '.mast-sod-label{font-size:9px;font-weight:700;letter-spacing:0.14em;color:#DAA520;text-transform:uppercase;margin-bottom:8px}',
    '.mast-sod-text{font-size:16px;font-weight:700;color:#fff;line-height:1.45}',
    '.mast-big-story{margin:16px 40px 0;padding:20px 24px;background:rgba(255,255,255,0.03);border-left:3px solid rgba(255,255,255,0.2);border-radius:0 8px 8px 0}',
    '.mast-big-story-label{font-size:9px;font-weight:700;letter-spacing:0.14em;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:8px}',
    '.mast-big-story-text{font-size:13px;color:rgba(255,255,255,0.7);line-height:1.6}',
    '.sig-ctx{font-size:11px;color:#7C848C;line-height:1.5;margin-bottom:8px;padding-left:12px;font-style:italic}',
    '.sig-ctx strong{color:#DAA520;font-style:normal;font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-right:4px}',
    '.mast-themes{display:flex;flex-wrap:wrap;gap:6px;padding:16px 40px 0}',
    '.mast-theme{background:transparent;border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:4px 12px;font-size:11px;color:rgba(255,255,255,0.45);font-weight:500}',
    '.mast-bottom{height:4px;background:linear-gradient(90deg,#DAA520,#C9981A,#DAA520)}',
    '.fitness{background:#fff;border-bottom:1px solid #e8e8e2;padding:18px 36px}',
    '.fitness-label{font-size:9px;font-weight:700;letter-spacing:0.12em;color:#f59e0b;text-transform:uppercase;margin-bottom:8px}',
    '.fitness-text{font-size:13px;color:#555;line-height:1.8}',
    '.section{background:#fff;border-bottom:1px solid #e8e8e2;padding:32px 40px}',
    '.section:last-child{border-bottom:none}',
    '.sec-hdr{display:flex;align-items:center;gap:12px;margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid #f5f5f0}',
    '.sec-num{font-size:10px;font-weight:700;color:#ccc;letter-spacing:0.1em;font-family:"JetBrains Mono",monospace}',
    '.sec-title{font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#1a1a1a}',
    '.sec-accent{width:24px;height:3px;border-radius:2px;flex-shrink:0}',
    '.sec-count{font-size:11px;color:#bbb;margin-left:auto;font-family:"JetBrains Mono",monospace}',
    '.brief-section{background:#FAFAF3;border-bottom:2px solid #DAA520}',
    '.watch-bar{margin-top:14px;padding:11px 14px;background:#fffbf0;border-left:3px solid #f59e0b;border-radius:0 6px 6px 0}',
    '.watch-bar-label{font-size:9px;font-weight:700;color:#d97706;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:3px}',
    '.watch-bar-text{font-size:12px;color:#777;line-height:1.6}',
    '.toc-section{background:#fff;padding:14px 40px;border-bottom:2px solid #f0f0ea;display:flex;align-items:center;flex-wrap:wrap}',
    '.toc-item{display:inline-flex;align-items:center;gap:5px;padding:4px 14px;font-size:11px;font-weight:600;color:#999;white-space:nowrap;border-right:1px solid #e8e8e2;transition:color 0.12s}',
    '.toc-item:first-child{padding-left:0}',
    '.toc-item:last-child{border-right:none}',
    '.toc-item:hover{color:#1a1a1a}',
    '.toc-n{font-size:10px;font-weight:700;color:#ccc;font-family:"JetBrains Mono",monospace}',
    '.cat-divider{display:flex;align-items:center;gap:10px;margin:24px 0 14px}',
    '.cat-divider:first-child{margin-top:0}',
    '.cat-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}',
    '.cat-name{font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase}',
    '.cat-line{flex:1;height:1px;background:#f0f0ea}',
    '.sig{background:#fff;border:1px solid #e8e8e2;border-radius:8px;margin-bottom:8px;overflow:hidden;transition:box-shadow 0.15s,border-color 0.15s}',
    '.sig:hover{box-shadow:0 2px 12px rgba(0,0,0,0.06);border-color:#d0d0ca}',
    '.sig:last-child{margin-bottom:0}',
    '.sig.pri{border-left:3px solid #DAA520}',
    '.sig.trd{border-left:3px solid #10b981}',
    '.sig-top{padding:12px 14px 10px;display:flex;flex-wrap:wrap;gap:5px;align-items:center;border-bottom:1px solid #f5f5f0;background:#FAFAF3}',
    '.sig-bottom{padding:14px 16px}',
    '.badge{font-size:9px;font-weight:700;padding:3px 7px;border-radius:3px;letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap}',
    '.b-pri{background:#F5F0E8;color:#1A3E5C;border:1px solid #E8D9A0}',
    '.b-trd{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}',
    '.b-opp{background:#fffbeb;color:#b45309;border:1px solid #fde68a}',
    '.b-gap{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}',
    '.b-cat{background:#FDFDF7;color:#888;border:1px solid #e0e0da}',
    '.b-aud{background:#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe}',
    '.sig-num{margin-left:auto;font-size:10px;color:#ccc;font-family:"JetBrains Mono",monospace;font-weight:600}',
    '.sig-stat{font-size:30px;font-weight:900;color:#1a1a1a;line-height:1;margin-bottom:4px;letter-spacing:-0.02em;font-family:"JetBrains Mono",monospace}',
    '.sig-stat-label{font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px}',
    '.sig-h{font-size:15px;font-weight:700;color:#1a1a1a;line-height:1.35;margin-bottom:10px}',
    '.sig-i{font-size:13px;color:#555;line-height:1.6;margin-bottom:6px;padding-left:12px;border-left:2px solid #e8e8e2}',
    '.sig-src{font-size:11px;padding-left:12px;margin-bottom:10px}',
    '.sig-src a{color:#DAA520;font-weight:600;text-decoration:none;border-bottom:1px solid rgba(218,165,32,0.3)}',
    '.sig-w{font-size:13px;color:#166534;line-height:1.55;padding:10px 12px;background:#f0fdf4;border-radius:6px;border-left:2px solid #16a34a}',
    '.sig-w strong{color:#15803d;font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-right:6px}',
    '.sig-compact{font-size:12px;color:#888;line-height:1.5;padding-top:8px;border-top:1px solid #f0f0ea;margin-top:6px}',
    '.editorial{background:#F5F0E8;border-left:3px solid #DAA520;padding:12px 18px;margin-bottom:0;border-radius:0 0 6px 6px;font-size:14px;color:#1A3E5C;line-height:1.6;font-style:italic}',
    '.editorial strong{font-style:normal;color:#DAA520;font-weight:700}',
    '.theme{margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid #f0f0ea}',
    '.theme:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}',
    '.theme-title{font-size:17px;font-weight:800;color:#1a1a1a;line-height:1.3;margin-bottom:5px}',
    '.theme-sigs{font-size:10px;color:#bbb;font-family:"JetBrains Mono",monospace;font-weight:600;margin-bottom:16px;letter-spacing:0.04em}',
    '.theme-block{margin-bottom:12px}',
    '.theme-geo{font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;padding:2px 8px;border-radius:3px;display:inline-block}',
    '.geo-sa{background:#f0fdf4;color:#16a34a}',
    '.geo-me{background:#F5F0E8;color:#1A3E5C}',
    '.geo-gl{background:#fffbeb;color:#b45309}',
    '.theme-txt{font-size:13px;color:#444;line-height:1.7}',
    '.theme-txt-sm{font-size:12px;color:#777;line-height:1.6}',
    '.theme-do{margin-top:12px;padding:11px 14px;background:#F5F0E8;border-left:2px solid #DAA520;border-radius:0 6px 6px 0;font-size:13px;font-weight:600;color:#1A3E5C}',
    '.theme-do::before{content:"→ "}',
    '.viral-grid{display:grid;gap:8px}',
    '.viral-card{background:#1A3E5C;border-radius:8px;padding:18px 20px;position:relative;overflow:hidden}',
    '.viral-card::before{content:"🔥";position:absolute;top:14px;right:16px;font-size:18px;opacity:0.2}',
    '.viral-hook{font-size:15px;font-weight:700;color:#fff;line-height:1.4;margin-bottom:7px;padding-right:36px}',
    '.viral-why{font-size:12px;color:rgba(255,255,255,0.45);line-height:1.6}',
    '.startup{background:#fff;border:1px solid #e8e8e2;border-radius:8px;margin-bottom:10px;overflow:hidden}',
    '.startup:last-child{margin-bottom:0}',
    '.startup-hdr{padding:16px 20px 12px;border-bottom:1px solid #f0f0ea;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;background:#FAFAF3}',
    '.startup-name{font-size:17px;font-weight:800;color:#1a1a1a}',
    '.startup-sigs{font-size:10px;color:#bbb;font-family:"JetBrains Mono",monospace;margin-top:2px}',
    '.startup-gcc-badge{background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a;font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0}',
    '.startup-body{padding:16px 20px}',
    '.startup-row{display:flex;gap:14px;margin-bottom:10px;align-items:flex-start}',
    '.startup-row:last-child{margin-bottom:0}',
    '.startup-lbl{font-size:9px;font-weight:700;color:#bbb;letter-spacing:0.1em;text-transform:uppercase;min-width:68px;padding-top:2px;font-family:"JetBrains Mono",monospace}',
    '.startup-val{font-size:13px;color:#333;line-height:1.55;flex:1}',
    '.startup-now{background:#fffbeb;border-left:2px solid #f59e0b;padding:9px 12px;border-radius:0 6px 6px 0;margin-top:4px}',
    '.startup-gcc{background:#f0fdf4;border-left:2px solid #16a34a;padding:9px 12px;border-radius:0 6px 6px 0;font-size:12px;color:#166534;font-weight:600;margin-top:6px}',
    '.watch-card{background:#fff;border:1px solid #e8e8e2;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:8px}',
    '.watch-card:last-child{margin-bottom:0}',
    '.watch-sig{font-size:13px;font-weight:600;color:#1a1a1a;margin-bottom:4px}',
    '.watch-why{font-size:12px;color:#777;line-height:1.55}',
    '.question-section{background:#1A3E5C}',
    '.question-section .sec-hdr{border-bottom-color:rgba(255,255,255,0.08)}',
    '.question-section .sec-num{color:rgba(255,255,255,0.2)}',
    '.question-section .sec-title{color:#fff}',
    '.qbox{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:24px}',
    '.q-text{font-size:20px;font-weight:800;color:#fff;line-height:1.4;margin-bottom:10px}',
    '.q-ctx{font-size:13px;color:rgba(255,255,255,0.45);line-height:1.65}',
    '.inspo-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.inspo-card{background:#FAFAF3;border:1px solid #e8e8e2;border-radius:8px;padding:18px;position:relative;overflow:hidden}',
    '.inspo-card::before{content:"✦";position:absolute;top:12px;right:14px;font-size:14px;color:#ddd}',
    '.inspo-item{font-size:14px;font-weight:600;color:#1a1a1a;line-height:1.45;margin-bottom:7px;padding-right:22px}',
    '.inspo-riff{font-size:12px;color:#888;line-height:1.6;font-style:italic}',
    '.footer{background:#1A3E5C;padding:40px;text-align:center}',
    '.footer-logo{font-size:22px;font-weight:900;color:#fff;letter-spacing:0.02em;margin-bottom:2px;font-family:"Playfair Display","Georgia",serif}',
    '.footer-sub{font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);letter-spacing:0.18em;text-transform:uppercase;margin-bottom:4px}',
    '.footer-tagline{font-size:11px;color:#DAA520;letter-spacing:0.04em;font-style:italic;margin-bottom:20px}',
    '.footer-closer{font-size:15px;font-weight:600;color:rgba(255,255,255,0.75);max-width:460px;margin:0 auto 8px;line-height:1.5}',
    '.footer-compliance{font-size:11px;color:rgba(255,255,255,0.35);line-height:1.8;margin-top:16px}',
    '.footer-compliance a{color:#DAA520;text-decoration:underline;text-underline-offset:2px}',
    '.footer-meta{font-size:11px;color:rgba(255,255,255,0.2);font-family:"JetBrains Mono",monospace;margin-top:16px;padding-top:16px;border-top:1px solid rgba(218,165,32,0.2)}',
    '@media(max-width:640px){',
    '.masthead-inner,.section,.fitness,.footer{padding-left:20px;padding-right:20px}',
    '.mast-sod,.mast-themes{margin-left:20px;margin-right:20px}',
    '.mast-wordmark{font-size:36px}',
    '.toc-section{padding:10px 20px}',
    '.toc-item{padding:4px 8px;font-size:10px}',
    '.inspo-grid{grid-template-columns:1fr}',
    '.startup-row{flex-direction:column;gap:4px}',
    '.startup-lbl{min-width:unset}',
    '.mast-stats{flex-wrap:wrap}',
    '}',
  ].join('\n');
}


