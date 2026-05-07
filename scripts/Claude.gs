// ╔══════════════════════════════════════════════════════════════════════╗
// ║  CLAUDE.gs — DeepSeek API wrapper (Anthropic-compatible endpoint)   ║
// ║  All prompt functions                                               ║
// ║  THE GAHWA · STARTUP SCOUT OS v5                                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ════════════════════════════════════════════════════════════════════════
// WEBHOOK SECURITY — doPost entry point
// ════════════════════════════════════════════════════════════════════════

/**
 * Webhook entry point for external services (e.g., Hetzner cron).
 * Validates auth_token against WEBHOOK_SECRET stored in PropertiesService.
 * Add WEBHOOK_SECRET via storeSecrets() or manually in Script Properties.
 *
 * This function is a thin GAS adapter. The core logic lives in
 * handleWebhook() so it can be tested independently.
 */
function doPost(e) {
  var SECRET_TOKEN = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  var contents;
  try {
    contents = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    log('ERROR', 'Invalid JSON in webhook payload: ' + parseErr.message);
    return ContentService.createTextOutput("Bad Request").setMimeType(ContentService.MimeType.TEXT);
  }

  var result = handleWebhook(contents, SECRET_TOKEN);
  return ContentService.createTextOutput(result.text).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Pure-logic webhook handler — no GAS service dependencies.
 * Can be tested without PropertiesService or ContentService.
 *
 * @param {Object} contents     Parsed JSON body from the POST request
 * @param {string} secretToken  The WEBHOOK_SECRET (or null if not configured)
 * @returns {{ text: string, action: string }}
 *          text   — The response body string
 *          action — The action that was taken ('deploy', 'ok', 'unauthorized', 'error')
 */
function handleWebhook(contents, secretToken) {
  if (!secretToken) {
    log('ERROR', 'WEBHOOK_SECRET not set in PropertiesService.');
    return { text: 'Server Error', action: 'error' };
  }

  // Security Gate
  if (!contents || contents.auth_token !== secretToken) {
    return { text: 'Unauthorized', action: 'unauthorized' };
  }

  // Route based on action
  var action = contents.action || '';
  if (action === 'deploy') {
    // Trigger a full pipeline run
    runFullPipeline();
    return { text: 'Deploy triggered', action: 'deploy' };
  }

  return { text: 'OK', action: 'ok' };
}


// ════════════════════════════════════════════════════════════════════════
// API WRAPPER — DeepSeek Anthropic-compatible endpoint
// Base URL: https://api.deepseek.com/anthropic
// Model:    deepseek-v4-flash (FAST) or deepseek-v4-pro (SMART)
// ════════════════════════════════════════════════════════════════════════

// @agent-target: callClaude
function callClaude(prompt, modelName) {
  // Backward compatibility: handle boolean legacy params (true → SMART, false → FAST)
  if (modelName === true) modelName = CONFIG.CLAUDE_SMART;
  else if (modelName === false || modelName === undefined || modelName === null) modelName = CONFIG.CLAUDE_FAST;

  var apiKey  = getSecret('SECRET_DEEPSEEK_API_KEY');
  var url     = 'https://api.deepseek.com/anthropic/v1/messages';
  var payload = JSON.stringify({
    model:      modelName,
    max_tokens: modelName === CONFIG.CLAUDE_SMART ? 8096 : 8000,
    messages:   [{ role: 'user', content: prompt }],
  });
  var opts = {
    method: 'post',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    payload:            payload,
    muteHttpExceptions: true,
  };

  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var res  = UrlFetchApp.fetch(url, opts);
      var code = res.getResponseCode();
      var body = res.getContentText();

      if (code === 200) {
        var json = JSON.parse(body);

        // Anthropic response format: content array with text blocks
        var text = '';
        if (json.content && Array.isArray(json.content)) {
          for (var i = 0; i < json.content.length; i++) {
            if (json.content[i].type === 'text' && json.content[i].text) {
              text += json.content[i].text;
            }
          }
        }

        if (!text || text.trim().length < 5) {
          log('WARN', 'Empty DeepSeek response on attempt ' + attempt);
          log('WARN', 'Raw body: ' + body.substring(0, 300));
          if (attempt === 3) return 'API ERROR empty response';
          Utilities.sleep(3000); continue;
        }

        try {
          var u      = json.usage || {};
          var props  = PropertiesService.getScriptProperties();
          // Anthropic returns input_tokens / output_tokens
          var inTok  = parseInt(props.getProperty('IN_TOK')  || '0') + (u.input_tokens     || 0);
          var outTok = parseInt(props.getProperty('OUT_TOK') || '0') + (u.output_tokens || 0);
          props.setProperty('IN_TOK',  inTok.toString());
          props.setProperty('OUT_TOK', outTok.toString());
        } catch(e) {
          log('WARN', 'Token tracking failed (non-fatal): ' + e.message);
        }

        return text;
      }

      if (code === 529 || code === 503) {
        log('WARN', 'DeepSeek overloaded (attempt ' + attempt + '). Waiting 15s...');
        Utilities.sleep(15000);
      } else if (code === 429) {
        log('WARN', 'Rate limited (attempt ' + attempt + '). Waiting 5s...');
        Utilities.sleep(5000);
      } else {
        log('ERROR', 'DeepSeek HTTP ' + code + ': ' + body.substring(0, 200));
        if (attempt === 3) return 'API ERROR ' + code;
        Utilities.sleep(3000);
      }
    } catch(e) {
      log('ERROR', 'DeepSeek exception (attempt ' + attempt + '): ' + e.message);
      if (attempt === 3) return 'EXCEPTION: ' + e.message;
      Utilities.sleep(3000);
    }
  }
  return 'FAILED after 3 attempts';
}

// @agent-target: _trackTokens
function _trackTokens(usage) {
  try {
    if (!usage) return;
    var props = PropertiesService.getScriptProperties();
    // Anthropic returns input_tokens / output_tokens
    var inTok  = parseInt(props.getProperty('IN_TOK')  || '0') + (usage.input_tokens  || 0);
    var outTok = parseInt(props.getProperty('OUT_TOK') || '0') + (usage.output_tokens || 0);
    props.setProperty('IN_TOK',  inTok.toString());
    props.setProperty('OUT_TOK', outTok.toString());
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════════════════
// PROMPT: EXTRACTION (Step 1 — Haiku, fast)
// ════════════════════════════════════════════════════════════════════════

// @agent-target: extractChunk
function extractChunk(chunkText, chunkNum, totalChunks) {
  return callClaude(
    'Extract all notable signals from the newsletters below. Raw dump only — no scoring.\n\n' +
    'RULES:\n' +
    '- Extract from CONTENT field only\n' +
    '- Copy EXACT Title and Publisher\n' +
    '- If Title not found: TITLE NOT FOUND #N\n' +
    '- No scoring, no filtering\n' +
    '- Minimum 3 signals per newsletter\n' +
    '- Self-check: Title must match Title: field exactly\n\n' +
    'CAPTURE ALL: launches, funding (amount+stage+investors), people moves (name+role+company), ' +
    'pricing changes, stats with numbers, regulatory actions, earnings, app metrics, ' +
    'geopolitical events, supply chain, culture with business angle\n\n' +
    'FORMAT:\n' +
    '#N — [EXACT TITLE] | [EXACT PUBLISHER]\n' +
    '- signal with specific data\n' +
    '- signal with specific data\n\n' +
    '━━\nCHUNK ' + chunkNum + '/' + totalChunks + ':\n\n' + chunkText + '\n━━\nBEGIN.',
    CONFIG.CLAUDE_FAST
  );
}

// ════════════════════════════════════════════════════════════════════════
// PROMPT: PART 1 — Score, rank, brief (Step 2 — Sonnet, smart)
// ════════════════════════════════════════════════════════════════════════

// @agent-target: generatePart1
function generatePart1(signals, nlCount) {
  var _r1 = callClaude(
    'Act as the Editor-in-Chief of Gahwa Brief.\n' +
    'Core Objective: Summarize GCC business news for high-level executives in Riyadh and Dubai.\n' +
    'You have extracted signals from ' + nlCount + ' newsletters.\n\n' +

    'TONE RULES — read carefully, these are conditional:\n' +
    '- Headlines: Maximum 6 words, punchy (e.g., "Aramco\'s AI Pivot," "Dubai\'s Crypto Clear-out").\n' +
    '- The "Why it Matters" section: 1 sentence on the macro impact for the GCC region.\n' +
    '- No passive voice. No "fluff." Use business-wit.\n' +
    '- Write like a smart friend who happens to know everything, not a consultant who bills by the word.\n' +
    '- Headlines: punchy, data-anchored. "Aramco cuts China\'s oil by half" not "Aramco modifies OSP policy".\n' +
    '- Specific over vague. Active over passive.\n' +
    '- TONE BY CATEGORY: Apply wit and irreverence to OPP/TREND signals in AI & TECH, PRODUCT, CULTURE, PEOPLE.\n' +
    '  For MACRO & GEO signals (oil, war, ceasefire, PMI, interest rates, sanctions) — write straight.\n' +
    '  No dry jokes on serious macro. Report it clearly. Gravity is the right register.\n' +
    '- Why Now: sound like a tip from a well-connected friend, not a consulting recommendation.\n' +
    '- Never use: "leverage", "synergy", "ecosystem", "robust", "in the realm of", "it is worth noting".\n' +
    '- Focus: KSA Vision 2030, UAE Fintech hubs, and regional HORECA trends.\n\n' +

    'INTERNAL STEPS (do these silently — output NOTHING from these steps):\n' +
    '1. DEDUPLICATE: merge signals about the same event into one. Note highest SRC count.\n' +
    '2. SCORE each signal using the GAHWA-R framework (all dimensions 1–5):\n' +
    '   G — GCC Proximity (weight 30%):\n' +
    '     5 = Event physically in Saudi/GCC, involves a Saudi/GCC entity, or directly changes\n' +
    '         the operating environment for GCC businesses today\n' +
    '     4 = Direct and immediate consequence for GCC operators or investors\n' +
    '     3 = Emerging market parallel with clear GCC application\n' +
    '     2 = Global story with indirect GCC relevance\n' +
    '     1 = US/EU-centric with no meaningful GCC angle\n' +
    '   A — Actionability (weight 20%):\n' +
    '     5 = A founder or operator can make a specific decision differently this week\n' +
    '     4 = Informs a near-term decision (next 30 days)\n' +
    '     3 = Background context that sharpens judgment over time\n' +
    '     2 = Interesting but no clear action\n' +
    '     1 = Pure spectator information\n' +
    '   H — Human Interest (weight 15%):\n' +
    '     5 = Named person, specific company, or striking number a reader will repeat today\n' +
    '     4 = Clear protagonist or memorable statistic\n' +
    '     3 = Story has a subject but it is abstract or institutional\n' +
    '     2 = Generic trend without a face or number\n' +
    '     1 = Completely abstract, no anchor\n' +
    '   W — Why Today (weight 20%):\n' +
    '     5 = Something changed in the last 24 hours — decision made, number released, event occurred\n' +
    '     4 = Development within the last 72 hours\n' +
    '     3 = Story moved meaningfully this week\n' +
    '     2 = Ongoing story with no fresh development\n' +
    '     1 = Evergreen background content, no time-peg\n' +
    '   A2 — Autonomy/Novelty (weight 15%):\n' +
    '     5 = Reader would not have seen this in FT, Bloomberg, or Reuters today\n' +
    '     4 = Found in specialist or regional sources only\n' +
    '     3 = In major outlets but Gahwa angle is meaningfully different\n' +
    '     2 = Covered everywhere, angle is the same\n' +
    '     1 = Wire story repeated verbatim\n' +
    '   Weighted score = ((G×0.30) + (A×0.20) + (H×0.15) + (W×0.20) + (A2×0.15)) × 5\n' +
    '   Result is a score out of 25.\n\n' +
    '   MULTI-SOURCE BOOST: If SRC >= 3, add +1 to W before calculating. If SRC >= 5, add +2 to W.\n' +
    '   W cannot exceed 5 after boost.\n\n' +
    '3. TIERED INCLUSION THRESHOLDS:\n' +
    '   If G = 5: include if weighted score >= 13\n' +
    '   If G = 4: include if weighted score >= 15\n' +
    '   If G <= 3: include if weighted score >= 18\n' +
    '   Override: if fewer than 20 signals qualify, lower all thresholds by 2\n\n' +
    '4. PRIORITY FLAG:\n' +
    '   Set PRI: YES if weighted score >= 21 AND G >= 4\n' +
    '   A signal cannot be PRIORITY if G <= 3, regardless of score\n' +
    '   Maximum 3 PRIORITY signals per issue\n\n' +
    '5. CATEGORISE: AI & TECH | GCC & SAUDI | FINTECH & CRYPTO | MACRO & GEO | MEDIA & MARKETING | PEOPLE | PRODUCT | CULTURE\n\n' +
    '6. MANDATORY COVERAGE: verify GCC & SAUDI, MACRO & GEO, and FINTECH & CRYPTO are each represented.\n' +
    '   If any category has zero qualified signals: promote the highest-scoring unqualified signal\n' +
    '   from that category regardless of threshold, tagged [COVERAGE PULL] in the headline.\n\n' +
    '7. RANKING ORDER:\n' +
    '   Tier 1: PRIORITY signals (sorted by weighted score, highest first)\n' +
    '   Tier 2: GCC & SAUDI signals (sorted by weighted score)\n' +
    '   Tier 3: all remaining signals (sorted by weighted score)\n' +
    '   Within each tier, G=5 signals rank above G=4 at equal scores.\n\n' +
    '8. BIG STORY: the highest-scoring signal with G >= 4.\n\n' +

    '═══ OUTPUT FORMAT ═══\n' +
    'Output a SINGLE valid JSON object. No markdown. No code fences. No explanation.\n' +
    'The JSON must be parseable by JSON.parse() without any pre-processing.\n' +
    'Do not output any text before or after the JSON object.\n\n' +

    'Output ONLY the "sections.brief" and "sections.signals" keys.\n' +
    'Do not output voice, themes, viral, startup, watch, question, inspiration,\n' +
    'subject_lines, chart, infographic, stat_card, timeline, numbers, visual_primary,\n' +
    'or visual_secondary — those are generated in the next API call.\n\n' +

    'Required output shape:\n' +
    '{\n' +
    '  "sections": {\n' +
    '    "brief": {\n' +
    '      "date": "[date string]",\n' +
    '      "count": "[N] newsletters · [X] signals · [Y] priority",\n' +
    '      "sod": "[Signal of the Day — one sentence that makes someone say wait, really]",\n' +
    '      "big_story": "[The single most important story. 2-3 sentences of editorial context.]",\n' +
    '      "themes": ["theme1", "theme2", "theme3"],\n' +
    '      "watch": ["near-miss signal one line", "near-miss signal one line"]\n' +
    '    },\n' +
    '    "signals": [\n' +
    '      {\n' +
    '        "n": 1,\n' +
    '        "cat": "GCC & SAUDI",\n' +
    '        "type": "TREND",\n' +
    '        "aud": "OPERATOR",\n' +
    '        "pri": true,\n' +
    '        "trd": true,\n' +
    '        "src": 5,\n' +
    '        "h": "headline max 12 words",\n' +
    '        "i": "insight one sentence specific numbers",\n' +
    '        "ctx": "historical context one sentence or empty string",\n' +
    '        "w": "why now one sentence concrete action",\n' +
    '        "url": "https://... or empty string",\n' +
    '        "scores": { "g": 5, "a": 4, "h": 3, "w": 4, "a2": 2, "total": 21 }\n' +
    '      }\n' +
    '    ]\n' +
    '  }\n' +
    '}\n\n' +

    'Field rules:\n' +
    '- "pri" and "trd" are JSON booleans (true/false), not strings.\n' +
    '- "n", "src", and all score fields are JSON integers, not strings.\n' +
    '- "ctx" and "url": use empty string "" if no value — never null, never omit.\n' +
    '- "cat" must be one of: AI & TECH | GCC & SAUDI | FINTECH & CRYPTO | MACRO & GEO | MEDIA & MARKETING | PEOPLE | PRODUCT | CULTURE\n' +
    '- "type" must be one of: OPP | GAP | TREND\n' +
    '- "aud" must be one of: CORP | SME | VC | GEN-Z | OPERATOR\n' +
    '- All string values: no newline characters inside strings. Use space instead.\n' +
    '- Signals array: ordered by ranking rules defined above (PRIORITY → GCC & SAUDI → all others).\n\n' +

    'SIGNALS:\n' + signals,
    CONFIG.CLAUDE_SMART
  );
  if (typeof _r1 === 'string' && _r1.trim().charAt(0) !== '{') {
    _r1 = _r1.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  }
  return _r1;
}

// ════════════════════════════════════════════════════════════════════════
// PROMPT: PARTS 2-7 — Sections, subject lines, visuals (Step 3 — Sonnet)
// ════════════════════════════════════════════════════════════════════════

// @agent-target: generateParts2to7
function generateParts2to7(part1, fitness, nlCount) {
  var _r27 = callClaude(
    'Act as the Editor-in-Chief of Gahwa Brief.\n' +
    'Core Objective: Summarize GCC business news for high-level executives in Riyadh and Dubai.\n' +
    'Morning Brew energy meets regional intelligence depth.\n\n' +

    'VOICE RULES — apply to every word you write:\n' +
    '- Wit over jargon. Write like a brilliant friend, not a Bloomberg terminal.\n' +
    '- Use unexpected angles: if everyone says "oil prices rose", you say "Hormuz just turned\n' +
    '  the global energy market into a hostage negotiation and Saudi is the only one with keys".\n' +
    '- One dry joke or sideways observation per section is mandatory, not optional.\n' +
    '- Contrasts land harder than adjectives: "$25B deployed, IMF cuts forecast" > "mixed signals".\n' +
    '- Never use: "leverage", "synergy", "ecosystem", "robust", "actionable insights",\n' +
    '  "in today\'s rapidly evolving landscape", or anything that sounds like a LinkedIn post.\n\n' +

    '⛔ NO source citations, newsletter names, or URLs anywhere. Absolute.\n\n' +

    'GAHWA EDITORIAL HARD RULES (apply to all output):\n' +
    '1. Cut every draft one additional pass after writing. Remove 20% more.\n' +
    '2. No hedging phrases anywhere: "significant", "measurable", "meaningful",\n' +
    '   "it is worth noting", "this could mean", "this may".\n' +
    '3. Signal headlines: tension, contradiction, or curiosity gap. Never dry report style.\n' +
    '   Banned: "[Entity] announces [thing]". Required: specific number + implication,\n' +
    '   OR contradiction, OR open loop.\n' +
    '4. GAHWA_OPEN: one sentence. One Gulf-specific fact from today + brand sign-off.\n' +
    '   No source count. Never starts with "Good morning from a Gulf where".\n' +
    '5. Single-line field values only. No line breaks inside any field value.\n\n' +

    'RANKED SIGNALS:\n' + part1 + '\n\n' +

    'Output a SINGLE valid JSON object. No markdown. No code fences. No explanation.\n' +
    'The JSON must be parseable by JSON.parse() without any pre-processing.\n' +
    'Do not output any text before or after the JSON object.\n\n' +

    'The ranked signals from Part 1 are provided below as JSON.\n' +
    'Use them as your source of truth. Do not contradict their content.\n' +
    'Do not re-output the signals array. Do not include sections.brief or sections.signals.\n\n' +

    'Required output shape (all keys mandatory — use null for skipped visuals):\n' +
    '{\n' +
    '  "voice": {\n' +
    '    "open": "one-line Gahwa opening tone-setter",\n' +
    '    "v": "one editorial voice line for the signals section",\n' +
    '    "close": "one-line sign-off for the footer"\n' +
    '  },\n' +
    '  "gahwa_open": "one sentence Gulf-specific fact from today plus brand sign-off",\n' +
    '  "sections": {\n' +
    '    "themes": [\n' +
    '      { "t": "theme title", "sigs": [1,2], "saudi": "...", "mena": "...", "global": "...", "do": "..." }\n' +
    '    ],\n' +
    '    "viral": [\n' +
    '      { "hook": "...", "why": "..." }\n' +
    '    ],\n' +
    '    "startup": [\n' +
    '      { "name": "...", "sigs": [1,4], "prob": "...", "sol": "...", "cus": "...", "mod": "...", "now": "...", "gcc": "..." }\n' +
    '    ],\n' +
    '    "watch": [\n' +
    '      { "sig": "...", "why": "..." }\n' +
    '    ],\n' +
    '    "question": {\n' +
    '      "q": "the question max 20 words",\n' +
    '      "ctx": "why this matters this week 2 sentences max",\n' +
    '      "stake": "what is at risk one sentence max 15 words"\n' +
    '    },\n' +
    '    "inspiration": [\n' +
    '      { "item": "...", "riff": "..." }\n' +
    '    ],\n' +
    '    "subject_lines": {\n' +
    '      "lines": [\n' +
    '        { "id": "SL1", "text": "..." },\n' +
    '        { "id": "SL2", "text": "..." },\n' +
    '        { "id": "SL3", "text": "..." },\n' +
    '        { "id": "SL4", "text": "..." },\n' +
    '        { "id": "SL5", "text": "..." },\n' +
    '        { "id": "SL6", "text": "..." },\n' +
    '        { "id": "SL7", "text": "..." },\n' +
    '        { "id": "SL8", "text": "..." },\n' +
    '        { "id": "SL9", "text": "..." },\n' +
    '        { "id": "SL10", "text": "..." }\n' +
    '      ],\n' +
    '      "winner": { "id": "SL1", "reason": "one line reason" }\n' +
    '    }\n' +
    '  },\n' +
    '  "chart": null,\n' +
    '  "infographic": null,\n' +
    '  "stat_card": null,\n' +
    '  "timeline": null,\n' +
    '  "numbers": null,\n' +
    '  "visual_primary": "chart",\n' +
    '  "visual_secondary": "numbers"\n' +
    '}\n\n' +

    'Visual field rules:\n' +
    '- If a visual has data: populate its object per the schema.\n' +
    '- If a visual is skipped: set it to JSON null (not the string "null", not "[SKIP]").\n' +
    '- visual_primary and visual_secondary: always string values from the allowed enum.\n' +
    '  Allowed: "chart" | "infographic" | "stat_card" | "timeline" | "numbers"\n' +
    '  Even if a visual type is null, it can still be nominated in a slot — the compiler handles fallback.\n\n' +

    'Chart object shape when not null:\n' +
    '  { "title": "...", "insight": "...", "highlight": "...",\n' +
    '    "bars": [{ "label": "...", "value": "...", "unit": "...", "delta": "..." }] }\n\n' +

    'Infographic object shape when not null:\n' +
    '  { "title": "...", "framing": "...", "connector": "→",\n' +
    '    "panels": [{ "label": "...", "stat": "...", "note": "..." }] }\n\n' +

    'Stat card object shape when not null:\n' +
    '  { "num": "...", "label": "...", "context": "...", "delta": "..." }\n\n' +

    'Timeline object shape when not null:\n' +
    '  { "title": "...", "insight": "...",\n' +
    '    "events": [{ "marker": "...", "event": "...", "note": "..." }] }\n\n' +

    'Numbers object shape when not null:\n' +
    '  { "title": "...", "insight": "...",\n' +
    '    "stats": [{ "value": "...", "unit": "...", "label": "...", "delta": "..." }] }\n\n' +

    'General rules:\n' +
    '- All string values: no newline characters inside strings. Use space instead.\n' +
    '- No source citations, newsletter names, or URLs anywhere in this output.\n' +
    '- No hallucination. No external knowledge beyond what is in the ranked signals.\n\n' +

    'RANKED SIGNALS (JSON from Part 1):\n' + part1,
    CONFIG.CLAUDE_SMART
  );
  if (typeof _r27 === 'string' && _r27.trim().charAt(0) !== '{') {
    _r27 = _r27.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  }
  return _r27;
}

// ════════════════════════════════════════════════════════════════════════
// PROMPT: WEEKLY ROLLUP
// ════════════════════════════════════════════════════════════════════════

// @agent-target: generateWeeklyRollup
function generateWeeklyRollup(summary) {
  return callClaude(
    'Act as the Editor-in-Chief of Gahwa Brief.\n' +
    'Core Objective: Summarize GCC business news for high-level executives in Riyadh and Dubai.\n' +
    'Morning Brew energy — sharp, witty, specific.\n' +
    'Analyze this week\'s signal frequency and write a WEEKLY BRIEF.\n\n' +
    summary + '\n\n' +
    'Output these exact sections:\n\n' +
    '===RISING===\n(Signals appearing 3+ days. Bold headline, 2-3 sentence narrative.)\n===END RISING===\n\n' +
    '===BREAKOUT===\n(New signals from last 1-2 days worth watching. One para each.)\n===END BREAKOUT===\n\n' +
    '===FADING===\n(Signals that dominated early week but dropped off. One line each.)\n===END FADING===\n\n' +
    '===META===\n(One sharp paragraph: what does this week\'s signal pattern say about where the GCC market is heading?)\n===END META===\n\n' +
    '===NEXTWEEK===\n(3 signals likely to escalate. Format: SIGNAL: [headline] | WHY: [one sentence])\n===END NEXTWEEK===\n\n' +
    'RULES: No hallucination. Use exact signal headlines. No corporate speak.',
    CONFIG.CLAUDE_SMART
  );
}

// ════════════════════════════════════════════════════════════════════════
// SUBJECT LINE HELPERS
// Note: parseWinningSubject() is defined in shared.utils.js (dual-mode JSON + markers)
// ════════════════════════════════════════════════════════════════════════

// @agent-target: generateSubjectLines
function generateSubjectLines(part1, dateStr, nlCount) {
  var brief = parseBrief(part1);
  if (brief.sod && brief.sod.length > 10) {
    var s = brief.sod.length > 80 ? brief.sod.substring(0, 77) + '...' : brief.sod;
    return CONFIG.TITLE + ' · ' + s;
  }
  return CONFIG.TITLE + ' · ' + dateStr + ' · ' + nlCount + ' newsletters';
}
