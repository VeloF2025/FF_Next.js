/**
 * Shared strict environment-variable reader for standalone ops/cron scripts.
 *
 * Written as CommonJS (.cjs) deliberately: scripts/ contains both CommonJS
 * (.js) and ES module (.mjs) entry points, and Node's CJS→ESM named-export
 * interop lets both consume this file unchanged:
 *
 *   const { requireEnv } = require('./lib/require-env.cjs');   // .js
 *   import { requireEnv } from './lib/require-env.cjs';        // .mjs
 *
 * WHY STRICT: several of these scripts previously wrote their connection string
 * as `process.env.DATABASE_URL || '<hardcoded literal>'`. A fallback on config
 * that decides WHERE DATA GOES does not fail when the environment is missing —
 * it silently redirects. One such script pointed at a database that was retired
 * at the 2026-04-18 Supabase cutover and failed 151 times in a row unnoticed;
 * before that cutover the same line would have written to the wrong LIVE
 * database instead of erroring.
 *
 * So: absent config must stop the process, never substitute a default.
 */

/**
 * Return the value of `name`, or terminate the process with a clear message.
 *
 * Uses a falsy check rather than `=== undefined` so an empty or whitespace-only
 * value is rejected too — an empty connection string is not valid config.
 *
 * @param {string} name Environment variable name.
 * @returns {string} The non-empty value.
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    console.error(
      `FATAL: ${name} is not set. Refusing to run — provide it in the ` +
        `environment (see .env.local) rather than hardcoding a value.`
    );
    process.exit(1);
  }
  return value;
}

module.exports = { requireEnv };
