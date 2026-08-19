/**
 * Regression guard for the Activate dashboard card/table discrepancy.
 *
 * The "Total Drops" card (calculateSummary) and the "Numbers per Project" table
 * (getProjectStats) read the same table with the same filters, but built their
 * date predicate from different column expressions:
 *
 *   calculateSummary  -> COALESCE(submitted_date, created_at::DATE)
 *   getProjectStats   -> submitted_date            <-- bug
 *
 * `submitted_date` is nullable, so `submitted_date >= $1` evaluates to NULL for
 * those rows and they vanish from the per-project breakdown while still being
 * counted by the card. Observed in production on 2026-08-01 as 93 vs 92; on
 * 2026-07-29 the same drift would have hidden 125 of 170 rows.
 *
 * These tests capture the SQL each service actually emits and assert the two
 * date predicates are identical.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: { query: (...args: unknown[]) => queryMock(...args) },
}));

import { calculateSummary } from '@/modules/activate/services/drops/dropStatsService';
import { getProjectStats } from '@/modules/activate/services/drops/dropProjectStatsService';

const FILTERS = { dateFrom: '2026-08-01', dateTo: '2026-08-01' };

/** The query that counts rows in dr_photo_unified_reviews (not the OES ones). */
function findInstalledQuery(): string {
  const sqls = queryMock.mock.calls.map((c) => String(c[0]));
  const installed = sqls.filter(
    (s) => s.includes('FROM dr_photo_unified_reviews') && !s.includes('FROM oes_activations')
  );
  expect(installed).toHaveLength(1);
  return installed[0] as string;
}

/**
 * Extracts the column expression the date filter is applied to.
 *
 * Anchored past the FROM clause: the SELECT list contains `COUNT(*) FILTER (WHERE ...)`
 * aggregates, so matching on the first `WHERE` picks up the wrong one.
 */
function dateExpression(sql: string): string {
  const body = sql.split('FROM dr_photo_unified_reviews')[1] as string;
  expect(body, `no FROM clause found in:\n${sql}`).toBeDefined();
  const match = body.match(/WHERE\s+(.+?)\s*>=\s*\$1::DATE/s);
  expect(match, `no date predicate found in:\n${sql}`).not.toBeNull();
  return (match?.[1] as string).trim();
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
});

describe('Activate stats date column', () => {
  it('per-project stats filter on an expression that survives NULL submitted_date', async () => {
    await getProjectStats(FILTERS);
    const expr = dateExpression(findInstalledQuery());

    // The bug: filtering on the bare nullable column drops NULL rows entirely.
    expect(expr).not.toBe('submitted_date');
    expect(expr).toContain('created_at');
  });

  it('summary and per-project stats use the identical date expression', async () => {
    await calculateSummary(FILTERS);
    const summaryExpr = dateExpression(findInstalledQuery());

    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });

    await getProjectStats(FILTERS);
    const projectExpr = dateExpression(findInstalledQuery());

    expect(projectExpr).toBe(summaryExpr);
  });

  it('both services apply the same row-exclusion filters', async () => {
    await calculateSummary(FILTERS);
    const summarySql = findInstalledQuery();

    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });

    await getProjectStats(FILTERS);
    const projectSql = findInstalledQuery();

    // Any divergence in these re-opens the same class of card/table mismatch.
    for (const clause of [
      '(is_oes_only = FALSE OR is_oes_only IS NULL)',
      // Eligibility: SOW row OR WhatsApp submission. See dropsSowGate.test.ts —
      // this list only checks the two services agree, not that the gate is right.
      'drop_number IN (SELECT drop_number FROM drops) OR EXISTS (SELECT 1 FROM qa_photo_reviews q WHERE q.drop_number = drop_number)',
      "LOWER(COALESCE(project, '')) NOT IN ('marketing', 'marketing activations', 'unknown', 'test', 'velo test', 'integration test', 'test project')",
    ]) {
      expect(summarySql).toContain(clause);
      expect(projectSql).toContain(clause);
    }
  });
});
