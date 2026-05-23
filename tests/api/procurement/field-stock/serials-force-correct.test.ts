/**
 * Unit tests for POST /api/procurement/field-stock/serials/force-correct.
 *
 * Exercises the HTTP boundary only — the service layer is mocked so we
 * can assert all 4xx/5xx paths and the success envelope independently.
 * Real-DB integration coverage lives at
 * tests/db/services/field-stock/forceCorrectSerials.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { forceCorrectMock } = vi.hoisted(() => ({ forceCorrectMock: vi.fn() }));

// Mock @/lib/auth so the test can drive 401 (no user) and 403 (user lacks
// permission) without booting the real JWT/DB stack. The mock mirrors the
// production reject shape so handler-internal apiResponse usage is unchanged.
type AnyHandler = (req: any, res: any) => unknown | Promise<unknown>;
vi.mock('@/lib/auth', () => ({
  withAuth(h: AnyHandler) {
    return async function withAuthWrapped(req: any, res: any) {
      if (!req.user) {
        return res
          .status(401)
          .json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      }
      return h(req, res);
    };
  },
  withPermission(permKey: string, _action: string) {
    return function permFactory(h: AnyHandler) {
      return async function withPermissionWrapped(req: any, res: any) {
        const u = req.user;
        if (u && u.role !== 'super_admin' && u._mockPermitted !== true) {
          return res
            .status(403)
            .json({ success: false, error: { code: 'FORBIDDEN', message: `Missing required permission: ${permKey}` } });
        }
        return h(req, res);
      };
    };
  },
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/procurement/field-stock/services/serialForceCorrectService', () => ({
  forceCorrectSerials: forceCorrectMock,
}));

import handler from '../../../../pages/api/procurement/field-stock/serials/force-correct';

interface CapturedRes extends Partial<NextApiResponse> {
  statusCode?: number;
  jsonData?: unknown;
  headers?: Record<string, string>;
}

function makeRes(): NextApiResponse & CapturedRes {
  const res: CapturedRes = { headers: {} };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as NextApiResponse;
  });
  res.json = vi.fn((data: unknown) => {
    res.jsonData = data;
    return res as NextApiResponse;
  });
  res.setHeader = vi.fn((name: string, value: string | number | readonly string[]) => {
    res.headers![name] = String(value);
    return res as NextApiResponse;
  });
  return res as NextApiResponse & CapturedRes;
}

// super_admin bypasses withPermission, so all existing happy-path tests keep working.
const DEFAULT_USER = { id: 'user-uuid-001', name: 'Test Admin', role: 'super_admin' as const };

// Sentinel to opt OUT of attaching a user (default param can't distinguish
// "omitted" from "explicit undefined").
const NO_USER = Symbol('NO_USER');

function makeReq(
  method: string,
  body: Record<string, unknown> = {},
  user: Record<string, unknown> | typeof NO_USER = DEFAULT_USER,
): NextApiRequest {
  const req: Record<string, unknown> = { method, body, headers: {} };
  if (user !== NO_USER) req.user = user;
  return req as unknown as NextApiRequest;
}

const VALID_BODY = {
  serials: ['SN-001', 'SN-002'],
  target: { status: 'available' },
  reason: 'Correcting misrouted serials from last deployment',
  dryRun: false,
};

describe('POST /api/procurement/field-stock/serials/force-correct', () => {
  beforeEach(() => {
    // clearAllMocks preserves queued mockResolvedValueOnce values; use
    // mockReset on the service spy to flush its queue too.
    vi.clearAllMocks();
    forceCorrectMock.mockReset();
  });

  // 0a. Auth gate: 401 when no user attached to request (no JWT / no session)
  it('returns 401 when request has no authenticated user', async () => {
    const res = makeRes();
    await handler(makeReq('POST', VALID_BODY, NO_USER), res);
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.jsonData)).toContain('UNAUTHORIZED');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 0b. Permission gate: 403 when user lacks procurement.field-stock.force-correct:edit
  it('returns 403 when authenticated user lacks the force-correct permission', async () => {
    const res = makeRes();
    const noPermUser = {
      id: 'user-uuid-002',
      name: 'No-Permission User',
      role: 'storeman' as const,
      _mockPermitted: false,
    };
    await handler(makeReq('POST', VALID_BODY, noPermUser), res);
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.jsonData)).toContain('FORBIDDEN');
    expect(JSON.stringify(res.jsonData)).toContain('procurement.field-stock.force-correct');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 0c. Permission gate: 200 when non-admin user explicitly has the permission
  it('returns 200 when authenticated non-admin user holds the force-correct permission', async () => {
    forceCorrectMock.mockResolvedValueOnce({
      dryRun: false, totalRequested: 1, totalApplied: 1,
      totalFailed: 0, totalNoOp: 0, rows: [],
    });
    const permittedUser = {
      id: 'user-uuid-003',
      name: 'Procurement Manager',
      role: 'manager' as const,
      _mockPermitted: true,
    };
    const res = makeRes();
    await handler(makeReq('POST', VALID_BODY, permittedUser), res);
    expect(res.statusCode).toBe(200);
    expect(forceCorrectMock).toHaveBeenCalledOnce();
  });

  // 1. Method guard
  it('returns 405 on non-POST methods', async () => {
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers!['Allow']).toBe('POST');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 2. serials missing
  it('returns 422 when serials is missing from body', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { target: { status: 'available' }, reason: 'reason here ok' }), res);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.jsonData)).toContain('serials');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 3. serials empty array
  it('returns 422 when serials is an empty array', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { ...VALID_BODY, serials: [] }), res);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.jsonData)).toContain('serials');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 4. serials length > 500
  it('returns 422 when serials length exceeds 500', async () => {
    const res = makeRes();
    const bigBatch = Array.from({ length: 501 }, (_, i) => `SN-${i}`);
    await handler(makeReq('POST', { ...VALID_BODY, serials: bigBatch }), res);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.jsonData)).toContain('500');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 5a. target missing entirely
  it('returns 422 when target is missing', async () => {
    const res = makeRes();
    const { target: _t, ...bodyNoTarget } = VALID_BODY;
    await handler(makeReq('POST', bodyNoTarget), res);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.jsonData)).toContain('target');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 5b. target has no recognized fields
  it('returns 422 when target object has no valid fields', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { ...VALID_BODY, target: {} }), res);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.jsonData)).toContain('target');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 6. target.status not in enum
  it('returns 422 when target.status is not a valid enum value', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { ...VALID_BODY, target: { status: 'banana' } }), res);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.jsonData)).toContain('target.status');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 7. reason too short
  it('returns 422 when reason is fewer than 10 characters', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { ...VALID_BODY, reason: 'too short' }), res);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.jsonData)).toContain('reason');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 7a. reason exactly at the 10-char boundary — must pass
  it('accepts reason of exactly 10 characters', async () => {
    forceCorrectMock.mockResolvedValueOnce({
      dryRun: false, totalRequested: 1, totalApplied: 0,
      totalFailed: 0, totalNoOp: 0, rows: [],
    });
    const res = makeRes();
    await handler(makeReq('POST', { ...VALID_BODY, reason: '0123456789' }), res);
    expect(res.statusCode).toBe(200);
    expect(forceCorrectMock).toHaveBeenCalledOnce();
  });

  // 7b. reason exceeds 2000 char cap — 422
  it('returns 422 when reason exceeds 2000 characters', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { ...VALID_BODY, reason: 'x'.repeat(2001) }), res);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.jsonData)).toContain('2000');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 7c. individual serial exceeds 255-char cap — 422
  it('returns 422 when any serial exceeds 255 characters', async () => {
    const res = makeRes();
    const oversized = 'A'.repeat(256);
    await handler(makeReq('POST', { ...VALID_BODY, serials: ['SN-001', oversized] }), res);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.jsonData)).toContain('255');
    expect(forceCorrectMock).not.toHaveBeenCalled();
  });

  // 8. dryRun defaults to true
  it('defaults dryRun to true when omitted from body', async () => {
    forceCorrectMock.mockResolvedValueOnce({
      dryRun: true, totalRequested: 1, totalApplied: 0,
      totalFailed: 0, totalNoOp: 0, rows: [],
    });
    const { dryRun: _dr, ...bodyNoDryRun } = VALID_BODY;
    await handler(makeReq('POST', bodyNoDryRun), makeRes());
    expect(forceCorrectMock).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
  });

  // 9. performedBy + performedByName from req.user
  it('passes performedBy and performedByName from req.user to service', async () => {
    forceCorrectMock.mockResolvedValueOnce({
      dryRun: false, totalRequested: 1, totalApplied: 1,
      totalFailed: 0, totalNoOp: 0, rows: [],
    });
    const customUser = { id: 'uuid-admin-42', name: 'Alice Admin', role: 'super_admin' as const };
    await handler(makeReq('POST', VALID_BODY, customUser), makeRes());
    expect(forceCorrectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        performedBy: 'uuid-admin-42',
        performedByName: 'Alice Admin',
      }),
    );
  });

  // 10. Bonus: 200 success path with ForceCorrectResult envelope
  it('returns 200 success envelope wrapping ForceCorrectResult on happy path', async () => {
    const mockResult = {
      dryRun: false,
      totalRequested: 2,
      totalApplied: 2,
      totalFailed: 0,
      totalNoOp: 0,
      rows: [
        { serialNumber: 'SN-001', found: true, applied: true, changedFields: ['status'] },
        { serialNumber: 'SN-002', found: true, applied: true, changedFields: ['status'] },
      ],
    };
    forceCorrectMock.mockResolvedValueOnce(mockResult);
    const res = makeRes();
    await handler(makeReq('POST', VALID_BODY), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({ success: true, data: mockResult });
    expect(forceCorrectMock).toHaveBeenCalledOnce();
  });
});
