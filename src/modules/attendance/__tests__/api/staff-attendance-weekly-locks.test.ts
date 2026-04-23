/**
 * Handler tests for /api/staff/attendance-weekly-locks.
 *
 * Covers Monday enforcement, unlock-reason length requirement, and list/upsert
 * routing.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  userHasPermission: vi.fn(async () => true), // tests default to allow; opt-out tests override
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

import handler from '../../../../../pages/api/staff/attendance-weekly-locks';

function makeReq(
  body: Record<string, unknown> = {},
  method: string = 'POST',
  query: Record<string, string> = {},
  userId: string | null = 'admin-1'
): NextApiRequest {
  const r: Partial<NextApiRequest> & { user?: { id: string } } = {
    method,
    query,
    headers: {},
    body,
  };
  if (userId) r.user = { id: userId };
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
});

describe('GET /api/staff/attendance-weekly-locks', () => {
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
      },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { data: { locks: { week_start_date: string }[] } };
    expect(body.data.locks[0]?.week_start_date).toBe('2026-04-20');
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

  it('re-lock after unlock clears the unlocked_at/by/reason audit fields in the UPSERT SQL', async () => {
    // Regression: lookupActiveLock filters WHERE unlocked_at IS NULL. If the
    // re-lock upsert ever stops clearing unlocked_*, a week that was
    // unlocked then re-locked would still return null from lookupActiveLock
    // — UI + APIs would silently treat a locked week as unlocked.
    mocks.sql.mockResolvedValueOnce([
      {
        week_start_date: '2026-04-20', locked_at: 'x', locked_by: 'admin-1',
        lock_reason: 'manual', unlocked_at: null, unlocked_by: null, unlock_reason: null,
      },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start_date: '2026-04-20', action: 'lock', lock_reason: 'relock' }), res);
    expect(captured.statusCode).toBe(200);
    const call = mocks.sql.mock.calls[0] as [readonly string[], ...unknown[]];
    const sqlText = call[0].join(' ');
    expect(sqlText).toMatch(/ON\s+CONFLICT\s*\(week_start_date\)\s+DO\s+UPDATE/i);
    expect(sqlText).toMatch(/unlocked_at\s*=\s*NULL/i);
    expect(sqlText).toMatch(/unlocked_by\s*=\s*NULL/i);
    expect(sqlText).toMatch(/unlock_reason\s*=\s*NULL/i);
  });

  it('site_supervisor (create:false) receives 403 when attempting to lock', async () => {
    mocks.userHasPermission.mockResolvedValueOnce(false);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start_date: '2026-04-20', action: 'lock', lock_reason: 'x' }), res);
    expect(captured.statusCode).toBe(403);
    // The lock upsert MUST NOT have been reached.
    expect(mocks.sql).not.toHaveBeenCalled();
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
    mocks.sql.mockResolvedValueOnce([
      {
        week_start_date: '2026-04-20',
        locked_at: '2026-04-22T10:00:00Z',
        locked_by: 'admin-1',
        lock_reason: 'manual',
        unlocked_at: null,
        unlocked_by: null,
        unlock_reason: null,
      },
    ]);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ week_start_date: '2026-04-20', action: 'lock', lock_reason: 'manual' }),
      res
    );
    expect(captured.statusCode).toBe(200);
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
    mocks.sql.mockResolvedValueOnce([]); // unlockWeek returns empty
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
    mocks.sql.mockResolvedValueOnce([
      {
        week_start_date: '2026-04-20',
        locked_at: '2026-04-21T09:00:00Z',
        locked_by: 'admin-1',
        lock_reason: 'export:csv',
        unlocked_at: '2026-04-22T10:00:00Z',
        unlocked_by: 'hr-1',
        unlock_reason: 'correction needed — HR approved',
      },
    ]);
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
    const body = captured.body as { data: { lock: { unlocked_at: string } } };
    expect(body.data.lock.unlocked_at).toBe('2026-04-22T10:00:00Z');
  });
});
