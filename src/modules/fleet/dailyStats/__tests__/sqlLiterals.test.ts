/**
 * Two guards over the SQL in this module, both deliberately dumb.
 *
 * 1. A backtick inside a SQL comment terminates the JS template literal containing it. The file
 *    then fails to parse — but eslint reports nothing useful, the tests stay GREEN because
 *    consumers mock the module so it is never loaded, and only tsc catches it, as a cascade of
 *    TS1005 errors in a file whose SQL looks fine. The habit that causes it is quoting an
 *    identifier in prose. Copied from `trips/__tests__/sqlLiterals.test.ts`, which earned its
 *    dumbness twice over: an earlier version sliced from the opening backtick to the NEXT one —
 *    the stray — so the extracted text never contained the character it was hunting.
 *
 * 2. A conditional inside a SQL template literal (R3). `${cond ? sql`AND x` : sql``}` is broken in
 *    this repo through both the webpack shim and the `@/lib/db-pool` tag, and produces a
 *    MALFORMED QUERY rather than an error. Every optional predicate must be a whole separate
 *    statement, as `loadPositionsForWindow` is. The check bans ANY interpolation on a SQL line,
 *    which is stricter than the rule and impossible to get subtly wrong.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const MODULE_DIR = join(__dirname, '..');

const SQL_LINE = /\b(SELECT|INSERT INTO|DELETE FROM|WHERE|ORDER BY|LIMIT|VALUES|ON CONFLICT)\b/;

const files = readdirSync(MODULE_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f, readFileSync(join(MODULE_DIR, f), 'utf8')] as const);

function lines(): { file: string; line: number; text: string }[] {
  return files.flatMap(([file, src]) => src.split('\n').map((text, i) => ({ file, line: i + 1, text })));
}

describe('SQL template literals', () => {
  it('is not vacuous — the module does contain SQL to check', () => {
    const sqlLines = lines().filter((l) => SQL_LINE.test(l.text));
    const commentLines = lines().filter((l) => /^\s*--/.test(l.text));
    // Set below the current counts so ordinary edits do not trip them, high enough to notice if
    // the SQL or its comments were moved out from under the guard.
    expect(sqlLines.length).toBeGreaterThanOrEqual(20);
    expect(commentLines.length).toBeGreaterThanOrEqual(3);
  });

  it('no SQL comment anywhere in the module contains a backtick', () => {
    const offences = lines().filter((l) => /^\s*--/.test(l.text) && l.text.includes('`'));
    expect(offences.map((o) => `${o.file}:${o.line} ${o.text.trim()}`)).toEqual([]);
  });

  it('no SQL line interpolates anything — an optional predicate is a whole statement', () => {
    const offences = lines().filter((l) => SQL_LINE.test(l.text) && l.text.includes('${'));
    expect(offences.map((o) => `${o.file}:${o.line} ${o.text.trim()}`)).toEqual([]);
  });
});
