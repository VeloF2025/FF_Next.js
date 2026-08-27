/**
 * A guard against a mistake made three times in two days.
 *
 * A backtick inside a SQL comment terminates the JS template literal containing it. The file then
 * fails to parse — but eslint reports nothing useful, the tests stay GREEN because consumers mock
 * the module so it is never loaded, and only tsc catches it, as a cascade of TS1005 errors in a
 * file whose SQL looks fine. The habit that causes it is quoting an identifier in prose.
 *
 * The check is deliberately dumb: a SQL comment line may not contain a backtick. No parsing, no
 * region detection, nothing to get subtly wrong.
 *
 * Two earlier versions of this file are the reason it is dumb. The first sliced from the opening
 * backtick to the NEXT one — which is the stray — so the extracted text never contained the
 * character it was hunting, and it passed against a deliberately reintroduced bug. The second
 * matched the enclosing call by a hardcoded indentation, so its region ran past the end of
 * multi-literal expressions and swept up unrelated backticks, failing on correct code. A guard is
 * worth having only once you have watched it both pass and fail for the right reasons.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const MODULE_DIR = join(__dirname, '..');

interface Offence { file: string; line: number; text: string }

/** SQL comment lines (`-- ...`) that contain a backtick. */
function offencesIn(file: string, source: string): Offence[] {
  return source.split('\n').flatMap((text, i) => (
    /^\s*--/.test(text) && text.includes('`')
      ? [{ file, line: i + 1, text: text.trim() }]
      : []
  ));
}

const files = readdirSync(MODULE_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f, readFileSync(join(MODULE_DIR, f), 'utf8')] as const);

describe('SQL template literals', () => {
  it('is not vacuous — the module does contain SQL comment lines to check', () => {
    const commentLines = files.reduce(
      (n, [, src]) => n + src.split('\n').filter((l) => /^\s*--/.test(l)).length, 0,
    );
    // Guards against the check becoming meaningless if the SQL comments are ever removed. Set
    // below the current count so ordinary edits do not trip it, high enough to notice their loss.
    expect(commentLines).toBeGreaterThanOrEqual(3);
  });

  it('no SQL comment anywhere in the module contains a backtick', () => {
    const offences = files.flatMap(([name, src]) => offencesIn(name, src));
    // Reported with file:line so a failure names the line to fix rather than just failing.
    expect(offences.map((o) => `${o.file}:${o.line} ${o.text}`)).toEqual([]);
  });
});
