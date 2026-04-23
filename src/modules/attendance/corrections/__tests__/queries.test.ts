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
  countSupervisedAdjustmentsByStatus,
  cancelOwnAdjustment,
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

describe('cancelOwnAdjustment', () => {
  it('returns the cancelled row when the atomic UPDATE succeeds', async () => {
    mocks.sql.mockResolvedValueOnce([
      { id: 'a-1', status: 'cancelled', review_note: 'self-cancelled by staff' },
    ]);
    const row = await cancelOwnAdjustment({ adjustmentId: 'a-1', staffId: S });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('cancelled');
    expect(row!.review_note).toBe('self-cancelled by staff');
  });

  it('returns null when the UPDATE matches zero rows (wrong owner / non-pending)', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const row = await cancelOwnAdjustment({ adjustmentId: 'a-1', staffId: S });
    expect(row).toBeNull();
  });

  it('SQL enforces ownership + pending status in a single atomic UPDATE', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    await cancelOwnAdjustment({ adjustmentId: 'a-1', staffId: S });
    const template = mocks.sql.mock.calls[0]![0].join(' ');
    // Ownership via JOIN to attendance_entries. The `sql` mock receives
    // raw template strings with holes — `$N` placeholders appear only
    // after tag interpolation. Assert the structural SQL and that the
    // staff-id parameter lands in the params list (verified in the
    // parameterisation test below).
    expect(template).toMatch(/FROM\s+attendance_entries\s+e/i);
    expect(template).toMatch(/e\.staff_id\s*=/i);
    // Pending-only precondition in the same statement:
    expect(template).toMatch(/a\.status\s*=\s*'pending'/i);
    // Writes the self-cancelled audit note:
    expect(template).toMatch(/review_note\s*=\s*'self-cancelled by staff'/i);
  });

  it('parameterises the adjustment_id and staff_id positionally', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    await cancelOwnAdjustment({ adjustmentId: 'a-1', staffId: S });
    const params = mocks.sql.mock.calls[0]!.slice(1);
    expect(params).toContain('a-1');
    expect(params).toContain(S);
  });
});

describe('countSupervisedAdjustmentsByStatus', () => {
  it('null scope → no filter (super_admin / admin path)', async () => {
    mocks.sql.mockResolvedValueOnce([
      { status: 'pending', count: '8' },
      { status: 'approved', count: '27' },
    ]);
    const counts = await countSupervisedAdjustmentsByStatus(null);
    expect(counts).toEqual({ pending: 8, approved: 27, rejected: 0, cancelled: 0 });
    const template = mocks.sql.mock.calls[0]![0].join(' ');
    expect(template).not.toMatch(/WHERE\s+e\.staff_id/i);
  });

  it('undefined scope behaves like null (callers that forget the arg)', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const counts = await countSupervisedAdjustmentsByStatus(undefined);
    expect(counts).toEqual({ pending: 0, approved: 0, rejected: 0, cancelled: 0 });
    const template = mocks.sql.mock.calls[0]![0].join(' ');
    expect(template).not.toMatch(/WHERE\s+e\.staff_id/i);
  });

  it('empty array → all-zeros, short-circuits without a DB round-trip', async () => {
    const counts = await countSupervisedAdjustmentsByStatus([]);
    expect(counts).toEqual({ pending: 0, approved: 0, rejected: 0, cancelled: 0 });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('scoped array → WHERE e.staff_id = ANY(uuid[])', async () => {
    mocks.sql.mockResolvedValueOnce([
      { status: 'pending', count: '3' },
    ]);
    const counts = await countSupervisedAdjustmentsByStatus([S, 'other']);
    expect(counts.pending).toBe(3);
    const template = mocks.sql.mock.calls[0]![0].join(' ');
    expect(template).toMatch(/WHERE\s+e\.staff_id\s*=\s*ANY/i);
    expect(template).toMatch(/uuid\[\]/i);
  });
});
