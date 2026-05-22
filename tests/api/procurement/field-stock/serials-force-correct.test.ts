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

vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
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

const DEFAULT_USER = { id: 'user-uuid-001', name: 'Test Admin' };

function makeReq(
  method: string,
  body: Record<string, unknown> = {},
  user = DEFAULT_USER,
): NextApiRequest {
  return { method, body, headers: {}, user } as unknown as NextApiRequest;
}

const VALID_BODY = {
  serials: ['SN-001', 'SN-002'],
  target: { status: 'available' },
  reason: 'Correcting misrouted serials from last deployment',
  dryRun: false,
};

describe('POST /api/procurement/field-stock/serials/force-correct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const customUser = { id: 'uuid-admin-42', name: 'Alice Admin' };
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
