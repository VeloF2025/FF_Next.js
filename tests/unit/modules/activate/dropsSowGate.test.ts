/**
 * Regression guard: a WhatsApp submission must appear on the Activate dashboard
 * even when the SOW import never loaded its drop number.
 *
 * Every read path into dr_photo_unified_reviews gated on
 * `drop_number IN (SELECT drop_number FROM drops)`. `drops` is the SOW import,
 * not a register of what the field actually submitted — so a DR the import had
 * missed was invisible no matter how complete its submission was.
 *
 * Observed 2026-08-19: the THEMBIES Activations group posted 15 activations for
 * Themb'elihle; the dashboard showed 10. DR3022005, DR3022046, DR3022070,
 * DR3022071 and DR3022079 each had photos, both serials and a qa_photo_reviews
 * row, and none of them was in `drops`. Etwatwa (20/18) and Thembisa POP 1
 * (51/50) under-reported the same day.
 *
 * These tests capture the SQL each read path emits and assert the gate admits a
 * DR on either evidence — the SOW row OR the submission. They also assert the
 * `drops` half is still there: it is what keeps ~200 rows with no submission
 * behind them (Velo Test, Integration Test, Test Project) off the dashboard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: { query: (...args: unknown[]) => queryMock(...args) },
}));

import { calculateSummary } from '@/modules/activate/services/drops/dropStatsService';
import { getProjectStats } from '@/modules/activate/services/drops/dropProjectStatsService';
import { getPaginatedDrops } from '@/modules/activate/services/drops/dropQueryService';

const FILTERS = { dateFrom: '2026-08-19', dateTo: '2026-08-19' };

/** Every SQL string the service under test sent to the pool. */
function emittedSql(): string[] {
  return queryMock.mock.calls.map((c) => String(c[0]));
}

/** The statement that reads dr_photo_unified_reviews (not the OES ones). */
function unifiedQuery(): string {
  const matches = emittedSql().filter(
    (s) => s.includes('dr_photo_unified_reviews') && !s.includes('FROM oes_activations')
  );
  expect(matches.length, `expected a unified-reviews query, got:\n${emittedSql().join('\n--\n')}`)
    .toBeGreaterThan(0);
  return matches.join('\n');
}

/**
 * Empty result set, shaped so every caller survives it: getPaginatedDrops reads
 * `rows[0].count` off its COUNT query unconditionally, and a bare `rows: []`
 * throws there before the assertions ever see the SQL.
 */
function stubEmptyResults(): void {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ count: '0' }], rowCount: 0 });
}

beforeEach(stubEmptyResults);

const READ_PATHS: [string, () => Promise<unknown>][] = [
  ['summary card', () => calculateSummary(FILTERS)],
  ['per-project table', () => getProjectStats(FILTERS)],
  ['paginated list', () => getPaginatedDrops(1, 100, FILTERS)],
];

describe('Activate SOW gate', () => {
  it.each(READ_PATHS)('%s admits a DR evidenced only by its submission', async (_name, run) => {
    await run();
    const sql = unifiedQuery();

    // The bug: `drops` membership was the whole test, so a submission for a DR
    // the SOW import had missed could never be counted.
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM qa_photo_reviews/);
  });

  it.each(READ_PATHS)('%s still requires evidence — SOW row or submission', async (_name, run) => {
    await run();
    const sql = unifiedQuery();

    // Dropping the `drops` half would let ~200 rows with neither photos nor a
    // submission (Velo Test, Integration Test, Test Project) onto the board.
    expect(sql).toMatch(/IN \(SELECT drop_number FROM drops\)/);
    // OR, not AND: an AND would leave the 2026-08-19 undercount exactly as it was.
    expect(sql).toMatch(/FROM drops\)\s*OR EXISTS/);
  });

  it('applies one identical gate across all three read paths', async () => {
    const gates: string[] = [];

    for (const [, run] of READ_PATHS) {
      stubEmptyResults();
      await run();

      const match = unifiedQuery().match(
        /\(\s*(?:\w+\.)?drop_number IN \(SELECT drop_number FROM drops\)\s*OR EXISTS \(SELECT 1 FROM qa_photo_reviews q WHERE q\.drop_number = (?:\w+\.)?drop_number\)\)/
      );
      expect(match, 'read path does not emit the shared eligibility predicate').not.toBeNull();
      // Normalise the table alias — the list aliases the table as `u`, the
      // aggregates do not. Everything else must match byte for byte.
      gates.push((match?.[0] as string).replace(/\bu\./g, ''));
    }

    // Divergence here is how the 2026-08-19 undercount hid inside a correct-looking
    // total: card and table disagreeing reads as a rounding quirk, not a bug.
    expect(new Set(gates).size, `read paths emit different gates: ${gates.join(' | ')}`).toBe(1);
  });
});
