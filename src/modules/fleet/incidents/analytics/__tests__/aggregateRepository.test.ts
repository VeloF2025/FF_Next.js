/**
 * Month replacement, and the change detection that decides whether to write.
 *
 * The trap here is the subset: a month that LOSES a row still matches on
 * membership alone, so a checksum-set comparison that only asks "is every new
 * checksum stored?" would treat a shrinking month as unchanged and leave the
 * removed row in place forever. That is tested explicitly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query, transaction: mocks.transaction }));

import { hasCompleteAggregateCoverage, replaceMonth } from '../aggregateRepository';
import { checksumForAggregate } from '../aggregateChecksum';
import type { ReleasedAggregate } from '../suppression';

function row(overrides: Partial<ReleasedAggregate> = {}): ReleasedAggregate {
  return {
    monthStart: '2026-07-01',
    metricVersion: 1,
    dimensionLevel: 'site',
    dimensionProjectId: 'p1',
    dimensionSiteId: 's1',
    generalizedFromLevel: null,
    metricKey: 'presence.confirmed_days',
    metricKind: 'ratio',
    numerator: 1,
    denominator: 2,
    histogram: null,
    contributorCount: 6,
    ...overrides,
  };
}

/** Captures the statements a transaction body issues, without a database. */
function captureTransaction(): { calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  mocks.transaction.mockImplementation(async (work: (c: unknown) => Promise<unknown>) => work({
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  }));
  return { calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
});

describe('replaceMonth', () => {
  it('writes nothing when the computed rows match what is stored', async () => {
    const rows = [row(), row({ dimensionSiteId: 's2' })];
    mocks.query.mockResolvedValue(rows.map((r) => ({ checksum: checksumForAggregate(r) })));
    const { calls } = captureTransaction();

    const result = await replaceMonth('2026-07-01', 1, rows, 'run-1');

    expect(result).toEqual({ changed: false, rowsWritten: 0 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('DOES write when a row disappears, even though every new checksum is stored', async () => {
    const kept = row();
    const dropped = row({ dimensionSiteId: 's2' });
    // Stored has both; computed has only one. Membership alone would say
    // "unchanged" and the dropped row would survive forever.
    mocks.query.mockResolvedValue([kept, dropped].map((r) => ({ checksum: checksumForAggregate(r) })));
    captureTransaction();

    const result = await replaceMonth('2026-07-01', 1, [kept], 'run-1');

    expect(result.changed).toBe(true);
    expect(result.rowsWritten).toBe(1);
  });

  it('clears the month, inserts the new rows, then retires other versions - in that order', async () => {
    mocks.query.mockResolvedValue([]);
    const { calls } = captureTransaction();

    await replaceMonth('2026-07-01', 2, [row({ metricVersion: 2 })], 'run-9');

    const kinds = calls.map((c) =>
      c.sql.includes('aggregates:clear') ? 'clear'
        : c.sql.includes('aggregates:insert') ? 'insert'
        : c.sql.includes('retire-other-versions') ? 'retire' : 'other');
    expect(kinds).toEqual(['clear', 'insert', 'retire']);
    expect(calls[2]?.params).toEqual(['2026-07-01', 2]);
    // Scoped to OTHER versions of this month. Without the exclusion the
    // statement would deactivate the rows the INSERT above just wrote, leaving
    // the month with no active rows at all -- which reads as "no coverage" and
    // blocks retention from ever purging it.
    expect(calls[2]?.sql).toContain('metric_version <> $2');
  });

  it('leaves this version active while retiring the previous one', async () => {
    mocks.query.mockResolvedValue([]);
    const { calls } = captureTransaction();

    await replaceMonth('2026-07-01', 2, [row({ metricVersion: 2 })], 'run-9');

    const insert = calls.find((c) => c.sql.includes('aggregates:insert'));
    // is_active sits immediately after contributor_count in INSERT_COLUMNS.
    expect(insert?.params.at(-3)).toBe(true);
  });

  it('writes the histogram columns all-or-nothing, as the CHECK requires', async () => {
    mocks.query.mockResolvedValue([]);
    const { calls } = captureTransaction();

    await replaceMonth('2026-07-01', 1, [
      row({
        metricKey: 'timing.acknowledgement', metricKind: 'duration_histogram', denominator: null,
        histogram: { sampleCount: 3, sumSeconds: 60, buckets: [3, 0, 0, 0, 0, 0] },
      }),
      row(),
    ], 'run-1');

    const inserts = calls.filter((c) => c.sql.includes('aggregates:insert'));
    // sample_count, sum_seconds and six buckets sit at indices 10..17.
    const timing = inserts[0]?.params.slice(10, 18);
    const plain = inserts[1]?.params.slice(10, 18);
    expect(timing).toEqual([3, 60, 3, 0, 0, 0, 0, 0]);
    expect(plain?.every((v) => v === null)).toBe(true);
  });
});

describe('hasCompleteAggregateCoverage', () => {
  it('is true only when active rows exist for that month and version', async () => {
    mocks.query.mockResolvedValue([{ row_count: '4' }]);
    await expect(hasCompleteAggregateCoverage('2026-07-01', 1)).resolves.toBe(true);

    mocks.query.mockResolvedValue([{ row_count: '0' }]);
    await expect(hasCompleteAggregateCoverage('2026-07-01', 1)).resolves.toBe(false);
  });

  it('fails closed when the count comes back empty', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(hasCompleteAggregateCoverage('2026-07-01', 1)).resolves.toBe(false);
  });
});
