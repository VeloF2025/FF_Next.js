/**
 * Coverage recording (migration 530).
 *
 * The defect being closed: a month can be aggregated fully and correctly and
 * publish nothing — the release rule withholds a metric whose support is empty
 * rather than storing a roster-sized zero. The old gate counted published rows,
 * so those months reported no coverage forever and their detail was never
 * purged.
 *
 * Everything here is about the one property that makes a row in the coverage
 * table trustworthy: it is written in the same transaction as the aggregate
 * rows it attests to, and it is written whether or not there were any.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query, transaction: mocks.transaction }));

import { replaceMonth } from '../aggregateRepository';
import type { ReleasedAggregate } from '../suppression';

const RUN = '77777777-7777-4777-8777-777777777777';

function row(overrides: Partial<ReleasedAggregate> = {}): ReleasedAggregate {
  return {
    monthStart: '2026-07-01', metricVersion: 1, dimensionLevel: 'project',
    dimensionProjectId: 'p1', dimensionSiteId: null, metricKey: 'presence.confirmed_days',
    metricKind: 'ratio', numerator: 1, denominator: 2, histogram: null, contributorCount: 6,
    ...overrides,
  };
}

interface Statement { sql: string; params: unknown[] }

/** Captures the statements the transaction body issues, without a database. */
function captureTransaction(): { calls: Statement[] } {
  const calls: Statement[] = [];
  mocks.transaction.mockImplementation(async (work: (c: unknown) => Promise<unknown>) => work({
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  }));
  return { calls };
}

function coverageStatements(calls: Statement[]): Statement[] {
  return calls.filter((call) => /aggregate_month_coverage/i.test(call.sql));
}

beforeEach(() => {
  vi.clearAllMocks();
  // No stored checksums, so every month below counts as changed unless a test
  // arranges otherwise.
  mocks.query.mockResolvedValue([]);
});

describe('replaceMonth records coverage', () => {
  it('writes exactly one coverage statement for the month', async () => {
    const captured = captureTransaction();
    await replaceMonth('2026-07-01', 1, [row()], RUN);
    expect(coverageStatements(captured.calls)).toHaveLength(1);
  });

  /**
   * The whole defect, as a test. A month with nothing publishable is still a
   * month that was aggregated, and the gate must be able to say so.
   */
  it('records coverage for a month that publishes no rows at all', async () => {
    const captured = captureTransaction();
    await replaceMonth('2026-07-01', 1, [], RUN);
    const [coverage] = coverageStatements(captured.calls);
    expect(coverage).toBeDefined();
    expect(coverage?.params).toEqual(expect.arrayContaining([1, '2026-07-01', RUN, 0]));
  });

  /**
   * An unchanged month skips the delete and the inserts — but it is still
   * covered, and the run that confirmed it is still the latest to have done so.
   * `replaceMonth` already applies this reasoning to its retirement statement.
   */
  it('records coverage even when the month is unchanged and nothing is written', async () => {
    const stored = row();
    const { checksumForAggregate } = await import('../aggregateChecksum');
    mocks.query.mockResolvedValue([{ checksum: checksumForAggregate(stored) }]);
    const captured = captureTransaction();

    const result = await replaceMonth('2026-07-01', 1, [stored], RUN);

    expect(result.changed).toBe(false);
    expect(captured.calls.some((call) => /INSERT INTO fleet_operational_monthly_aggregates\b/i.test(call.sql))).toBe(false);
    expect(coverageStatements(captured.calls)).toHaveLength(1);
  });

  it('names the month, the definition and the run that covered it', async () => {
    const captured = captureTransaction();
    await replaceMonth('2026-05-01', 3, [row({ monthStart: '2026-05-01', metricVersion: 3 })], RUN);
    const [coverage] = coverageStatements(captured.calls);
    expect(coverage?.params).toEqual(expect.arrayContaining([3, '2026-05-01', RUN]));
  });

  /**
   * The nightly job re-aggregates every month in the recalculation window, so
   * the same key is written every night. A plain INSERT would fail on the
   * second run and take the whole month's transaction with it.
   */
  it('upserts, so a month re-aggregated tomorrow does not collide with today', async () => {
    const captured = captureTransaction();
    await replaceMonth('2026-07-01', 1, [row()], RUN);
    const [coverage] = coverageStatements(captured.calls);
    expect(coverage?.sql).toMatch(/ON CONFLICT/i);
    expect(coverage?.sql).toMatch(/DO UPDATE/i);
  });

  /**
   * The property that makes the gate trustworthy. Coverage asserts "these rows
   * exist"; if it could commit while they did not, the gate would authorise
   * deleting detail against an aggregate that was never written.
   */
  it('writes coverage inside the same transaction as the rows, never outside it', async () => {
    const captured = captureTransaction();
    await replaceMonth('2026-07-01', 1, [row()], RUN);

    // Every coverage statement came through the transaction client...
    expect(coverageStatements(captured.calls)).toHaveLength(1);
    // ...and none through the pool. `mocks.query` is the pool, and its only
    // legitimate use here is the checksum read before the transaction opens.
    for (const call of mocks.query.mock.calls) {
      expect(String(call[0])).not.toMatch(/aggregate_month_coverage/i);
    }
  });

  /**
   * Ordering, which is the mechanism behind the guarantee above: coverage is
   * the last statement in the transaction, so anything that throws before it
   * leaves no coverage row behind to be believed.
   */
  it('orders coverage after the row inserts', async () => {
    const captured = captureTransaction();
    await replaceMonth('2026-07-01', 1, [row()], RUN);
    const insertAt = captured.calls.findIndex((call) => /INSERT INTO fleet_operational_monthly_aggregates\b/i.test(call.sql));
    const coverageAt = captured.calls.findIndex((call) => /aggregate_month_coverage/i.test(call.sql));
    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(coverageAt).toBeGreaterThan(insertAt);
  });
});
