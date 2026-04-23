/**
 * Unit tests for the self-correction query helpers.
 *
 * Mocks `sql` so branches (status='all' vs a specific status, and the
 * count aggregator's default-zero behaviour) are exercised without a
 * DB. The SQL templates themselves are validated at runtime by the
 * reconcileSql integration suite against the live schema.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({
  sql: mocks.sql,
  transaction: vi.fn(),
}));

import {
  listOwnAdjustments,
  countOwnAdjustmentsByStatus,
} from '../queries';

const S = '00000000-0000-0000-0000-000000000001';

beforeEach(() => {
  mocks.sql.mockReset();
});

describe('listOwnAdjustments', () => {
  it('defaults to statusFilter="all" (pending-first ordering)', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    await listOwnAdjustments(S, 30);
    expect(mocks.sql).toHaveBeenCalledOnce();
    const template = mocks.sql.mock.calls[0]![0].join(' ');
    expect(template).toMatch(/CASE\s+a\.status\s+WHEN\s+'pending'/i);
    // No WHERE a.status = $N in the default branch.
    expect(template).not.toMatch(/AND\s+a\.status\s*=/i);
  });

  it('scoped branch adds WHERE a.status = $N (pending)', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    await listOwnAdjustments(S, 30, 'pending');
    const template = mocks.sql.mock.calls[0]![0].join(' ');
    expect(template).toMatch(/AND\s+a\.status\s*=/i);
    // Pending-first CASE is omitted in the filtered branch (all rows same status).
    expect(template).not.toMatch(/CASE\s+a\.status\s+WHEN\s+'pending'/i);
  });

  it('clamps limit to [1, 100]', async () => {
    mocks.sql.mockResolvedValue([]);

    await listOwnAdjustments(S, 0);
    // params (positional): [staffId, limit]
    expect(mocks.sql.mock.calls[0]!.slice(1)).toEqual([S, 1]);

    mocks.sql.mockReset();
    mocks.sql.mockResolvedValue([]);
    await listOwnAdjustments(S, 9999);
    expect(mocks.sql.mock.calls[0]!.slice(1)).toEqual([S, 100]);

    mocks.sql.mockReset();
    mocks.sql.mockResolvedValue([]);
    await listOwnAdjustments(S, 30);
    expect(mocks.sql.mock.calls[0]!.slice(1)).toEqual([S, 30]);
  });
});

describe('countOwnAdjustmentsByStatus', () => {
  it('defaults every status bucket to zero when no rows', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const counts = await countOwnAdjustmentsByStatus(S);
    expect(counts).toEqual({
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    });
  });

  it('fills in buckets from the GROUP BY rows (pg returns count as text)', async () => {
    mocks.sql.mockResolvedValueOnce([
      { status: 'pending', count: '3' },
      { status: 'approved', count: '12' },
    ]);
    const counts = await countOwnAdjustmentsByStatus(S);
    expect(counts).toEqual({
      pending: 3,
      approved: 12,
      rejected: 0,
      cancelled: 0,
    });
  });

  it('coerces the numeric text to Number (no string leakage)', async () => {
    mocks.sql.mockResolvedValueOnce([
      { status: 'rejected', count: '7' },
    ]);
    const counts = await countOwnAdjustmentsByStatus(S);
    expect(counts.rejected).toBe(7);
    expect(typeof counts.rejected).toBe('number');
  });
});
