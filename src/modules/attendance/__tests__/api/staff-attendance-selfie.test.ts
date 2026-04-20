/**
 * Handler tests for GET /api/staff/attendance-selfie.
 *
 * Security-sensitive contract: logSelfieAccess MUST be called BEFORE the
 * response fires (audit on intent, not on successful byte delivery).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  logSelfieAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/middleware', () => ({
  // Pass-through that injects a fake user onto req so the handler can read
  // it via `as AuthenticatedNextApiRequest`.
  withAuth: (h: (r: NextApiRequest, s: NextApiResponse) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) => {
      (req as unknown as { user: { id: string; role: string } }).user = { id: 'admin-1', role: 'super_admin' };
      return h(req, res);
    },
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/modules/attendance/portal/retentionUtils', async () => {
  const actual =
    await vi.importActual<typeof import('@/modules/attendance/portal/retentionUtils')>(
      '@/modules/attendance/portal/retentionUtils'
    );
  return {
    ...actual,
    logSelfieAccess: mocks.logSelfieAccess,
  };
});

import handler from '../../../../../pages/api/staff/attendance-selfie';

const VALID_UUID = '11111111-2222-3333-4444-555555555555';

function makeReq(query: Record<string, string>, method: string = 'GET'): NextApiRequest {
  return {
    method,
    query,
    headers: { 'x-forwarded-for': '203.0.113.5' },
    socket: { remoteAddress: '10.0.0.1' },
  } as unknown as NextApiRequest;
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
  mocks.logSelfieAccess.mockResolvedValue(undefined);
});

describe('GET /api/staff/attendance-selfie', () => {
  it('405 on non-GET', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ entryId: VALID_UUID, kind: 'in' }, 'POST'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('400 when entryId is malformed', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ entryId: 'no', kind: 'in' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('400 when kind is not in|out', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ entryId: VALID_UUID, kind: 'sideways' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('404 when the entry does not exist', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res, captured } = makeRes();
    await handler(makeReq({ entryId: VALID_UUID, kind: 'in' }), res);
    expect(captured.statusCode).toBe(404);
    expect(mocks.logSelfieAccess).not.toHaveBeenCalled();
  });

  it('404 with reason=unavailable when the requested selfie URL is null (never captured or retention-swept)', async () => {
    mocks.sql.mockResolvedValue([{ id: VALID_UUID, selfie_in_url: null, selfie_out_url: null }]);
    const { res, captured } = makeRes();
    await handler(makeReq({ entryId: VALID_UUID, kind: 'in' }), res);
    expect(captured.statusCode).toBe(404);
    const body = captured.body as { success: false; error: { details?: { reason?: string } } };
    expect(body.error.details?.reason).toBe('unavailable');
    expect(mocks.logSelfieAccess).not.toHaveBeenCalled();
  });

  it('503 with reason=audit_write_failed when the POPIA audit INSERT throws — URL is NOT returned', async () => {
    const { AuditWriteError } = await import('@/modules/attendance/portal/retentionUtils');
    mocks.sql.mockResolvedValue([
      { id: VALID_UUID, selfie_in_url: '/storage/attendance/u/2026-04-20/in.jpg', selfie_out_url: null },
    ]);
    mocks.logSelfieAccess.mockRejectedValue(new AuditWriteError('boom'));
    const { res, captured } = makeRes();
    await handler(makeReq({ entryId: VALID_UUID, kind: 'in' }), res);
    expect(captured.statusCode).toBe(503);
    const body = captured.body as { success: false; error: { details?: { reason?: string } } };
    expect(body.error.details?.reason).toBe('audit_write_failed');
    // URL must NOT leak into the response body on an audit failure.
    expect(JSON.stringify(body)).not.toMatch(/in\.jpg/);
  });

  it('logs access with viewer id + ip + context BEFORE returning the URL', async () => {
    mocks.sql.mockResolvedValue([
      { id: VALID_UUID, selfie_in_url: '/storage/attendance/u/2026-04-20/in.jpg', selfie_out_url: null },
    ]);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ entryId: VALID_UUID, kind: 'in', context: 'staff_detail' }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.logSelfieAccess).toHaveBeenCalledWith({
      entryId: VALID_UUID,
      selfieType: 'in',
      viewedBy: 'admin-1',
      ipAddress: '203.0.113.5',
      context: 'staff_detail',
    });
    const body = captured.body as { success: true; data: { url: string; kind: string } };
    expect(body.data.url).toMatch(/in\.jpg$/);
    expect(body.data.kind).toBe('in');
  });

  it('serves the out URL when kind=out', async () => {
    mocks.sql.mockResolvedValue([
      { id: VALID_UUID, selfie_in_url: null, selfie_out_url: '/storage/attendance/u/2026-04-20/out.jpg' },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ entryId: VALID_UUID, kind: 'out' }), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { success: true; data: { url: string } };
    expect(body.data.url).toMatch(/out\.jpg$/);
  });

  it('500 when the DB rejects', async () => {
    mocks.sql.mockRejectedValue(new Error('pg down'));
    const { res, captured } = makeRes();
    await handler(makeReq({ entryId: VALID_UUID, kind: 'in' }), res);
    expect(captured.statusCode).toBe(500);
  });
});
