/**
 * Tests for the no-direct-serial-status-write ESLint rule.
 *
 * Runnable standalone (worktree vitest hangs):
 *   node scripts/eslint-rules/__tests__/no-direct-serial-status-write.test.js
 *
 * Exits non-zero on any failure.
 *
 * The rule had no tests for the two months it was believed to be enforcing.
 * Two evasions were found by positive control and are pinned below: a table
 * alias (`UPDATE stock_serials ss SET status = ...`) and `+` concatenation.
 * Both shapes are in active use against this exact table, which is why a rule
 * that scored them clean was worse than no rule — it read as coverage.
 */
'use strict';

const { RuleTester } = require('eslint');
const path = require('path');
const rule = require(path.resolve(__dirname, '../no-direct-serial-status-write'));

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

const err = (column) => [{ messageId: 'noDirectWrite', data: { column } }];

ruleTester.run('no-direct-serial-status-write', rule, {
  valid: [
    // Install metadata only. This is the real shape of consumptionService.ts's
    // SQL_INSTALL_SERIAL_METADATA, which is a deliberate direct writer of
    // non-guarded columns and must stay legal.
    {
      code:
        "const q = `UPDATE stock_serials SET ` +\n" +
        "  `installed_at_drop_id = $2, installed_date = NOW() ` +\n" +
        "  `WHERE id = $1`;",
    },
    // Aliased metadata write — the real cascadeSerialPromotion.ts shape. The
    // alias is now understood, so this must still NOT report: it sets
    // installed_* columns, not status/holder_id.
    {
      code:
        'const q = `UPDATE stock_serials ss\n' +
        '  SET installed_at_drop_number = r.resolved_drop_number,\n' +
        '      installed_date = COALESCE(r.photo_date, CURRENT_DATE)\n' +
        '  FROM ranked r\n' +
        '  WHERE ss.id = r.serial_id`;',
    },
    // Filtering by status is not writing status.
    { code: 'const q = `UPDATE stock_serials SET notes = $1 WHERE status = $2`;' },
    // A status write to a different table is none of this rule's business.
    { code: 'const q = `UPDATE stock_items SET status = $1 WHERE id = $2`;' },
    // Reads are irrelevant.
    { code: 'const q = `SELECT status, holder_id FROM stock_serials WHERE id = $1`;' },
    // The allow-listed owner of the state machine.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: '/repo/src/modules/procurement/field-stock/services/serialLifecycle.ts',
    },
    // The allow-listed force-correct service.
    {
      code: 'const q = `UPDATE stock_serials SET holder_id = $1 WHERE id = $2`;',
      filename: '/repo/src/modules/procurement/field-stock/services/serialForceCorrectService.ts',
    },
  ],

  invalid: [
    // The plain form, which was the only one the rule ever caught.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      errors: err('status'),
    },
    // Multi-line — how every real writer in this codebase is formatted.
    {
      code:
        'const q = `UPDATE stock_serials\n' +
        '   SET status = $1, updated_at = NOW()\n' +
        '   WHERE id = $2`;',
      errors: err('status'),
    },
    // REGRESSION: table alias. Scored clean before this rule was fixed.
    {
      code: 'const q = `UPDATE stock_serials ss SET status = $1 WHERE ss.id = $2`;',
      errors: err('status'),
    },
    // REGRESSION: explicit AS alias.
    {
      code: 'const q = `UPDATE stock_serials AS s SET holder_id = $1 WHERE s.id = $2`;',
      errors: err('holder_id'),
    },
    // REGRESSION: `+` concatenation. Scored clean before this rule was fixed —
    // neither fragment contains both the UPDATE and the assignment.
    {
      code:
        'const q = `UPDATE stock_serials SET ` +\n' +
        '  `status = $1, holder_id = NULL ` +\n' +
        '  `WHERE id = $2`;',
      errors: err('status'),
    },
    // Concatenation with a non-static part in the middle: the unknown becomes
    // ${X} rather than aborting the scan, so the write is still caught.
    {
      code:
        'const q = "UPDATE stock_serials SET status = " + statusParam + " WHERE id = $1";',
      errors: err('status'),
    },
    // Aliased AND concatenated — both fixes have to hold at once.
    {
      code: 'const q = `UPDATE stock_serials ss SET ` + `holder_id = $1 WHERE ss.id = $2`;',
      errors: err('holder_id'),
    },
    // Plain string literal, not a template.
    {
      code: "const q = 'UPDATE stock_serials SET holder_id = NULL WHERE id = $1';",
      errors: err('holder_id'),
    },
    // A file that merely resembles an allow-listed name is not allow-listed.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: '/repo/src/services/notSerialLifecycle.helper.ts',
      errors: err('status'),
    },
  ],
});
