/**
 * Structural guard for the attendance EXPECTED-day universe.
 *
 * The expectation CTEs are compared against each other at runtime:
 * `metricsSql()` gates `readyToLock` on `expectedDayCount === approvedDayCount`,
 * and `blockersSql()` raises `missing_daily_result` for every expected day with
 * no summary row. If one site counts a staff member as expected while the
 * reconciler no longer projects a day for them, that day can never be satisfied
 * and the payroll week can never lock.
 *
 * So the invariant is not "reconcileQueries filters correctly" — it is "every
 * `staff CROSS JOIN workdays` in the codebase filters identically". A unit test
 * on any single call site cannot express that; this walks the source instead, so
 * a new expectation CTE added later fails here rather than silently wedging the
 * weekly lock.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import {
  employmentEffectivePredicate,
  expectedAttendanceDayPredicate,
} from '../employmentUniverse';

const ROOTS = ['src/services/attendance', 'src/modules/attendance'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    out.push(full);
  }
  return out;
}

/** Every `staff CROSS JOIN workdays` occurrence, with the text that follows it. */
function expectationSites(): Array<{ file: string; line: number; window: string }> {
  const sites: Array<{ file: string; line: number; window: string }> = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(process.cwd(), root))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/CROSS JOIN workdays/.test(line)) return;
        // Prose describing the rule is not a call site.
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
        sites.push({
          file: file.slice(process.cwd().length + 1),
          line: i + 1,
          // The WHERE may be on the same line or several below it, separated by
          // JOINs and the SELECT list. Ten lines covers every current site with
          // room to spare; a site whose WHERE lands further away reads as
          // unfiltered here, which fails loudly rather than passing silently.
          window: lines.slice(i, i + 10).join('\n'),
        });
      });
    }
  }
  return sites;
}

describe('attendance expected-day universe', () => {
  it('composes attendance_tracked on top of the employment predicate', () => {
    const predicate = expectedAttendanceDayPredicate('s', 'w.work_date');

    expect(predicate).toContain('s.attendance_tracked = true');
    expect(predicate).toContain(employmentEffectivePredicate('s', 'w.work_date'));
  });

  it('finds every expectation CTE in the attendance modules', () => {
    // Guards the walker itself: if a refactor renames the CTE or moves these
    // files, the assertions below would vacuously pass over an empty list.
    // Five today — reconcileQueries, periodReadinessSql (metrics + blockers),
    // payrollLockSnapshot, payrollReadiness. Raise this when a site is added.
    expect(expectationSites().map((s) => `${s.file}:${s.line}`)).toHaveLength(5);
  });

  it('filters EVERY staff CROSS JOIN workdays by the shared expected-day predicate', () => {
    const unfiltered = expectationSites().filter(
      (site) => !site.window.includes('expectedAttendanceDayPredicate'),
    );

    expect(
      unfiltered.map((s) => `${s.file}:${s.line}`),
      'Every expectation CTE must use expectedAttendanceDayPredicate. An unfiltered ' +
        'one counts untracked staff as expected, so expectedDayCount can never equal ' +
        'approvedDayCount and the payroll week can never lock.',
    ).toEqual([]);
  });

  it('does not apply the expected-day predicate to row-driven queries', () => {
    // Entries, summaries, exceptions and adjustments must stay on the plain
    // employment predicate, so an untracked staff member who does clock in is
    // still reconciled, still approved, and still paid.
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(process.cwd(), root))) {
        // The predicate's own module declares and documents it.
        if (file.endsWith('employmentUniverse.ts')) continue;
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (!line.includes('expectedAttendanceDayPredicate(')) return;
          const code = line.trim();
          // Doc comments and the import list mention it by name without using it.
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
          // Every legitimate use sits in a workdays-based expectation CTE.
          if (/CROSS JOIN workdays|w\.work_date/.test(line)) return;
          offenders.push(`${file.slice(process.cwd().length + 1)}:${i + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
