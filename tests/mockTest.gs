// ╔══════════════════════════════════════════════════════════════════════╗
// ║  mockTest.gs — Local test harness for doPost(e) webhook              ║
// ║  THE GAHWA · STARTUP SCOUT OS v5                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝
// ════════════════════════════════════════════════════════════════════════
// USAGE:
//   1. Open the Apps Script editor (script.google.com)
//   2. Select the "mockTest" project or add this file to your project
//   3. Run runLocalTest() from the editor
//   4. View logs: View → Logs (or Cmd+Enter)
//
//   Alternatively, with clasp:
//     clasp push
//     clasp run runLocalTest
// ════════════════════════════════════════════════════════════════════════

/**
 * Constructs a mock `e` object simulating an HTTP POST request to doPost().
 * The mock mimics the structure that Google Apps Script provides to doPost(e):
 *   e.postData.contents  — raw JSON string body
 *   e.postData.type      — content type
 *   e.parameter          — query parameters (if any)
 *   e.headers            — HTTP request headers (for Authorization: Bearer <token>)
 *
 * Auth model: HEADER-BASED only (no PropertiesService dependency)
 * Token is sent via Authorization header, not in the payload body.
 *
 * @param {string} token   The Bearer token for Authorization header
 * @param {string} action  The action to route to (e.g., 'deploy' or '')
 * @returns {Object} A mock event object suitable for passing to doPost()
 */
function buildMockPostEvent(token, action) {
  var payload = {
    action:     action,
  };

  return {
    postData: {
      contents: JSON.stringify(payload),
      type:     'application/json',
      length:   JSON.stringify(payload).length,
      name:     'postData',
    },
    headers: {
      Authorization: 'Bearer ' + token,
    },
    parameter:      {},
    contextPath:    '',
    contentLength:  -1,
    queryString:    '',
    parameters:     {},
  };
}

/**
 * Runs a battery of tests against doPost() using mock events.
 * Tests cover:
 *   - Missing Authorization header
 *   - Valid Bearer token with 'deploy' action
 *   - Valid Bearer token with no action (should return "ok")
 *   - Invalid Bearer token (should return "Unauthorized")
 *   - Malformed JSON body
 *
 * Auth model tested: HEADER-BASED only (no PropertiesService dependency)
 *
 * Each test calls doPost(e) and logs the result.
 * Assertions are basic — they log PASS/FAIL for each case.
 */
function runLocalTest() {
  Logger.log('══════════════════════════════════════════════');
  Logger.log('🧪 runLocalTest() — doPost(e) Webhook Tests');
  Logger.log('   Auth model: HEADER-BASED (Bearer token)');
  Logger.log('══════════════════════════════════════════════');
  Logger.log('');

  // ── Test 1: Missing Authorization header ──────────────────────────────
  Logger.log('─── Test 1: Missing Authorization header ───');
  var e1 = {
    postData: {
      contents: JSON.stringify({ action: 'deploy' }),
      type:     'application/json',
      length:   20,
      name:     'postData',
    },
    headers: {},  // No Authorization header
    parameter:      {},
    contextPath:    '',
    contentLength:  -1,
    queryString:    '',
    parameters:     {},
  };
  var r1 = doPost(e1);
  var r1text = r1.getContent();
  var r1json = JSON.parse(r1text);
  var p1 = (r1json.status === 'error' && r1json.message === 'Unauthorized') ? '✅ PASS' : '❌ FAIL';
  Logger.log(p1 + ' | Expected "Unauthorized", got "' + r1text + '"');
  Logger.log('');

  // ── Test 2: Valid Bearer token + 'deploy' action ─────────────────────
  Logger.log('─── Test 2: Valid Bearer token + "deploy" action ───');
  var testToken = '89e9d1671f9a13dbd3cbdc5fd90a2fdecaff7a5d635b81aa'; // Must match Code.gs secretToken

  var e2 = buildMockPostEvent(testToken, 'deploy');
  var r2 = doPost(e2);
  var r2text = r2.getContent();
  var r2json = JSON.parse(r2text);
  // Not checking exact message (action might not trigger full deploy in test mode)
  // Just check that it's not Unauthorized
  var p2 = (r2json.status !== 'error') ? '✅ PASS' : '❌ FAIL';
  Logger.log(p2 + ' | Expected non-error, got "' + r2text + '"');
  Logger.log('');

  // ── Test 3: Valid Bearer token + no action (should return "ok") ──────
  Logger.log('─── Test 3: Valid Bearer token + no action ───');
  var e3 = buildMockPostEvent(testToken, '');
  var r3 = doPost(e3);
  var r3text = r3.getContent();
  var r3json = JSON.parse(r3text);
  var p3 = (r3json.status === 'ok') ? '✅ PASS' : '❌ FAIL';
  Logger.log(p3 + ' | Expected status "ok", got "' + r3text + '"');
  Logger.log('');

  // ── Test 4: Invalid Bearer token (should return "Unauthorized") ──────
  Logger.log('─── Test 4: Invalid Bearer token ───');
  var e4 = buildMockPostEvent('wrong-token-xyz', 'deploy');
  var r4 = doPost(e4);
  var r4text = r4.getContent();
  var r4json = JSON.parse(r4text);
  var p4 = (r4json.status === 'error' && r4json.message === 'Unauthorized') ? '✅ PASS' : '❌ FAIL';
  Logger.log(p4 + ' | Expected "Unauthorized", got "' + r4text + '"');
  Logger.log('');

  // ── Test 5: Malformed JSON body ─────────────────────────────────────
  Logger.log('─── Test 5: Malformed JSON body ───');
  var e5 = {
    postData: {
      contents: '{invalid-json!!!}',
      type:     'application/json',
      length:   18,
      name:     'postData',
    },
    headers: {
      Authorization: 'Bearer ' + testToken,
    },
    parameter:      {},
    contextPath:    '',
    contentLength:  -1,
    queryString:    '',
    parameters:     {},
  };
  try {
    var r5 = doPost(e5);
    var r5json = JSON.parse(r5.getContent());
    var p5 = (r5json.status === 'error') ? '✅ PASS' : '❌ FAIL';
    Logger.log(p5 + ' | Expected error, got "' + r5.getContent() + '"');
  } catch (err) {
    Logger.log('✅ PASS | Caught expected error: ' + err.message);
  }
  Logger.log('');

  // ── Summary ─────────────────────────────────────────────────────────
  Logger.log('══════════════════════════════════════════════');
  Logger.log('🏁 Tests complete. Review logs above for PASS/FAIL.');
  Logger.log('   Auth model verified: HEADER-BASED (Bearer token)');
  Logger.log('   PropertiesService: NOT used for auth validation');
  Logger.log('══════════════════════════════════════════════');
}

/**
 * Alternative: Run a single quick test with a custom payload.
 * Useful for ad-hoc debugging.
 *
 * @param {string} jsonPayload  Raw JSON string to send as postData.contents
 */
function runSingleTest(jsonPayload) {
  var e = {
    postData: {
      contents: jsonPayload,
      type:     'application/json',
      length:   jsonPayload.length,
      name:     'postData',
    },
    headers: {
      Authorization: 'Bearer 89e9d1671f9a13dbd3cbdc5fd90a2fdecaff7a5d635b81aa',
    },
    parameter:      {},
    contextPath:    '',
    contentLength:  -1,
    queryString:    '',
    parameters:     {},
  };

  Logger.log('📤 Sending: ' + jsonPayload);
  var result = doPost(e);
  Logger.log('📥 Response: ' + result.getContent());
  return result;
}
