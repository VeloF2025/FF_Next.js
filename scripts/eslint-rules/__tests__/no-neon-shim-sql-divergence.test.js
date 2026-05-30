/**
 * Tests for the no-neon-shim-sql-divergence ESLint rule.
 *
 * Runnable standalone (worktree vitest hangs):
 *   node scripts/eslint-rules/__tests__/no-neon-shim-sql-divergence.test.js
 *
 * Exits non-zero on any failure.
 */
'use strict';

const { RuleTester } = require('eslint');
const path = require('path');
const rule = require(path.resolve(__dirname, '../no-neon-shim-sql-divergence'));

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

ruleTester.run('no-neon-shim-sql-divergence', rule, {
  valid: [
    // Plain scalar bind params — the normal, safe case.
    { code: 'const r = await sql`SELECT * FROM t WHERE id = ${id}`;' },
    // Parameterised executor — the recommended replacement.
    { code: 'const r = await sql.query(`SELECT * FROM t WHERE id = $1`, [id]);' },
    // Safe 1-arg interpolation sentinel inside a tagged template.
    { code: 'const r = await sql`SELECT ${sql.unsafe(columnList)} FROM t`;' },
    // sql.unsafe with a single (trusted-string) arg, assigned for interpolation.
    { code: 'const frag = sql.unsafe(orderBy);' },
    // A non-sql tagged template is irrelevant.
    { code: 'const x = css`color: red; ${theme}`;' },
  ],
  invalid: [
    // CLASS 1: nested sql`` fragment interpolation.
    {
      code: 'const r = await sql`SELECT * FROM t ${sql`AND x = ${v}`}`;',
      errors: [{ messageId: 'fragmentInterpolation' }],
    },
    // CLASS 1: ternary that yields a sql`` fragment in the else branch.
    {
      code: 'const r = await sql`UPDATE t SET a = ${cond ? val : sql`a`}`;',
      errors: [{ messageId: 'fragmentInterpolation' }],
    },
    // CLASS 1: accumulator reassignment pattern.
    {
      code: 'let w = sql`WHERE a = ${a}`; w = sql`${w} AND b = ${b}`;',
      errors: [{ messageId: 'fragmentInterpolation' }],
    },
    // CLASS 2: sql.unsafe used as a 2-arg query executor.
    {
      code: 'const rows = await sql.unsafe(queryText, params);',
      errors: [{ messageId: 'unsafeExecutor' }],
    },
  ],
});

if (process.exitCode) {
  console.error('\nno-neon-shim-sql-divergence: TESTS FAILED');
} else {
  console.log('\nno-neon-shim-sql-divergence: all tests passed');
}
