/**
 * Unit tests for canSuperviseStaff.
 *
 * Mocks `sql` so the tests can exercise every branch without touching
 * Postgres. The recursive CTE itself is validated at runtime by the
 * reconcileSql integration test suite (PR #1401) being extended, and
 * by live calls from the 4 callers in production — those surface any
 * real-schema drift.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthUser } from '@/lib/auth/types';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  getStaffIdForUser: vi.fn(),
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/services/staff/staffAccessService', () => ({
  getStaffIdForUser: mocks.getStaffIdForUser,
}));

import {
  canSuperviseStaff,
  authorizedToSuperviseStaff,
  staffIdsSupervisedBy,
} from '../supervisorScope';

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u-1',
    userId: 'u-1',
    email: 'u@example.com',
    firstName: 'U',
    lastName: 'One',
    name: 'U One',
    role: 'technician',
    permissions: [],
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.sql.mockReset();
  mocks.getStaffIdForUser.mockReset();
});

const V = '11111111-1111-1111-1111-111111111111';
const T = '22222222-2222-2222-2222-222222222222';

describe('canSuperviseStaff', () => {
  it('returns true when viewer === target (self)', async () => {
    const ok = await canSuperviseStaff(V, V);
    expect(ok).toBe(true);
    // Branch-short-circuits: no DB round-trip for self.
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('returns false when either id is empty', async () => {
    expect(await canSuperviseStaff('', T)).toBe(false);
    expect(await canSuperviseStaff(V, '')).toBe(false);
    expect(await canSuperviseStaff('', '')).toBe(false);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('returns true when the SQL gate reports allowed=true (reports_to or department branch)', async () => {
    mocks.sql.mockResolvedValueOnce([{ allowed: true }]);
    expect(await canSuperviseStaff(V, T)).toBe(true);
    expect(mocks.sql).toHaveBeenCalledOnce();
  });

  it('returns false when the SQL gate reports allowed=false', async () => {
    mocks.sql.mockResolvedValueOnce([{ allowed: false }]);
    expect(await canSuperviseStaff(V, T)).toBe(false);
  });

  it('returns false on empty rows (defensive: should not happen, but cheap to defend)', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    expect(await canSuperviseStaff(V, T)).toBe(false);
  });
});

describe('authorizedToSuperviseStaff (auth-aware wrapper)', () => {
  it('super_admin bypasses scope entirely (no DB calls)', async () => {
    const ok = await authorizedToSuperviseStaff(
      authUser({ role: 'super_admin' }),
      T
    );
    expect(ok).toBe(true);
    expect(mocks.getStaffIdForUser).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('admin bypasses scope entirely (no DB calls)', async () => {
    const ok = await authorizedToSuperviseStaff(authUser({ role: 'admin' }), T);
    expect(ok).toBe(true);
    expect(mocks.getStaffIdForUser).not.toHaveBeenCalled();
  });

  it('denies when user has no linked staff record', async () => {
    mocks.getStaffIdForUser.mockResolvedValueOnce(null);
    const ok = await authorizedToSuperviseStaff(
      authUser({ role: 'manager' }),
      T
    );
    expect(ok).toBe(false);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('resolves viewer staff_id then delegates to canSuperviseStaff', async () => {
    mocks.getStaffIdForUser.mockResolvedValueOnce(V);
    mocks.sql.mockResolvedValueOnce([{ allowed: true }]);
    const ok = await authorizedToSuperviseStaff(
      authUser({ role: 'manager' }),
      T
    );
    expect(ok).toBe(true);
    expect(mocks.getStaffIdForUser).toHaveBeenCalledWith('u-1');
    expect(mocks.sql).toHaveBeenCalledOnce();
  });

  it('returns false when targetStaffId is empty', async () => {
    const ok = await authorizedToSuperviseStaff(
      authUser({ role: 'manager' }),
      ''
    );
    expect(ok).toBe(false);
    expect(mocks.getStaffIdForUser).not.toHaveBeenCalled();
  });
});

describe('staffIdsSupervisedBy', () => {
  it('returns [] when viewerStaffId is empty (no DB round-trip)', async () => {
    const ids = await staffIdsSupervisedBy('');
    expect(ids).toEqual([]);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('maps returned rows to their ids', async () => {
    mocks.sql.mockResolvedValueOnce([
      { id: V },
      { id: T },
      { id: 'x' },
    ]);
    const ids = await staffIdsSupervisedBy(V);
    expect(ids).toEqual([V, T, 'x']);
    expect(mocks.sql).toHaveBeenCalledOnce();
  });

  it('returns [] when the SQL returns no rows (viewer has no supervisees)', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const ids = await staffIdsSupervisedBy(V);
    expect(ids).toEqual([]);
  });
});
