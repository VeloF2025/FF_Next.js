import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runBulkLock: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: () => (handler: unknown) => handler,
}));
vi.mock('@/services/attendance/bulkActions', () => {
  class BulkConflict extends Error {
    constructor(message: string, public reason = 'bulk_conflict') { super(message); }
  }
  return {
    BulkAuthorityError: class BulkAuthorityError extends Error {},
    BulkConflict,
    BulkScopeViolation: class BulkScopeViolation extends Error { outOfScopeStaffIds = []; },
    BulkValidationError: class BulkValidationError extends Error {},
    validateReason: (value: unknown) => String(value).trim(),
    runBulkLock: mocks.runBulkLock,
  };
});

import handler from '../../../../../pages/api/staff/attendance-bulk-lock';
import { BulkConflict } from '@/services/attendance/bulkActions';

beforeEach(() => vi.clearAllMocks());

it('returns a stable all-or-none blocker reason for a failed bulk preflight', async () => {
  mocks.runBulkLock.mockRejectedValueOnce(
    new BulkConflict('Attendance period 2026-08-10 has blockers', 'period_has_blockers'),
  );
  const { res, captured } = response();
  await handler({
    method: 'POST', query: {}, headers: {},
    body: { week_start_dates: ['2026-08-03', '2026-08-10'], reason: 'Payroll batch ready' },
    user: { id: 'admin-1', role: 'admin' },
  } as unknown as NextApiRequest, res);

  expect(captured.statusCode).toBe(409);
  expect(captured.body).toMatchObject({
    error: { details: { reason: 'period_has_blockers' } },
  });
});

it('rejects a manager before the bulk lock service despite a stale middleware grant', async () => {
  const { res, captured } = response();
  await handler({
    method: 'POST', query: {}, headers: {},
    body: { week_start_dates: ['2026-08-03'], reason: 'Payroll batch ready' },
    user: { id: 'manager-1', role: 'manager' },
  } as unknown as NextApiRequest, res);

  expect(captured.statusCode).toBe(403);
  expect(mocks.runBulkLock).not.toHaveBeenCalled();
});

function response() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    send(body: unknown) { captured.body = body; return this; },
    setHeader() { return this; }, getHeader() { return undefined; },
  } as unknown as NextApiResponse;
  return { res, captured };
}
