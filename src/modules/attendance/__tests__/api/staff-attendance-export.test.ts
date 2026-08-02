import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttendancePayrollExportError } from '@/services/attendance/payroll/types';

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));

vi.mock('@/services/attendance/payroll/exportService', () => ({
  preparePayrollExport: mocks.prepare,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: () => (handler: unknown) => handler,
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import handler from '../../../../../pages/api/staff/attendance-export';

const ROW = {
  staff_id: 'staff-1', employee_id: 'EMP001', full_name: 'Alice Example',
  work_date: '2026-08-03', ordinary_hours: '8.00', overtime_hours: '0.00',
  sunday_hours: '0.00', public_holiday_hours: '0.00', approved_leave_hours: '0.00',
  sick_leave_hours: '0.00', unpaid_hours: '0.00', project_id: '', site_id: '',
  lock_version: '3', audit_reference: 'attendance:staff-1:2026-08-03:result-v8:lock-v3',
};
const TOTALS = {
  ordinary_hours: '8.00', overtime_hours: '0.00', sunday_hours: '0.00',
  public_holiday_hours: '0.00', approved_leave_hours: '0.00',
  sick_leave_hours: '0.00', unpaid_hours: '0.00',
};

function request(query: Record<string, string> = {}, role = 'admin', method = 'GET') {
  return { method, query, body: {}, headers: {}, cookies: {}, user: {
    id: 'admin-1', userId: 'admin-1', email: 'admin@example.com', firstName: 'HR',
    lastName: 'Admin', name: 'HR Admin', role, permissions: [], isActive: true,
  } } as unknown as NextApiRequest;
}

function response() {
  const capture: { status: number; body?: unknown; headers: Record<string, string> } =
    { status: 200, headers: {} };
  const res = {
    status(code: number) { capture.status = code; return this; },
    json(body: unknown) { capture.body = body; return this; },
    send(body: unknown) { capture.body = body; return this; },
    setHeader(name: string, value: string) { capture.headers[name.toLowerCase()] = value; },
    getHeader() { return undefined; },
  } as unknown as NextApiResponse;
  return { res, capture };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/staff/attendance-export', () => {
  it('validates method, Monday, format and positive lock version before service work', async () => {
    for (const [query, method] of [
      [{ week_start: '2026-08-03', format: 'csv', lock_version: '3' }, 'POST'],
      [{ week_start: '2026-08-04', format: 'csv', lock_version: '3' }, 'GET'],
      [{ week_start: '2026-08-03', format: 'pdf', lock_version: '3' }, 'GET'],
      [{ week_start: '2026-08-03', format: 'csv', lock_version: '0' }, 'GET'],
    ] as const) {
      const { res, capture } = response();
      await handler(request(query, 'admin', method), res);
      expect(capture.status).toBe(method === 'POST' ? 405 : 400);
    }
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it.each(['manager', 'site_supervisor', 'viewer'])('denies %s even if stale permission middleware admits it', async (role) => {
    const { res, capture } = response();
    await handler(request({ week_start: '2026-08-03', format: 'csv', lock_version: '3' }, role), res);
    expect(capture.status).toBe(403);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('returns exact guarded rows and totals for dry-run without attachment bytes', async () => {
    mocks.prepare.mockResolvedValue({ dryRun: true, format: 'csv', lockVersion: 3,
      rowCount: 1, rows: [ROW], totals: TOTALS });
    const { res, capture } = response();
    await handler(request({ week_start: '2026-08-03', format: 'csv', lock_version: '3', dry_run: 'true' }), res);

    expect(mocks.prepare).toHaveBeenCalledWith({ weekStartDate: '2026-08-03', format: 'csv',
      actorUserId: 'admin-1', expectedLockVersion: 3, dryRun: true });
    expect(capture.body).toMatchObject({ data: { dryRun: true, rows: [ROW], totals: TOTALS } });
    expect(capture.headers['content-disposition']).toBeUndefined();
  });

  it('streams no success bytes before service persisted readback completes', async () => {
    let resolve!: (value: unknown) => void;
    mocks.prepare.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { res, capture } = response();
    const pending = handler(request({ week_start: '2026-08-03', format: 'csv', lock_version: '3' }), res);
    await Promise.resolve();
    expect(capture.body).toBeUndefined();

    resolve({ dryRun: false, exportId: 'export-1', format: 'csv', lockVersion: 3,
      rowCount: 1, rows: [ROW], totals: TOTALS, sha256: 'a'.repeat(64),
      bytes: Buffer.from('locked-bytes'), filename: 'attendance-week-2026-08-03-v3.csv',
      storagePath: 'attendance/payroll-exports/file.csv' });
    await pending;
    expect(capture.status).toBe(200);
    expect(capture.body).toEqual(Buffer.from('locked-bytes'));
    expect(capture.headers['x-attendance-export-sha256']).toBe('a'.repeat(64));
  });

  it.each([
    ['period_locked', 409], ['export_version_conflict', 409],
    ['empty_period', 409], ['forbidden', 403], ['storage_failed', 500],
  ] as const)('maps %s failure and streams no attachment', async (code, status) => {
    mocks.prepare.mockRejectedValue(new AttendancePayrollExportError(code, `failed:${code}`));
    const { res, capture } = response();
    await handler(request({ week_start: '2026-08-03', format: 'csv', lock_version: '3' }), res);
    expect(capture.status).toBe(status);
    expect(capture.headers['content-disposition']).toBeUndefined();
  });
});
