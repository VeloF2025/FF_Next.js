/**
 * Handler tests for /api/staff/attendance-weekly-locks.
 *
 * Covers Monday enforcement, immutable history visibility, readiness-gated
 * lock routing, permissions, conflicts and audited unlock.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  userHasPermission: vi.fn(async () => true), // tests default to allow; opt-out tests override
  lockReadyWeek: vi.fn(),
  unlockWeekWithHistory: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/permissions', () => ({
  userHasPermission: mocks.userHasPermission,
}));
vi.mock('@/modules/attendance/workflow/periodQueries', () => ({
  lockReadyWeek: mocks.lockReadyWeek,
  unlockWeekWithHistory: mocks.unlockWeekWithHistory,
  AttendancePeriodError: class AttendancePeriodError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

import handler from '../../../../../pages/api/staff/attendance-weekly-locks';

function makeReq(
  body: Record<string, unknown> = {},
  method: string = 'POST',
  query: Record<string, string> = {},
  userId: string | null = 'admin-1',
  role = 'admin',
): NextApiRequest {
  const r: Partial<NextApiRequest> & { user?: { id: string; role: string } } = {
    method,
    query,
    headers: {},
    body,
  };
  if (userId) r.user = { id: userId, role };
  return r as NextApiRequest;
}

function makeRes() {
  const captured: { statusCode: number; body?: unknown; headers: Record<string, string> } = {
    statusCode: 200,
    headers: {},
  };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    send(d: unknown) { captured.body = d; return this; },
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    getHeader() { return undefined; },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lockReadyWeek.mockResolvedValue({
    weekStartDate: '2026-04-20', version: 1, active: true,
  });
  mocks.unlockWeekWithHistory.mockResolvedValue({
    weekStartDate: '2026-04-20', version: 1, active: false,
  });
});

describe('GET /api/staff/attendance-weekly-locks', () => {
  it('returns the exact Monday lock with immutable latest-history fields', async () => {
    const exact = {
      week_start_date: '2026-04-20',
      locked_at: '2026-04-21T09:00:00Z',
      locked_by: 'admin-1',
      lock_reason: 'payroll close',
      unlocked_at: '2026-04-22T09:00:00Z',
      unlocked_by: 'admin-2',
      unlock_reason: 'approved correction',
      lock_version: 7,
      latest_action: 'unlock',
      latest_actor_user_id: 'admin-2',
      latest_reason: 'approved correction',
      latest_recorded_at: '2026-04-22T09:00:00Z',
    };
    mocks.sql.mockResolvedValueOnce([exact]);
    const { res, captured } = makeRes();

    await handler(makeReq({}, 'GET', { week_start_date: '2026-04-20' }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ data: { lock: exact } });
    const sqlText = (mocks.sql.mock.calls[0]?.[0] as readonly string[]).join(' ');
    expect(sqlText).toMatch(/WHERE\s+wl\.week_start_date\s*=/i);
    expect(sqlText).toMatch(/attendance_weekly_lock_history/i);
    expect(sqlText).toMatch(/latest_actor_user_id/i);
    expect(sqlText).toMatch(/LIMIT\s+1/i);
    expect(mocks.sql.mock.calls[0]?.slice(1)).toEqual(['2026-04-20']);
  });

  it.each(['2026-04-22', '2026-02-30', '04-20-2026'])(
    'rejects exact-week read %s because it is not a real ISO Monday', async (weekStart) => {
    const { res, captured } = makeRes();

    await handler(makeReq({}, 'GET', { week_start_date: weekStart }), res);

    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('returns locks list', async () => {
    mocks.sql.mockResolvedValueOnce([
      {
        week_start_date: '2026-04-20',
        locked_at: '2026-04-21T09:00:00Z',
        locked_by: 'admin-1',
        lock_reason: 'export:csv',
        unlocked_at: null,
        unlocked_by: null,
        unlock_reason: null,
        lock_version: 1,
        latest_action: 'lock',
      },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { data: { locks: { week_start_date: string; lock_version: number }[] } };
    expect(body.data.locks[0]?.week_start_date).toBe('2026-04-20');
    expect(body.data.locks[0]?.lock_version).toBe(1);
    const sqlText = (mocks.sql.mock.calls[0]?.[0] as readonly string[]).join(' ');
    expect(sqlText).toMatch(/attendance_weekly_lock_history/i);
  });
});

describe('POST /api/staff/attendance-weekly-locks', () => {
  it('405 on unsupported method', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'DELETE'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('400 when week_start_date is not a Monday', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ week_start_date: '2026-04-22', action: 'lock' }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it("400 when action is neither 'lock' nor 'unlock'", async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ week_start_date: '2026-04-20', action: 'freeze' }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('routes lock through readiness-gated immutable history service', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start_date: '2026-04-20', action: 'lock', lock_reason: 'relock' }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.lockReadyWeek).toHaveBeenCalledWith({
      weekStartDate: '2026-04-20', actorUserId: 'admin-1', reason: 'relock',
    });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('site_supervisor (create:false) receives 403 when attempting to lock', async () => {
    mocks.userHasPermission.mockResolvedValueOnce(false);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start_date: '2026-04-20', action: 'lock', lock_reason: 'x' }), res);
    expect(captured.statusCode).toBe(403);
    // The lock upsert MUST NOT have been reached.
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('manager receives 403 even if a stale permission row still grants create', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq(
      { week_start_date: '2026-04-20', action: 'lock', lock_reason: 'payroll ready' },
      'POST', {}, 'manager-1', 'manager',
    ), res);
    expect(captured.statusCode).toBe(403);
    expect(mocks.userHasPermission).not.toHaveBeenCalled();
    expect(mocks.lockReadyWeek).not.toHaveBeenCalled();
  });

  it('site_supervisor (edit:false) receives 403 when attempting to unlock', async () => {
    mocks.userHasPermission.mockResolvedValueOnce(false);
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        week_start_date: '2026-04-20',
        action: 'unlock',
        unlock_reason: 'correction needed — HR approved',
      }),
      res
    );
    expect(captured.statusCode).toBe(403);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('lock happy path — upserts', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ week_start_date: '2026-04-20', action: 'lock', lock_reason: 'manual' }),
      res
    );
    expect(captured.statusCode).toBe(200);
  });

  it('uses the authenticated actor and ignores a body-supplied user id', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({
      week_start_date: '2026-04-20', action: 'lock', lock_reason: 'manual',
      actor_user_id: 'attacker-controlled-id',
    }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.lockReadyWeek).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'admin-1' }));
  });

  it('unlock requires reason ≥ 10 chars', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ week_start_date: '2026-04-20', action: 'unlock', unlock_reason: 'short' }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('unlock 404 when no active lock exists', async () => {
    mocks.unlockWeekWithHistory.mockRejectedValueOnce(
      Object.assign(new Error('No active lock'), { code: 'active_lock_required' })
    );
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        week_start_date: '2026-04-20',
        action: 'unlock',
        unlock_reason: 'correction needed — HR approved',
      }),
      res
    );
    expect(captured.statusCode).toBe(404);
  });

  it('unlock happy path — returns updated lock row', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        week_start_date: '2026-04-20',
        action: 'unlock',
        unlock_reason: 'correction needed — HR approved',
      }),
      res
    );
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { data: { lock: { active: boolean } } };
    expect(body.data.lock.active).toBe(false);
    expect(mocks.unlockWeekWithHistory).toHaveBeenCalledWith({
      weekStartDate: '2026-04-20', actorUserId: 'admin-1',
      reason: 'correction needed — HR approved',
    });
  });

  it('returns 409 with stable reason when readiness changes before lock', async () => {
    mocks.lockReadyWeek.mockRejectedValueOnce(
      Object.assign(new Error('Attendance period has blockers'), { code: 'period_has_blockers' })
    );
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start_date: '2026-04-20', action: 'lock', lock_reason: 'payroll ready' }), res);
    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({ error: { details: { reason: 'period_has_blockers' } } });
  });
});
