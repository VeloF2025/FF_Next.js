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
    // The allow-listed owner of the state machine. Filenames here are repo-
    // relative because that is what the rule compares against; ESLint's
    // absolute path is made relative to the project root before matching.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: 'src/modules/procurement/field-stock/services/serialLifecycle.ts',
    },
    // The allow-listed force-correct service.
    {
      code: 'const q = `UPDATE stock_serials SET holder_id = $1 WHERE id = $2`;',
      filename: 'src/modules/procurement/field-stock/services/serialForceCorrectService.ts',
    },
    // The same file reached by an absolute path, as ESLint actually supplies it.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: require('path').join(
        process.cwd(),
        'src/modules/procurement/field-stock/services/serialLifecycle.ts',
      ),
    },
    // An allow-listed script, likewise.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: 'scripts/backfill-stock-serials-activated-from-oes.ts',
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
    // REGRESSION: a boundary keyword appearing inside an earlier column's VALUE.
    // The lazy capture stops at the leftmost boundary whichever alternative it
    // is, so "from" in a notes string ended the SET clause before `status`.
    // "received from" and "moved from" are ordinary stock-movement phrasing.
    {
      code:
        "const q = `UPDATE stock_serials SET notes = 'Received from warehouse', " +
        "status = $1 WHERE id = $2`;",
      errors: err('status'),
    },
    // Same class, different boundary keyword — WHERE inside a value.
    {
      code:
        "const q = `UPDATE stock_serials SET notes = 'unknown where it went', " +
        "holder_id = $1 WHERE id = $2`;",
      errors: err('holder_id'),
    },
    // A file that merely resembles an allow-listed name is not allow-listed.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: 'src/services/notSerialLifecycle.helper.ts',
      errors: err('status'),
    },
    // REGRESSION: the allow-list is by path, not by basename. While the entries
    // were end-anchored only (/serialLifecycle\.ts$/), any file anywhere in the
    // repo could exempt itself from the rule purely by choosing that name —
    // including a brand-new one added in the same PR as the write it hides.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: 'src/some/unrelated/module/serialLifecycle.ts',
      errors: err('status'),
    },
    {
      code: 'const q = `UPDATE stock_serials SET holder_id = $1 WHERE id = $2`;',
      filename: 'src/elsewhere/serialForceCorrectService.ts',
      errors: err('holder_id'),
    },
    // REGRESSION: the second attempt at the fix anchored with `(^|\/)`, which
    // is a path-SEGMENT boundary rather than the repo root — so re-creating the
    // whole directory chain under any prefix restored the same exemption. The
    // path is now resolved relative to the project root and anchored with `^`.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: 'evil/src/modules/procurement/field-stock/services/serialLifecycle.ts',
      errors: err('status'),
    },
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: 'vendor/x/scripts/cleanup-serial-drift-2026-05-28.ts',
      errors: err('status'),
    },
    // The same attack as an ABSOLUTE path — which is the only shape real ESLint
    // ever supplies. The two cases above pass bare relative strings, so they
    // never reach repoRelative()'s path.relative() branch at all: they fail to
    // match `^src/...` for the trivial reason that "evil/src/..." does not start
    // with "src/", which would stay true even if that branch were broken.
    // Without this case, a future change to the absolute-path handling could
    // silently reopen the nested-prefix hole with every other test still green.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: require('path').join(
        process.cwd(),
        'evil/src/modules/procurement/field-stock/services/serialLifecycle.ts',
      ),
      errors: err('status'),
    },
    // A file outside the project root cannot be located against the allow-list,
    // so it is treated as not allow-listed rather than silently exempt.
    {
      code: 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;',
      filename: '/somewhere/else/src/modules/procurement/field-stock/services/serialLifecycle.ts',
      errors: err('status'),
    },
  ],
});

// ---------------------------------------------------------------------------
// The allow-list must not depend on the caller's working directory.
//
// RuleTester cannot express this: ESLint 8 gives it no per-case `cwd`, and it
// defaults to process.cwd(), which is the checkout root on every test run — so
// the entire cwd-mismatch class is invisible to the cases above. An earlier
// version anchored against context.getCwd() and passed all of them while
// reporting the allow-listed owner file as a violation whenever ESLint was
// invoked from anywhere but the root: 0 violations from the root, 2 from src/.
//
// A false positive here is worse than the evasion the anchoring exists to
// close — it fails the gate on correct code — so it is pinned with a direct
// Linter run, with the process cwd deliberately moved away from the root.
// ---------------------------------------------------------------------------
{
  const { Linter } = require('eslint');
  const os = require('os');
  const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
  const OWNER = path.join(
    REPO_ROOT,
    'src/modules/procurement/field-stock/services/serialLifecycle.ts',
  );
  const CODE = 'const q = `UPDATE stock_serials SET status = $1 WHERE id = $2`;';

  const linter = new Linter();
  linter.defineRule('no-direct-serial-status-write', rule);

  const lintFrom = (cwd) => {
    const previous = process.cwd();
    process.chdir(cwd);
    try {
      return linter.verify(
        CODE,
        {
          parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
          rules: { 'no-direct-serial-status-write': 'error' },
        },
        { filename: OWNER },
      );
    } finally {
      process.chdir(previous);
    }
  };

  for (const [label, cwd] of [
    ['repo root', REPO_ROOT],
    ['<root>/src', path.join(REPO_ROOT, 'src')],
    ['parent of root', path.dirname(REPO_ROOT)],
    ['os tmpdir', os.tmpdir()],
  ]) {
    const messages = lintFrom(cwd);
    const label2 = `allow-listed owner file stays exempt with cwd = ${label}`;
    if (messages.length === 0) {
      console.log(`  ✓ ${label2}`);
    } else {
      console.error(`  ✗ ${label2}\n    got ${messages.length} violation(s): ${messages[0].message}`);
      process.exitCode = 1;
    }
  }
}
