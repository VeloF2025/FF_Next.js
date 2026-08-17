/**
 * Structural guard for `employmentWindowPredicate` — the Rule-P-free predicate.
 *
 * Rule P (`account_status <> 'pending'`) is a visibility rule. Applying it to
 * the reconciliation readers meant a pending worker who clocked in was never
 * reconciled at all: no summary, no hours, no record. The hours were lost rather
 * than hidden (Joseph Moremi, 2026-08-15, 24.1h — no summary row).
 *
 * Dropping Rule P from processing is only safe while it stays applied
 * everywhere a human reads. So the invariant this file protects is not "the
 * reconciler filters correctly" — it is "the Rule-P-free predicate is used ONLY
 * by the reconciliation entry readers". A unit test on one call site cannot
 * express that, so this walks the source.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import {
  employmentEffectivePredicate,
  employmentWindowPredicate,
} from '../employmentUniverse';

// Every directory that consumes the employment/Rule-P predicates. A new call
// site added in an unwalked directory would escape the allow-list below, so
// this list must stay wider than the set of current consumers.
const ROOTS = [
  'src/services/attendance',
  'src/modules/attendance',
  'src/modules/field-workers',
  'pages/api/staff',
  'pages/api/my',
  'pages/api/field',
];

/** The only files permitted to use the Rule-P-free predicate. */
const ALLOWED = new Set(['src/services/attendance/reconcileQueries.ts']);

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

describe('employmentWindowPredicate', () => {
  it('omits Rule P while keeping every employment-window term', () => {
    const window = employmentWindowPredicate('s', 'ds.work_date');

    expect(window).not.toContain('account_status');
    expect(window).toContain('s.is_active');
    expect(window).toContain('s.join_date');
    expect(window).toContain('s.end_date');
  });

  it('is exactly the effective predicate minus Rule P', () => {
    // Pins the relationship rather than the string: if a new employment term is
    // added to one, it must be added to the other, or this fails.
    const effective = employmentEffectivePredicate('s', 'ds.work_date');
    const window = employmentWindowPredicate('s', 'ds.work_date');

    expect(effective.startsWith(window)).toBe(true);
    expect(effective.slice(window.length)).toBe(
      " AND (s.account_status IS NULL OR LOWER(s.account_status) <> 'pending')",
    );
  });

  it('keeps Rule P out of processing but inside the predicate everyone else uses', () => {
    expect(employmentEffectivePredicate('s', 'ds.work_date')).toContain('account_status');
  });

  it('is used ONLY by the reconciliation entry readers', () => {
    const offenders = ROOTS
      .flatMap((root) => sourceFiles(root))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => {
        const src = readFileSync(file, 'utf8');
        // The definition itself lives in employmentUniverse.ts; ignore it.
        if (file.endsWith('employmentUniverse.ts')) return false;
        return src.includes('employmentWindowPredicate');
      });

    expect(offenders).toEqual([]);
  });

  it('leaves every other consumer on the Rule-P-bearing predicate', () => {
    // Sanity check that the allow-list above is not vacuously satisfied because
    // the walker found nothing: reports and workflow must still use the
    // effective predicate.
    const users = ROOTS
      .flatMap((root) => sourceFiles(root))
      .filter((file) => readFileSync(file, 'utf8').includes('employmentEffectivePredicate'))
      .filter((file) => !file.endsWith('employmentUniverse.ts'));

    expect(users.length).toBeGreaterThan(5);
  });
});
