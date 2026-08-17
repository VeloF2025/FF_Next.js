/**
 * Structural guard: every `attendance_daily_summaries` read on the exec
 * overview endpoint must carry Rule P.
 *
 * `/api/staff/attendance-overview` is org-wide and HR-facing — `loadTopOvertimeThisWeek`
 * returns staff by full name. It applied Rule P nowhere, which was latent only
 * because pending workers had no summary rows at all. Once the reconciler began
 * projecting them, an unapproved worker's name and overtime hours could reach
 * the dashboard.
 *
 * The queries are inline tagged templates inside the handler, so there is no
 * seam to assert generated SQL against without a live database. A source guard
 * is the honest alternative: it cannot prove the SQL is correct, but it does
 * fail if a future edit adds a summaries read without the predicate, which is
 * the regression that actually happened here.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const FILE = 'pages/api/staff/attendance-overview.ts';
const SUMMARY_READ = /FROM attendance_daily_summaries/g;

describe('attendance-overview Rule P guard', () => {
  const src = readFileSync(FILE, 'utf8');

  it('reads attendance_daily_summaries in the places this guard assumes', () => {
    // Pins the shape the count assertion below depends on. If a read is added
    // or removed, this fails first and says so, rather than the next test
    // passing for the wrong reason.
    expect(src.match(SUMMARY_READ)).toHaveLength(4);
  });

  it('guards every summaries read with Rule P', () => {
    // Each read must be followed by the predicate before the next read begins.
    const segments = src.split(/FROM attendance_daily_summaries/).slice(1);

    const unguarded = segments
      .map((segment, i) => ({ i, guarded: segment.includes('approvedAccountPredicate') }))
      .filter((s) => !s.guarded)
      .map((s) => s.i);

    expect(unguarded).toEqual([]);
  });

  it('imports the predicate from the shared module rather than inlining the SQL', () => {
    // An inlined `account_status <> 'pending'` would drift from the canonical
    // rule and would not be found by the hrVisibility audit sweep.
    expect(src).toContain("from '@/lib/staff/hrVisibilityFilters'");
    expect(src).not.toMatch(/account_status\s*<>\s*'pending'/);
  });
});
