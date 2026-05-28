/**
 * RuleTester coverage for the local/no-direct-serial-status-write ESLint rule
 * (Sprint E Track 3). The rule ships disabled in .eslintrc.json ("off") and is
 * flipped to "error" at cutover, so these tests exercise the rule logic
 * directly via RuleTester independent of the configured severity.
 */
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rule = require('../../scripts/eslint-rules/no-direct-serial-status-write');

// Map RuleTester's lifecycle onto vitest so individual cases report as tests.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
});

ruleTester.run('no-direct-serial-status-write', rule, {
  valid: [
    // Innocent SELECT — no match.
    {
      code: 'const q = sql`SELECT status, holder_id FROM stock_serials WHERE id = $1`;',
      filename: 'pages/api/foo.ts',
    },
    // UPDATE on a different table — must not fire.
    {
      code: 'const q = sql`UPDATE drops SET status = $1 WHERE id = $2`;',
      filename: 'pages/api/foo.ts',
    },
    // Allowed owner file may write directly (template literal).
    {
      code: 'const q = sql`UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: 'src/modules/procurement/field-stock/services/serialLifecycle.ts',
    },
    // Allowed owner file (force-correct service).
    {
      code: "const q = `UPDATE stock_serials SET holder_id = '$1' WHERE id = '$2'`;",
      filename: 'src/modules/procurement/field-stock/services/serialForceCorrectService.ts',
    },
    // Allowed backfill script.
    {
      code: 'const q = sql`UPDATE stock_serials SET status = $1`;',
      filename: 'scripts/backfill-serial-lifecycle-status.ts',
    },
  ],
  invalid: [
    // Direct status write in a normal API route — template literal.
    {
      code: 'const q = sql`UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: 'pages/api/foo.ts',
      errors: [{ messageId: 'noDirectWrite', data: { column: 'status' } }],
    },
    // Direct holder_id write — template literal.
    {
      code: 'const q = sql`UPDATE stock_serials SET holder_id = $1 WHERE id = $2`;',
      filename: 'pages/api/foo.ts',
      errors: [{ messageId: 'noDirectWrite', data: { column: 'holder_id' } }],
    },
    // Interpolated SET value still matches (quasis joined).
    {
      code: 'const q = sql`UPDATE stock_serials SET status = ${newStatus} WHERE id = ${id}`;',
      filename: 'src/modules/procurement/field-stock/services/scanSerialService.ts',
      errors: [{ messageId: 'noDirectWrite', data: { column: 'status' } }],
    },
    // Plain string literal (not a template) is also caught.
    {
      code: "const q = 'UPDATE stock_serials SET status = active';",
      filename: 'pages/api/bar.ts',
      errors: [{ messageId: 'noDirectWrite', data: { column: 'status' } }],
    },
  ],
});
