/**
 * Handler tests for GET /api/staff/attendance-roster.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '../../../../../pages/api/staff/attendance-roster';

function makeReq(query: Record<string, string> = {}, method: string = 'GET'): NextApiRequest {
  return { method, query, headers: {}, socket: {} } as unknown as NextApiRequest;
}
function makeRes() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    setHeader() {},
    getHeader() {},
  };
  return { res: res as unknown as NextApiResponse, captured };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/staff/attendance-roster', () => {
  it('405 on non-GET', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'PATCH'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('categorises rows correctly (entry_id-first branching)', async () => {
    mocks.sql.mockResolvedValue([
      { staff_id: 's1', full_name: 'A', phone: '+27821111111', home_site_id: null, home_site_name: null,
        entry_id: 'e1', clock_in_at: '2026-04-20T06:00:00Z', clock_out_at: null, status: 'open',
        open_exception_count: 0, site_name: 'Site A' },
      { staff_id: 's2', full_name: 'B', phone: null, home_site_id: null, home_site_name: null,
        entry_id: 'e2', clock_in_at: '2026-04-20T06:00:00Z', clock_out_at: '2026-04-20T14:00:00Z',
        status: 'closed', open_exception_count: 0, site_name: null },
      { staff_id: 's3', full_name: 'C', phone: null, home_site_id: null, home_site_name: null,
        entry_id: null, clock_in_at: null, clock_out_at: null, status: null,
        open_exception_count: 0, site_name: null },
      { staff_id: 's4', full_name: 'D', phone: null, home_site_id: null, home_site_name: null,
        entry_id: 'e4', clock_in_at: '2026-04-20T06:00:00Z', clock_out_at: null, status: 'open',
        open_exception_count: 2, site_name: 'Site D' },
    ]);

    const { res, captured } = makeRes();
    await handler(makeReq({ date: '2026-04-20' }), res);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      success: true;
      data: { roster: Array<{ staffId: string; category: string }>; summary: Record<string, number> };
    };
    const byId = Object.fromEntries(body.data.roster.map((r) => [r.staffId, r.category]));
    expect(byId).toEqual({
      s1: 'on_shift',
      s2: 'clocked_out',
      s3: 'absent',
      s4: 'exception', // exceptions outrank 'open'
    });
    expect(body.data.summary.onShift).toBe(1);
    expect(body.data.summary.clockedOut).toBe(1);
    expect(body.data.summary.absent).toBe(1);
    expect(body.data.summary.exceptions).toBe(1);
  });

  it('data-integrity: row with entry_id but NULL status is routed to "exception", NOT silently "absent"', async () => {
    // Regression guard: the original categoriser mis-bucketed these as
    // absent because the fallthrough checked `status` truthiness before
    // `entry_id`. That would silently hide real shifts from supervisors.
    mocks.sql.mockResolvedValue([
      { staff_id: 's1', full_name: 'A', phone: null, home_site_id: null, home_site_name: null,
        entry_id: 'e1', clock_in_at: '2026-04-20T06:00:00Z', clock_out_at: null, status: null,
        open_exception_count: 0, site_name: null },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ date: '2026-04-20' }), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      success: true;
      data: { roster: Array<{ staffId: string; category: string }> };
    };
    expect(body.data.roster[0]!.category).toBe('exception');
  });

  it('defaults to today in SAST when date is missing or malformed', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res, captured } = makeRes();
    await handler(makeReq({ date: 'not-a-date' }), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { success: true; data: { workDate: string } };
    expect(body.data.workDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('500 when the DB rejects', async () => {
    mocks.sql.mockRejectedValue(new Error('pg down'));
    const { res, captured } = makeRes();
    await handler(makeReq({}), res);
    expect(captured.statusCode).toBe(500);
  });
});
