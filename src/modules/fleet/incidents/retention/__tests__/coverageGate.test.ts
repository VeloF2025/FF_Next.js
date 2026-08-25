/**
 * The deletion gate reads recorded coverage, not published rows (migration 530).
 *
 * The distinction these tests hold: "this month published no aggregates" and
 * "this month was never aggregated" are different facts, and only one of them
 * should stop a purge. Counting rows conflated them, and the quietest months —
 * the ones with nothing to publish — were the ones it stranded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ queryOne: mocks.queryOne, query: vi.fn(), transaction: vi.fn() }));

import { hasCompleteAggregateCoverage } from '../retentionRepository';

function lastSql(): string {
  return String(mocks.queryOne.mock.calls.at(-1)?.[0] ?? '');
}

function lastParams(): unknown[] {
  return (mocks.queryOne.mock.calls.at(-1)?.[1] ?? []) as unknown[];
}

beforeEach(() => { vi.clearAllMocks(); });

describe('hasCompleteAggregateCoverage', () => {
  it('reads the coverage table, not the aggregates', async () => {
    mocks.queryOne.mockResolvedValue({ total: 1 });
    await hasCompleteAggregateCoverage('2026-07-01', 1);
    expect(lastSql()).toMatch(/fleet_operational_aggregate_month_coverage/i);
    expect(lastSql()).not.toMatch(/fleet_operational_monthly_aggregates/i);
  });

  it('asks about the month under the metric version in force', async () => {
    mocks.queryOne.mockResolvedValue({ total: 1 });
    await hasCompleteAggregateCoverage('2026-07-01', 4);
    expect(lastParams()).toEqual(['2026-07-01', 4]);
  });

  /**
   * The defect, from the gate's side. A recorded month with zero published rows
   * is covered — that is a complete answer, not a missing one — and its detail
   * is now purgeable where before it was stranded forever.
   */
  it('treats a recorded month as covered even though it published nothing', async () => {
    mocks.queryOne.mockResolvedValue({ total: 1, row_count: 0 });
    await expect(hasCompleteAggregateCoverage('2026-07-01', 1)).resolves.toBe(true);
  });

  it('refuses a month that was never recorded', async () => {
    mocks.queryOne.mockResolvedValue({ total: 0 });
    await expect(hasCompleteAggregateCoverage('2026-07-01', 1)).resolves.toBe(false);
  });

  /**
   * Fails closed on an absent row. This gate authorises deletion, so the
   * unknown case has to be the refusing one.
   */
  it('refuses when the query returns nothing at all', async () => {
    mocks.queryOne.mockResolvedValue(null);
    await expect(hasCompleteAggregateCoverage('2026-07-01', 1)).resolves.toBe(false);
  });

  /**
   * A month covered under an older definition is not covered under the current
   * one: the stored numbers answer a different question until it is recomputed.
   * The version is part of the key rather than something a caller must remember
   * to clear.
   */
  it('does not let coverage under one metric version answer for another', async () => {
    mocks.queryOne.mockResolvedValue({ total: 0 });
    await expect(hasCompleteAggregateCoverage('2026-07-01', 2)).resolves.toBe(false);
    expect(lastParams()).toEqual(['2026-07-01', 2]);
  });

  /**
   * A database error must propagate, never be swallowed into `false` or `true`.
   * `false` would look like an ordinary uncovered month and hide an outage;
   * `true` would authorise deletion on no evidence at all.
   */
  it('propagates a query failure rather than answering', async () => {
    mocks.queryOne.mockRejectedValue(new Error('connection reset'));
    await expect(hasCompleteAggregateCoverage('2026-07-01', 1)).rejects.toThrow('connection reset');
  });
});
