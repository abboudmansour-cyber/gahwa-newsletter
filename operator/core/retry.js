/**
 * retry.js — Generic Retry Utility
 *
 * Executes an async function with retry logic.
 * No inline retry logic should exist anywhere else in the codebase.
 *
 * @module retry
 */

/**
 * Execute an async function with retry logic.
 * Logs each attempt and retry to stdout.
 *
 * @param {Function} fn - Async function to execute (must return a promise)
 * @param {object} [options]
 * @param {number} [options.retries=2] - Number of retry attempts after initial failure
 * @param {number} [options.delay=10000] - Delay in ms between retries
 * @returns {Promise<{success: boolean, attempts: number, duration: number, error?: string}>}
 */
export async function retry(fn, { retries = 2, delay = 10000 } = {}) {
  const startTime = Date.now();
  let lastError = null;
  const maxAttempts = 1 + retries;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const isRetry = attempt > 1;

    if (isRetry) {
      console.log(`\n🔄 Retry attempt ${attempt - 1} of ${retries}...`);
      console.log(`   Waiting ${delay / 1000}s before retry...`);
      await sleep(delay);
    } else {
      console.log(`\n🚀 Starting execution (attempt ${attempt}/${maxAttempts})...`);
    }

    try {
      await fn();
      const duration = Date.now() - startTime;
      return { success: true, attempts: attempt, duration };
    } catch (err) {
      lastError = err;
      console.log(`\n❌ Execution failed: ${err.message}`);

      if (attempt < maxAttempts) {
        console.log(`   ${maxAttempts - attempt} attempt(s) remaining.`);
      }
    }
  }

  const duration = Date.now() - startTime;
  console.log(`\n❌ All ${maxAttempts} attempts exhausted after ${Math.round(duration / 1000)}s.`);

  return {
    success: false,
    attempts: maxAttempts,
    duration,
    error: lastError?.message || "Unknown error",
  };
}

/**
 * Promise-based sleep helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
