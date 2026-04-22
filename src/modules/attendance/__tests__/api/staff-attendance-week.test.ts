/**
 * Handler tests for GET /api/staff/attendance-week.
 *
 * Covers Monday enforcement, roll-up summation, duplicate-row invariant,
 * and the unresolved-only exceptions filter shape.
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

import handler from '../../../../../pages/api/staff/attendance-week';

function makeReq(query: Record<string, string> = {}, method: string = 'GET'): NextApiRequest {
  return { method, query, headers: {}, socket: {} } as unknown as NextApiRequest;
}

function makeRes() {
  const captured: {
    statusCode: number;
    body?: unknown;
    headers: Record<string, string>;
  } = { statusCode: 200, headers: {} };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    send(d: unknown) { captured.body = d; return this; },
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    getHeader() { return undefined; },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    staff_id: overrides.staff_id ?? 's1',
    employee_id: overrides.employee_id ?? 'EMP1',
    full_name: overrides.full_name ?? 'Alice Example',
    work_date: overrides.work_date ?? '2026-04-20',
    regular_hrs: overrides.regular_hrs ?? '8',
    overtime_hrs: overrides.overtime_hrs ?? '0',
    sunday_hrs: overrides.sunday_hrs ?? '0',
    holiday_hrs: overrides.holiday_hrs ?? '0',
    night_hrs: overrides.night_hrs ?? '0',
    exceptions_count: overrides.exceptions_count ?? 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/staff/attendance-week', () => {
  it('405 on non-GET', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'DELETE'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('400 on malformed week_start', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: 'not-a-date' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('400 when week_start is not a Monday', async () => {
    const { res, captured } = makeRes();
    // 2026-04-22 is a Wednesday
    await handler(makeReq({ week_start: '2026-04-22' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('rolls up per-day buckets into weekTotals per staff', async () => {
    mocks.sql.mockResolvedValueOnce([
      row({ staff_id: 's1', full_name: 'Alice', work_date: '2026-04-20', regular_hrs: '8', overtime_hrs: '0' }),
      row({ staff_id: 's1', full_name: 'Alice', work_date: '2026-04-21', regular_hrs: '9', overtime_hrs: '2', night_hrs: '3' }),
      row({ staff_id: 's2', full_name: 'Bob',   work_date: '2026-04-20', regular_hrs: '7', overtime_hrs: '0' }),
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20' }), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      success: true;
      data: {
        staff: Array<{ staffId: string; fullName: string; days: unknown[]; weekTotals: { regularHrs: number; overtimeHrs: number; nightHrs: number } }>;
        totals: { regularHrs: number; overtimeHrs: number; nightHrs: number; staffCount: number };
      };
    };
    const alice = body.data.staff.find((s) => s.staffId === 's1')!;
    expect(alice.days).toHaveLength(2);
    expect(alice.weekTotals.regularHrs).toBe(17);
    expect(alice.weekTotals.overtimeHrs).toBe(2);
    expect(alice.weekTotals.nightHrs).toBe(3);

    const bob = body.data.staff.find((s) => s.staffId === 's2')!;
    expect(bob.weekTotals.regularHrs).toBe(7);

    expect(body.data.totals.regularHrs).toBe(24);
    expect(body.data.totals.overtimeHrs).toBe(2);
    expect(body.data.totals.staffCount).toBe(2);
  });

  it('staff returned sorted alphabetically by full_name', async () => {
    mocks.sql.mockResolvedValueOnce([
      row({ staff_id: 's-zoe', full_name: 'Zoe Zebra' }),
      row({ staff_id: 's-ada', full_name: 'Ada Anteater' }),
      row({ staff_id: 's-bob', full_name: 'Bob Badger' }),
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20' }), res);
    const body = captured.body as {
      data: { staff: Array<{ fullName: string }> };
    };
    expect(body.data.staff.map((s) => s.fullName)).toEqual([
      'Ada Anteater',
      'Bob Badger',
      'Zoe Zebra',
    ]);
  });

  it('exceptions_count subquery filters to unresolved (resolved_at IS NULL)', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const { res } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20' }), res);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const [strings] = mocks.sql.mock.calls[0] as [readonly string[], ...unknown[]];
    const sqlText = strings.join(' ');
    expect(sqlText).toMatch(/resolved_at\s+IS\s+NULL/i);
  });

  it('500 when the DB returns duplicate (staff_id, work_date) rows — invariant violation', async () => {
    // Defence-in-depth — the DB PK prevents this today but a future join
    // change could duplicate. Must NOT silently double-count.
    mocks.sql.mockResolvedValueOnce([
      row({ staff_id: 's1', work_date: '2026-04-20', regular_hrs: '8' }),
      row({ staff_id: 's1', work_date: '2026-04-20', regular_hrs: '8' }),
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20' }), res);
    expect(captured.statusCode).toBe(500);
  });

  it('empty result returns staff=[] and zeroed totals', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20' }), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      data: { staff: unknown[]; totals: { regularHrs: number; staffCount: number } };
    };
    expect(body.data.staff).toEqual([]);
    expect(body.data.totals.regularHrs).toBe(0);
    expect(body.data.totals.staffCount).toBe(0);
  });
});
