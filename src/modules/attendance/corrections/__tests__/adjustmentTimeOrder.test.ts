/**
 * Unit tests for the ordering guard on the shared adjustment writer.
 *
 * `insertAdjustment` is exported through the corrections barrel, so it is a
 * writer any future caller can reach. Migration 482 rejects a reversed pair at
 * the storage layer; without a matching guard here that rejection arrives as a
 * raw SQLSTATE 23514 and surfaces to the caller as a 500. This asserts the
 * writer refuses the row before it ever reaches Postgres.
 *
 * Only the pair the adjustment itself carries is checkable here — a one-sided
 * correction must be judged against the raw entry, which this writer does not
 * load. That check lives in pages/api/field/attendance-adjust.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({
  sql: mocks.sql,
  transaction: vi.fn(),
}));

import { insertAdjustment, AdjustmentTimeOrderError } from '../adjustmentMutations';

const BASE = {
  entryId: '00000000-0000-0000-0000-0000000000e1',
  requestedBy: '00000000-0000-0000-0000-0000000000s1',
  adjustmentKind: 'wrong_clock_in_time' as const,
  adjustedSiteGeofenceId: null,
  reason: 'Correcting the recorded shift times',
};

beforeEach(() => {
  mocks.sql.mockReset();
  mocks.sql.mockResolvedValue([{ id: 'adj-1' }]);
});

describe('insertAdjustment — clock ordering', () => {
  it('refuses a reversed pair before touching the database', async () => {
    await expect(
      insertAdjustment({
        ...BASE,
        adjustedClockInAt: new Date('2026-05-18T05:00:00Z'),
        adjustedClockOutAt: new Date('2026-05-15T15:30:00Z'),
      })
    ).rejects.toBeInstanceOf(AdjustmentTimeOrderError);

    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('refuses a zero-length shift', async () => {
    const t = new Date('2026-05-15T05:00:00Z');
    await expect(
      insertAdjustment({ ...BASE, adjustedClockInAt: t, adjustedClockOutAt: t })
    ).rejects.toBeInstanceOf(AdjustmentTimeOrderError);

    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('carries a code the caller can map to a 400', async () => {
    const err = await insertAdjustment({
      ...BASE,
      adjustedClockInAt: new Date('2026-05-18T05:00:00Z'),
      adjustedClockOutAt: new Date('2026-05-15T15:30:00Z'),
    }).catch((e: unknown) => e);

    expect((err as AdjustmentTimeOrderError).code).toBe('adjustment_time_order');
  });

  it('writes a normally ordered shift', async () => {
    await insertAdjustment({
      ...BASE,
      adjustedClockInAt: new Date('2026-05-15T05:00:00Z'),
      adjustedClockOutAt: new Date('2026-05-15T15:30:00Z'),
    });

    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });

  it('writes a shift ending after midnight the next day', async () => {
    await insertAdjustment({
      ...BASE,
      adjustedClockInAt: new Date('2026-05-15T21:00:00Z'),
      adjustedClockOutAt: new Date('2026-05-16T05:00:00Z'),
    });

    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });

  it('leaves one-sided corrections to the caller', async () => {
    // Nothing to compare against here — rejecting would break
    // forgot_clock_out, which is the common correction.
    await insertAdjustment({
      ...BASE,
      adjustedClockInAt: null,
      adjustedClockOutAt: new Date('2026-05-15T15:30:00Z'),
    });
    await insertAdjustment({
      ...BASE,
      adjustedClockInAt: new Date('2026-05-15T05:00:00Z'),
      adjustedClockOutAt: null,
    });

    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });
});
