// ╔══════════════════════════════════════════════════════════════════════╗
// ║  RENDER.gs — HTML section renderers · SVG visual builders
// ║  THE GAHWA · STARTUP SCOUT OS v5
// ╚══════════════════════════════════════════════════════════════════════╝

// ════════════════════════════════════════════════════════════════════════
// SCOUT INTERNAL — SECTION RENDERERS
// ════════════════════════════════════════════════════════════════════════

// @agent-target: renderShareBar
function renderShareBar(shareUrl, sod) {
  if (!shareUrl) return '';
  var preview = sod ? sod.substring(0, 80) + (sod.length > 80 ? '...' : '') : 'Read today\'s Startup Scout';
  return '<div class="share-bar">\n' +
    '<div class="share-inner">\n' +
    '<div class="share-label">📲 Share on WhatsApp</div>\n' +
    '<div class="share-url" onclick="navigator.clipboard.writeText(\'' + shareUrl + '\').then(function(){var el=document.getElementById(\'share-copied\');el.style.opacity=1;setTimeout(function(){el.style.opacity=0},2000)})" title="Click to copy">' + shareUrl + '</div>\n' +
    '<div id="share-copied" class="share-copied">✅ Copied!</div>\n' +
    '<a class="share-btn" href="https://wa.me/?text=' + encodeURIComponent('📡 ' + preview + ' ' + shareUrl) + '" target="_blank">Share via WhatsApp</a>\n' +
    '</div>\n</div>\n';
}

// @agent-target: renderMasthead
function renderMasthead(dateStr, nlCount, sigCount, brief, streakTxt, cost, runMin) {
  var themes   = brief.themes ? brief.themes.split('·').map(function(t) {
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

// @agent-target: renderFitness
function renderFitness(fit) {
  if (!fit || fit.trim().length < 5) return '';
  return '<div class="fitness">\n' +
    '<div class="fitness-label">TODAY\'S MARCHING ORDERS</div>\n' +
    '<div class="fitness-text">' + h(fit).replace(/\n/g, '<br>').replace(/\r/g, '<br>').replace(/---/g, '<span style="color:#374151">—</span>') + '</div>\n' +
    '</div>\n';
}

// @agent-target: renderBrief
function renderBrief(brief) {
  return '<div class="section brief-section">\n' +
    '<div class="sec-hdr"><span class="sec-num">00</span><span class="sec-title">Executive Brief</span></div>\n' +
    (brief.watch ?
      '<div class="watch-bar"><div class="watch-bar-label">WATCHING</div><div class="watch-bar-text">' + stripScores(h(brief.watch)) + '</div></div>\n'
      : '') +
    '</div>\n';
}

// @agent-target: renderTOC
function renderTOC() {
  var items = [
    ['01', 'Signals',     '#signals'],
    ['02', 'Themes',      '#themes'],
    ['03', 'Viral',       '#viral'],
    ['04', 'Startups',    '#startup'],
    ['05', 'Watch',       '#watch'],
    ['06', 'Question',    '#question'],
    ['07', 'Inspiration', '#inspiration'],
  ];
  return '<div class="toc-section">\n' +
    items.map(function(it) {
      return '<a href="' + it[2] + '" class="toc-item"><span class="toc-n">' + it[0] + '</span>&nbsp;<span class="toc-label">' + it[1] + '</span></a>';
    }).join('') +
    '\n</div>\n';
}

// @agent-target: renderSignals
function renderSignals(signals, voice) {
  if (!signals || !signals.length) return '';

  var CAT_COLORS = {
    'AI & TECH':          { dot: '#DAA520', name: '#DAA520' },
    'GCC & SAUDI':        { dot: '#34d399', name: '#34d399' },
    'FINTECH & CRYPTO':   { dot: '#fbbf24', name: '#fbbf24' },
    'MACRO & GEO':        { dot: '#f87171', name: '#f87171' },
    'MEDIA & MARKETING':  { dot: '#60a5fa', name: '#60a5fa' },
    'PEOPLE':             { dot: '#c084fc', name: '#c084fc' },
    'PRODUCT':            { dot: '#fb923c', name: '#fb923c' },
    'CULTURE':            { dot: '#94a3b8', name: '#94a3b8' },
  };
  var DEFAULT = { dot: '#4b5563', name: '#4b5563' };

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

    html += '<div class="' + cardClass + '" id="s' + (idx + 1) + '">\n';
    html += '<div class="sig-top">\n';
    if (isPri) html += '<span class="badge b-pri">PRIORITY</span>\n';
    if (isTrd) html += '<span class="badge b-trd">TREND' + (s.src > 1 ? ' x' + s.src : '') + '</span>\n';
    if (s.type) html += '<span class="badge ' + typeBadge + '">' + h(s.type) + '</span>\n';
    if (s.aud)  html += '<span class="badge b-aud">' + h(s.aud) + '</span>\n';
    html += '<span class="sig-num">#' + (idx + 1) + '</span>\n';
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
        html += '<div class="sig-ctx"><strong>REMEMBER</strong> ' + h(s.ctx.replace(/^REMEMBER:\s*/i, '')) + '</div>\n';
      }
      if (s.url && s.url.length > 5 && s.url !== 'N/A') {
        html += '<div class="sig-src">📎 <a href="' + h(s.url) + '" target="_blank" rel="noopener">Read source</a></div>\n';
      }
      html += '<div class="sig-w"><strong>→</strong> ' + h(s.whynow) + '</div>\n';
    } else {
      html += '<div class="sig-compact">' + h(s.whynow) + '</div>\n';
      if (s.url && s.url.length > 5 && s.url !== 'N/A') {
        html += '<div class="sig-src">📎 <a href="' + h(s.url) + '" target="_blank" rel="noopener">Read source</a></div>\n';
      }
    }
    html += '</div>\n</div>\n';
  });

  html += '</div>\n';
  return html;
}

// @agent-target: renderThemes
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
    if (saudi)  html += '<div class="theme-block"><div class="theme-geo geo-sa">🇸🇦 Saudi / GCC</div><div class="theme-txt">' + h(saudi) + '</div></div>\n';
    if (mena)   html += '<div class="theme-block"><div class="theme-geo geo-me">🌍 MENA</div><div class="theme-txt theme-txt-sm">' + h(mena) + '</div></div>\n';
    if (global) html += '<div class="theme-block"><div class="theme-geo geo-gl">🌐 Global</div><div class="theme-txt theme-txt-sm">' + h(global) + '</div></div>\n';
    if (action) html += '<div class="theme-do">' + h(action) + '</div>\n';
    html += '</div>\n';
  });
  html += '</div>\n';
  return html;
}

// @agent-target: renderViral
function renderViral(text) {
  if (!text) return '';
  var html  = '<div class="section" id="viral">\n<div class="sec-hdr"><span class="sec-num">03</span><div class="sec-accent" style="background:#ec4899"></div><span class="sec-title">Viral Signals</span></div>\n<div class="viral-grid">\n';
  text.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var hookIdx = line.indexOf('HOOK:');
    var whyIdx  = line.indexOf('| WHY:');
    if (hookIdx === -1) return;
    var hook = whyIdx !== -1 ? line.substring(hookIdx + 5, whyIdx).trim() : line.substring(hookIdx + 5).trim();
    var why  = whyIdx !== -1 ? line.substring(whyIdx + 6).trim() : '';
    html += '<div class="viral-card"><div class="viral-hook">' + h(hook) + '</div>';
    if (why) html += '<div class="viral-why">' + h(why) + '</div>';
    html += '</div>\n';
  });
  html += '</div>\n</div>\n';
  return html;
}

// @agent-target: renderStartup
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
    if (gcc) html += '<div class="startup-gcc-badge">🇸🇦 GCC First</div>';
    html += '</div>\n<div class="startup-body">\n';
    if (prob) html += srow('Problem',  prob);
    if (sol)  html += srow('Solution', sol);
    if (cus)  html += srow('Customer', cus);
    if (mod)  html += srow('Model',    mod);
    if (now)  html += '<div class="startup-row"><span class="startup-lbl">Why Now</span><div class="startup-val"><div class="startup-now">' + h(now) + '</div></div></div>\n';
    if (gcc)  html += '<div class="startup-gcc">🇸🇦 ' + h(gcc) + '</div>\n';
    html += '</div>\n</div>\n';
  });
  html += '</div>\n';
  return html;
}

// @agent-target: renderWatch
function renderWatch(text) {
  if (!text) return '';
  var html = '<div class="section" id="watch">\n<div class="sec-hdr"><span class="sec-num">05</span><div class="sec-accent" style="background:#f59e0b"></div><span class="sec-title">Watch List</span><span class="sec-count">Near-threshold signals</span></div>\n';
  var sig = '', why = '';
  function flush() {
    if (!sig) return;
    html += '<div class="watch-card"><div class="watch-sig">' + h(sig) + '</div>';
    if (why) html += '<div class="watch-why">' + h(why) + '</div>';
    html += '</div>\n';
    sig = ''; why = '';
  }
  text.split('\n').forEach(function(line) {
    line = line.trim();
    if (line.startsWith('SIG:'))  { flush(); sig = line.substring(4).trim(); }
    else if (line.startsWith('WHY:')) why = line.substring(4).trim();
  });
  flush();
  html += '</div>\n';
  return html;
}

// @agent-target: renderInspiration
function renderInspiration(text) {
  if (!text) return '';
  var html = '<div class="section" id="inspiration">\n' +
    '<div class="sec-hdr"><span class="sec-num">07</span>' +
    '<span class="sec-title">Inspiration</span>' +
    '<span class="sec-count">decompress</span></div>\n' +
    '<div class="inspo-grid">\n';
  text.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var itemIdx = line.indexOf('ITEM:');
    var riffIdx = line.indexOf('| RIFF:');
    if (itemIdx === -1) return;
    var item = riffIdx !== -1 ? line.substring(itemIdx + 5, riffIdx).trim() : line.substring(itemIdx + 5).trim();
    var riff = riffIdx !== -1 ? line.substring(riffIdx + 7).trim() : '';
    html += '<div class="inspo-card">';
    html += '<div class="inspo-item">' + h(item) + '</div>';
    if (riff) html += '<div class="inspo-riff">' + h(riff) + '</div>';
    html += '</div>\n';
  });
  html += '</div>\n</div>\n';
  return html;
}

// @agent-target: renderQuestion
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

// @agent-target: renderFooter
function renderFooter(dateStr, nlCount, cost, runMin, closer) {
  return '<div class="footer">\n' +
    '<div class="footer-logo">THE GAHWA</div>\n' +
    '<div class="footer-sub">THE GULF BRIEF</div>\n' +
    '<div class="footer-tagline">A Premium Daily Brew of Gulf Insight</div>\n' +
    (closer ?
      '<div class="footer-closer">' + h(closer) + '</div>\n' :
      '<div class="footer-closer">See you tomorrow — same time, same Gulf, different signals.</div>\n') +
    '<div class="footer-compliance">\n' +
    h(CONFIG.MAILING_ADDRESS) + '<br>\n' +
    '<a href="' + CONFIG.UNSUBSCRIBE_URL + '">Unsubscribe</a> &nbsp;·&nbsp;\n' +
    '<a href="' + CONFIG.PREFERENCES_URL + '">Manage Preferences</a> &nbsp;·&nbsp;\n' +
    '<a href="' + CONFIG.BEEHIIV_URL + '">gahwa.beehiiv.com</a>\n' +
    '</div>\n' +
    '<div class="footer-meta">' + h(dateStr) + ' · ' + nlCount + ' newsletters · The Gahwa Scout OS v5</div>\n' +
    '</div>\n';
}

// @agent-target: srow
function srow(label, val) {
  return '<div class="startup-row"><span class="startup-lbl">' + label + '</span><span class="startup-val">' + h(val) + '</span></div>\n';
}

// ════════════════════════════════════════════════════════════════════════
// SVG VISUAL BUILDERS
// ════════════════════════════════════════════════════════════════════════

// @agent-target: buildChartSVG
function buildChartSVG(chartBlock) {
  if (!chartBlock || chartBlock.trim().length < 10) return '';
  if (chartBlock.trim() === '[SKIP]' || chartBlock.indexOf('SKIP') === 0) return '';

  var chartTitle   = getField(chartBlock, 'CHART_TITLE');
  var chartInsight = getField(chartBlock, 'CHART_INSIGHT');
  var highlight    = (getField(chartBlock, 'HIGHLIGHT') || '').trim().toLowerCase();

  var items = [];
  chartBlock.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    if (/^(CHART_TITLE|CHART_INSIGHT|HIGHLIGHT|TONE_NOTE):/i.test(line)) return;
    var li = line.indexOf('LABEL:');
    var vi = line.indexOf('| VALUE:');
    var ui = line.indexOf('| UNIT:');
    var di = line.indexOf('| DELTA:');
    if (li === -1 || vi === -1) return;
    var label  = line.substring(li + 6, vi).trim();
    var valStr = ui !== -1 ? line.substring(vi + 8, ui).trim() : (di !== -1 ? line.substring(vi + 8, di).trim() : line.substring(vi + 8).trim());
    var unit   = ui !== -1 ? (di !== -1 ? line.substring(ui + 7, di).trim() : line.substring(ui + 7).trim()) : '';
    var delta  = di !== -1 ? line.substring(di + 8).trim() : '';
    var val    = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
    if (isNaN(val) || !label) return;
    items.push({ label: label, val: val, unit: unit, delta: delta, hero: highlight && label.toLowerCase() === highlight });
  });

  if (items.length === 0) return '';
  var maxVal = Math.max.apply(null, items.map(function(i) { return Math.abs(i.val); }));
  if (maxVal === 0) return '';

  var BAR_W = 480, BAR_H = 30, GAP = 16, PAD_LEFT = 130, PAD_TOP = 8, PAD_BOT = 8, DELTA_SPACE = 90;
  var svgH = PAD_TOP + items.length * (BAR_H + GAP) - GAP + PAD_BOT;
  var svgW = PAD_LEFT + BAR_W + DELTA_SPACE;

  var bars = '';
  items.forEach(function(item, i) {
    var y       = PAD_TOP + i * (BAR_H + GAP);
    var bw      = Math.max(4, Math.round((Math.abs(item.val) / maxVal) * BAR_W));
    var fill    = item.hero ? '#DAA520' : '#1A3E5C';
    var txtFill = item.hero ? '#7A5B10' : '#1A3E5C';
    var isPos   = item.delta.charAt(0) === '+';
    var isNeg   = item.delta.charAt(0) === '-';
    var deltaBg = isPos ? '#16a34a' : (isNeg ? '#dc2626' : '#6b7280');
    var dEmoji  = isPos ? '▲' : (isNeg ? '▼' : '');

    if (item.hero) {
      bars += '<rect x="0" y="' + (y - 3) + '" width="' + svgW + '" height="' + (BAR_H + 6) + '" rx="4" fill="rgba(218,165,32,0.06)"/>';
    }
    bars += '<text x="' + (PAD_LEFT - 10) + '" y="' + (y + BAR_H / 2 + 4) + '" font-family="Montserrat,sans-serif" font-size="' + (item.hero ? '11' : '10') + '" font-weight="' + (item.hero ? '700' : '600') + '" fill="' + (item.hero ? '#DAA520' : '#7C848C') + '" text-anchor="end">' + h(item.label) + '</text>';
    bars += '<rect x="' + PAD_LEFT + '" y="' + y + '" width="' + bw + '" height="' + BAR_H + '" rx="4" fill="' + fill + '"/>';
    bars += '<text x="' + (PAD_LEFT + bw + 8) + '" y="' + (y + BAR_H / 2 + 5) + '" font-family="Montserrat,sans-serif" font-size="12" font-weight="700" fill="' + txtFill + '">' + h(item.val + (item.unit ? ' ' + item.unit : '')) + '</text>';

    if (item.delta && item.delta.trim() && item.delta !== '[leave blank]' && item.delta !== 'blank') {
      var pillX = svgW - DELTA_SPACE + 4;
      var pillY = y + BAR_H / 2 - 9;
      var pillTxt = (dEmoji ? dEmoji + ' ' : '') + item.delta;
      bars += '<rect x="' + pillX + '" y="' + pillY + '" width="' + (DELTA_SPACE - 8) + '" height="18" rx="9" fill="' + deltaBg + '"/>';
      bars += '<text x="' + (pillX + (DELTA_SPACE - 8) / 2) + '" y="' + (pillY + 12) + '" font-family="Montserrat,sans-serif" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">' + h(pillTxt) + '</text>';
    }
  });

  var titleHtml   = chartTitle ? '<div style="font-family:Montserrat,sans-serif;font-size:14px;font-weight:800;color:#163550;line-height:1.35;margin-bottom:4px;">' + h(chartTitle) + '</div>' : '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#7C848C;margin-bottom:10px;">Today\'s numbers</div>';
  var insightHtml = chartInsight ? '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:#7C848C;line-height:1.55;margin-top:10px;padding-top:10px;border-top:1px solid #E8E2D5;font-style:italic;">' + h(chartInsight) + '</div>' : '';
  var legendHtml  = items.some(function(i) { return i.hero; }) ? '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:600;color:#AE7C3F;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px;">★ Story bar highlighted</div>' : '';

  return '<div style="margin:0 0 20px;padding:18px 20px 14px;background:#FFFFFF;border-radius:8px;border:1px solid rgba(174,124,63,0.3);border-left:6px solid #163550;">' +
    titleHtml + legendHtml +
    '<svg width="100%" viewBox="0 0 ' + svgW + ' ' + svgH + '" style="display:block;overflow:visible;">' + bars + '</svg>' +
    insightHtml + '</div>';
}

// @agent-target: buildStatCardSVG
function buildStatCardSVG(statBlock) {
  if (!statBlock || statBlock.trim().length < 5) return '';
  if (statBlock.trim() === '[SKIP]' || statBlock.indexOf('SKIP') === 0) return '';

  var num     = getField(statBlock, 'NUM');
  var label   = getField(statBlock, 'LABEL');
  var context = getField(statBlock, 'CONTEXT');
  var delta   = getField(statBlock, 'DELTA');
  if (!num || !label) return '';

  var ctxSentences = context ? context.replace(/([.!?])\s+/g, '$1\n').split('\n').filter(function(s) { return s.trim().length > 3; }) : [];
  var ctx1 = ctxSentences[0] || '';
  var ctx2 = ctxSentences[1] || '';

  var deltaHtml = '';
  if (delta && delta.trim() && delta.trim() !== '[leave blank]' && delta.trim() !== 'blank') {
    var isPos = delta.charAt(0) === '+';
    var isNeg = delta.charAt(0) === '-';
    deltaHtml = '<div style="position:absolute;top:16px;right:16px;background:' + (isPos ? '#16a34a' : (isNeg ? '#dc2626' : '#7C848C')) + ';color:#fff;font-family:Montserrat,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.06em;padding:4px 10px;border-radius:20px;white-space:nowrap;">' + (isPos ? '▲' : (isNeg ? '▼' : '→')) + ' ' + h(delta) + '</div>';
  }

  return '<div style="margin:0 0 20px;padding:22px 24px;background:#163550;border-radius:8px;border-top:3px solid #AE7C3F;position:relative;overflow:hidden;">' +
    '<div style="position:absolute;top:-40px;left:-40px;width:180px;height:180px;background:radial-gradient(circle,rgba(174,124,63,0.12) 0%,transparent 70%);pointer-events:none;"></div>' +
    deltaHtml +
    '<div style="display:flex;align-items:flex-start;gap:24px;">' +
      '<div style="flex-shrink:0;min-width:0;"><div style="font-family:Montserrat,sans-serif;font-size:44px;font-weight:900;color:#AE7C3F;line-height:1;letter-spacing:-0.02em;">' + h(num) + '</div></div>' +
      '<div style="flex:1;min-width:0;padding-top:4px;">' +
        '<div style="font-family:Montserrat,sans-serif;font-size:13px;font-weight:700;color:#fff;line-height:1.35;margin-bottom:10px;font-style:italic;">' + h(label) + '</div>' +
        (ctx1 ? '<div style="font-family:Work Sans,sans-serif;font-size:13px;color:rgba(255,255,255,0.8);line-height:1.6;margin-bottom:0;">' + h(ctx1) + '</div>' : '') +
        (ctx2 ? '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:rgba(174,124,63,0.85);line-height:1.6;margin-top:6px;padding-left:10px;border-left:2px solid rgba(174,124,63,0.4);">' + h(ctx2) + '</div>' : '') +
      '</div>' +
    '</div>' +
  '</div>';
}

// @agent-target: buildInfographicSVG
function buildInfographicSVG(infoBlock) {
  if (!infoBlock || infoBlock.trim().length < 10) return '';
  if (infoBlock.trim() === '[SKIP]' || infoBlock.indexOf('SKIP') === 0) return '';

  var infoTitle   = getField(infoBlock, 'INFOGRAPHIC_TITLE');
  var infoFraming = getField(infoBlock, 'INFOGRAPHIC_FRAMING');
  var connector   = getField(infoBlock, 'CONNECTOR') || '→';

  var items = [];
  infoBlock.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    if (/^(INFOGRAPHIC_TITLE|INFOGRAPHIC_FRAMING|CONNECTOR|TONE_NOTE):/i.test(line)) return;
    var ii = line.indexOf('ITEM:');
    var si = line.indexOf('| STAT:');
    var ni = line.indexOf('| NOTE:');
    if (ii === -1 || si === -1) return;
    var item = line.substring(ii + 5, si).trim();
    var stat = ni !== -1 ? line.substring(si + 7, ni).trim() : line.substring(si + 7).trim();
    var note = ni !== -1 ? line.substring(ni + 7).trim() : '';
    if (item && stat) items.push({ item: item, stat: stat, note: note });
  });

  if (items.length === 0) return '';
  items = items.slice(0, 3);

  var connectorDisplay = h(connector);
  var panelCells = [];
  items.forEach(function(item, i) {
    panelCells.push(
      '<td style="width:' + Math.floor(82 / items.length) + '%;padding:0 10px;vertical-align:top;">' +
        '<div style="font-family:Montserrat,sans-serif;font-size:26px;font-weight:900;color:#163550;line-height:1;margin-bottom:6px;letter-spacing:-0.02em;">' + h(item.stat) + '</div>' +
        '<div style="font-family:Montserrat,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#AE7C3F;margin-bottom:8px;">' + h(item.item) + '</div>' +
        (item.note ? '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:#7C848C;line-height:1.5;font-style:italic;">' + h(item.note) + '</div>' : '') +
      '</td>'
    );
    if (i < items.length - 1) {
      panelCells.push(
        '<td style="width:' + Math.floor(18 / (items.length - 1)) + '%;text-align:center;vertical-align:middle;padding:0 4px;">' +
          '<div style="font-family:Montserrat,sans-serif;font-size:16px;font-weight:900;color:#AE7C3F;line-height:1;">' + connectorDisplay + '</div>' +
        '</td>'
      );
    }
  });

  var titleHtml   = infoTitle ? '<div style="font-family:Montserrat,sans-serif;font-size:14px;font-weight:800;color:#163550;line-height:1.35;margin-bottom:' + (infoFraming ? '4px' : '14px') + ';">' + h(infoTitle) + '</div>' : '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#7C848C;margin-bottom:14px;">By the numbers</div>';
  var framingHtml = infoFraming ? '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:#7C848C;line-height:1.5;margin-bottom:16px;font-style:italic;">' + h(infoFraming) + '</div>' : '<div style="margin-bottom:14px;"></div>';

  return '<div style="margin:0 0 20px;padding:18px 20px;background:#FFFFFF;border:1px solid rgba(174,124,63,0.3);border-radius:8px;">' +
    titleHtml + framingHtml +
    '<div style="height:2px;background:linear-gradient(90deg,#AE7C3F,rgba(174,124,63,0.1));border-radius:2px;margin-bottom:16px;"></div>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>' + panelCells.join('') + '</tr></table>' +
  '</div>';
}

// @agent-target: buildTimelineSVG
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

    if (i < events.length - 1) {
      svgContent += '<line x1="' + PAD_LEFT + '" y1="' + (dotCy + DOT_R + 2) + '" ' +
        'x2="' + PAD_LEFT + '" y2="' + (dotCy + ROW_H - DOT_R - 2) + '" ' +
        'stroke="#B8CDD9" stroke-width="' + LINE_W + '"/>';
    }

    svgContent += '<circle cx="' + PAD_LEFT + '" cy="' + dotCy + '" r="' + DOT_R + '" ' +
      'fill="#1A3E5C" stroke="#FFFFFF" stroke-width="2"/>';

    svgContent += '<text x="' + (PAD_LEFT - 12) + '" y="' + (dotCy + 4) + '" ' +
      'font-family="Montserrat,sans-serif" font-size="10" font-weight="600" ' +
      'fill="#7C848C" text-anchor="end">' + h(ev.marker) + '</text>';

    svgContent += '<text x="' + (PAD_LEFT + 16) + '" y="' + (dotCy - 2) + '" ' +
      'font-family="Montserrat,sans-serif" font-size="13" font-weight="700" ' +
      'fill="#163550">' + h(ev.event) + '</text>';

    if (ev.note) {
      svgContent += '<text x="' + (PAD_LEFT + 16) + '" y="' + (dotCy + 14) + '" ' +
        'font-family="Work Sans,sans-serif" font-size="11" font-weight="400" ' +
        'fill="#7C848C">' + h(ev.note) + '</text>';
    }
  });

  var titleHtml = tlTitle
    ? '<div style="font-family:Montserrat,sans-serif;font-size:14px;font-weight:800;color:#163550;line-height:1.35;margin-bottom:4px;">' + h(tlTitle) + '</div>'
    : '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#7C848C;margin-bottom:10px;">Timeline</div>';

  var insightHtml = tlInsight
    ? '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:#7C848C;line-height:1.55;margin-top:10px;padding-top:10px;border-top:1px solid #E8E2D5;font-style:italic;">' + h(tlInsight) + '</div>'
    : '';

  return '<div style="margin:0 0 20px;padding:18px 20px 14px;background:#FFFFFF;border-radius:8px;border:1px solid rgba(174,124,63,0.3);border-left:6px solid #163550;">' +
    titleHtml +
    '<svg width="100%" viewBox="0 0 ' + svgW + ' ' + svgH + '" style="display:block;overflow:visible;">' + svgContent + '</svg>' +
    insightHtml +
  '</div>';
}

// @agent-target: buildNumbersSVG
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
      deltaBadge = '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;color:' + dColor + ';margin-top:6px;letter-spacing:0.04em;">' + dArrow + ' ' + h(s.delta) + '</div>';
    } else if (s.delta && s.delta.trim() === 'flat') {
      deltaBadge = '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;color:#6b7280;margin-top:6px;letter-spacing:0.04em;">\u2192 flat</div>';
    }

    cells +=
      '<td style="width:' + colW + '%;padding:0 8px;vertical-align:top;text-align:center;">' +
        '<div style="font-family:Montserrat,sans-serif;font-size:28px;font-weight:900;color:#163550;line-height:1.1;letter-spacing:-0.02em;">' +
          h(s.value) + '<span style="font-size:16px;font-weight:600;color:#7C848C;">' + h(s.unit) + '</span>' +
        '</div>' +
        '<div style="font-family:Work Sans,sans-serif;font-size:11px;font-weight:500;color:#7C848C;line-height:1.4;margin-top:4px;">' + h(s.label) + '</div>' +
        deltaBadge +
      '</td>';
  });

  var titleHtml = numTitle
    ? '<div style="font-family:Montserrat,sans-serif;font-size:14px;font-weight:800;color:#163550;line-height:1.35;margin-bottom:4px;">' + h(numTitle) + '</div>'
    : '<div style="font-family:Montserrat,sans-serif;font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#7C848C;margin-bottom:10px;">By the numbers</div>';

  var insightHtml = numInsight
    ? '<div style="font-family:Work Sans,sans-serif;font-size:12px;color:#7C848C;line-height:1.55;margin-top:10px;padding-top:10px;border-top:1px solid #E8E2D5;font-style:italic;">' + h(numInsight) + '</div>'
    : '';

  return '<div style="margin:0 0 20px;padding:18px 20px 14px;background:#FFFFFF;border-radius:8px;border:1px solid rgba(174,124,63,0.3);border-left:6px solid #163550;">' +
    titleHtml +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>' + cells + '</tr></table>' +
    insightHtml +
  '</div>';
}
