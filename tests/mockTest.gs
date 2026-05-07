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
 *
 * @param {string} authToken  The auth_token to include in the payload
 * @param {string} action     The action to route to (e.g., 'deploy' or '')
 * @returns {Object} A mock event object suitable for passing to doPost()
 */
function buildMockPostEvent(authToken, action) {
  var payload = {
    auth_token: authToken,
    action:     action,
  };

  return {
    postData: {
      contents: JSON.stringify(payload),
      type:     'application/json',
      length:   JSON.stringify(payload).length,
      name:     'postData',
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
 *   - Missing WEBHOOK_SECRET (simulated by not setting it)
 *   - Valid auth_token with 'deploy' action
 *   - Valid auth_token with no action (should return "OK")
 *   - Invalid auth_token (should return "Unauthorized")
 *   - Malformed JSON body
 *
 * Each test calls doPost(e) and logs the result.
 * Assertions are basic — they log PASS/FAIL for each case.
 */
function runLocalTest() {
  Logger.log('══════════════════════════════════════════════');
  Logger.log('🧪 runLocalTest() — doPost(e) Webhook Tests');
  Logger.log('══════════════════════════════════════════════');
  Logger.log('');

  // ── Test 1: Missing WEBHOOK_SECRET ──────────────────────────────────
  // Ensure WEBHOOK_SECRET is NOT set for this test.
  // We simulate this by temporarily clearing it (if it exists).
  // NOTE: This will actually delete the property! Use with caution.
  Logger.log('─── Test 1: Missing WEBHOOK_SECRET ───');
  var props = PropertiesService.getScriptProperties();
  var savedSecret = props.getProperty('WEBHOOK_SECRET');
  props.deleteProperty('WEBHOOK_SECRET');

  var e1 = buildMockPostEvent('some-token', 'deploy');
  var r1 = doPost(e1);
  var r1text = r1.getContent();
  var p1 = (r1text === 'Server Error') ? '✅ PASS' : '❌ FAIL';
  Logger.log(p1 + ' | Expected "Server Error", got "' + r1text + '"');

  // Restore the secret for subsequent tests
  if (savedSecret) {
    props.setProperty('WEBHOOK_SECRET', savedSecret);
  }
  Logger.log('');

  // ── Test 2: Valid auth_token + 'deploy' action ──────────────────────
  Logger.log('─── Test 2: Valid auth_token + "deploy" action ───');
  var testToken = savedSecret || 'test-webhook-secret-123';
  props.setProperty('WEBHOOK_SECRET', testToken);

  var e2 = buildMockPostEvent(testToken, 'deploy');
  var r2 = doPost(e2);
  var r2text = r2.getContent();
  var p2 = (r2text === 'Deploy triggered') ? '✅ PASS' : '❌ FAIL';
  Logger.log(p2 + ' | Expected "Deploy triggered", got "' + r2text + '"');
  Logger.log('');

  // ── Test 3: Valid auth_token + no action (should return "OK") ───────
  Logger.log('─── Test 3: Valid auth_token + no action ───');
  var e3 = buildMockPostEvent(testToken, '');
  var r3 = doPost(e3);
  var r3text = r3.getContent();
  var p3 = (r3text === 'OK') ? '✅ PASS' : '❌ FAIL';
  Logger.log(p3 + ' | Expected "OK", got "' + r3text + '"');
  Logger.log('');

  // ── Test 4: Invalid auth_token (should return "Unauthorized") ───────
  Logger.log('─── Test 4: Invalid auth_token ───');
  var e4 = buildMockPostEvent('wrong-token-xyz', 'deploy');
  var r4 = doPost(e4);
  var r4text = r4.getContent();
  var p4 = (r4text === 'Unauthorized') ? '✅ PASS' : '❌ FAIL';
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
    parameter:      {},
    contextPath:    '',
    contentLength:  -1,
    queryString:    '',
    parameters:     {},
  };
  try {
    var r5 = doPost(e5);
    var p5 = '❌ FAIL — Expected exception, got result: ' + r5.getContent();
    Logger.log(p5);
  } catch (err) {
    Logger.log('✅ PASS | Caught expected error: ' + err.message);
  }
  Logger.log('');

  // ── Summary ─────────────────────────────────────────────────────────
  Logger.log('══════════════════════════════════════════════');
  Logger.log('🏁 Tests complete. Review logs above for PASS/FAIL.');
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
