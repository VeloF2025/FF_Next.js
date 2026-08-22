/**
 * Tests for the no-silent-catch ESLint rule.
 *
 * Runnable standalone (worktree vitest hangs):
 *   node scripts/eslint-rules/__tests__/no-silent-catch.test.js
 *
 * Exits non-zero on any failure.
 *
 * Why this file exists (2026-08-22): the rule shipped on 2026-03-11 and has
 * gated pages/api since 2026-04-03, but it was the only rule in
 * scripts/eslint-rules/ with no test — the sibling gate (Gate 2e) ran tests for
 * the other two and vouched for nothing here. It now scores src/ and pages/ as
 * well, so a mis-fire would move three baselines instead of one.
 */
'use strict';

const { RuleTester } = require('eslint');
const path = require('path');
const rule = require(path.resolve(__dirname, '../no-silent-catch'));

// Standalone harness: give RuleTester minimal describe/it so it runs without a
// test framework and surfaces failures as thrown errors.
RuleTester.describe = function (_text, fn) { return fn(); };
RuleTester.it = function (text, fn) {
  try {
    fn();
    console.log(`  ✓ ${text}`);
  } catch (e) {
    console.error(`  ✗ ${text}\n    ${e.message}`);
    process.exitCode = 1;
  }
};

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-silent-catch', rule, {
  valid: [
    // The project logger: `import { log } from '@/lib/logger'`.
    { code: 'try { f(); } catch (e) { log.error("failed", { e }); }' },
    // logger.* and console.* are both accepted spellings.
    { code: 'try { f(); } catch (e) { logger.warn("failed", e); }' },
    { code: 'try { f(); } catch (e) { console.error("failed", e); }' },
    // Logging nested inside control flow still counts — containsLogging walks
    // the whole block, not just its top-level statements.
    { code: 'function h() { try { f(); } catch (e) { if (verbose) { logger.debug(e); } return null; } }' },
    // Logging inside a nested function/callback in the block.
    { code: 'try { f(); } catch (e) { queueMicrotask(() => console.warn(e)); }' },
    // Log then rethrow — the documented "good" shape.
    { code: 'try { f(); } catch (e) { logger.error("boom", e); throw e; }' },
    // A catch is required for the rule to fire at all: try/finally is untouched.
    { code: 'try { f(); } finally { done(); }' },
  ],
  invalid: [
    // Empty catch, binding present.
    { code: 'try { f(); } catch (e) {}', errors: [{ messageId: 'emptyCatch' }] },
    // Empty catch, optional-binding form (ES2019) — the shape a comment-only
    // "intentional" suppression takes in this codebase.
    { code: 'try { f(); } catch { /* intentional */ }', errors: [{ messageId: 'emptyCatch' }] },
    // Non-empty but swallowing: the single most common real instance.
    { code: 'function h() { try { f(); } catch (e) { return null; } }', errors: [{ messageId: 'silentCatch' }] },
    // Surfacing to the UI is not logging.
    { code: 'try { f(); } catch (e) { setError(e.message); }', errors: [{ messageId: 'silentCatch' }] },
    { code: 'try { f(); } catch { toast.error("Could not load"); }', errors: [{ messageId: 'silentCatch' }] },
    // A non-logging method on a logging object does not launder the block:
    // `console.table` / `logger.report` are not in LOGGING_METHODS.
    { code: 'try { f(); } catch (e) { console.table(e); }', errors: [{ messageId: 'silentCatch' }] },
    // Each catch is reported independently — two swallows are two findings, so
    // the ratchet counts blocks rather than files.
    {
      code: 'function h() { try { f(); } catch (e) { return 1; } }\nfunction i() { try { g(); } catch (e) { return 2; } }',
      errors: [{ messageId: 'silentCatch' }, { messageId: 'silentCatch' }],
    },
  ],
});

if (process.exitCode) {
  console.error('\nno-silent-catch: TESTS FAILED');
} else {
  console.log('\nno-silent-catch: all tests passed');
}
