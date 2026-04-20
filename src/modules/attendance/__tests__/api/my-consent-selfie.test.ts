/**
 * Handler tests for POST /api/my/consent/selfie.
 *
 * Covers the contract that PR4's UI depends on:
 *   - GET / other methods → 405
 *   - bad action values → 400
 *   - valid session + grant → SQL UPDATE ran, returns { ok, version }
 *   - valid session + revoke → SQL UPDATE ran, returns { ok }
 *   - 401 when session missing (via authMiddleware)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

vi.mock('@/modules/attendance/portal/sessionUtils', () => ({
  verifySession: mocks.verifySession,
}));

import handler from '../../../../../pages/api/my/consent/selfie';

const VALID_SESSION = {
  sessionId: 'sid',
  staffId: 'staff-1',
  staffName: 'Test',
  method: 'pin' as const,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

function makeReq(body: unknown, method: string = 'POST'): NextApiRequest {
  return {
    method,
    body,
    headers: { 'user-agent': 'test' },
    socket: { remoteAddress: '127.0.0.1' },
    query: {},
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
  mocks.verifySession.mockResolvedValue({ valid: true, session: VALID_SESSION });
});

describe('POST /api/my/consent/selfie', () => {
  it('returns 401 when the session is missing', async () => {
    mocks.verifySession.mockResolvedValue({ valid: false, session: null, reason: 'none' });
    const { res, captured } = makeRes();
    await handler(makeReq({ action: 'grant' }), res);
    expect(captured.statusCode).toBe(401);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('returns 405 for non-POST', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('returns 400 when action is missing', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('returns 400 on unknown action', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ action: 'foo' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('grants consent: runs UPDATE and returns version', async () => {
    mocks.sql.mockResolvedValue([{ version: 3 }]);
    const { res, captured } = makeRes();
    await handler(makeReq({ action: 'grant' }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const body = captured.body as { success: true; data: { ok: true; action: string; version: number } };
    expect(body.data.action).toBe('grant');
    expect(body.data.version).toBe(3);
  });

  it('grant: returns 404 when no attendance_credentials row exists', async () => {
    // Prevents the silent "version = 0" no-op that would trap the UI in a
    // consent-required loop (since PR3's clock-in returns 403 consent_missing
    // for the same no-row state). The 404 lets the UI route the user to
    // complete onboarding.
    mocks.sql.mockResolvedValue([]);
    const { res, captured } = makeRes();
    await handler(makeReq({ action: 'grant' }), res);
    expect(captured.statusCode).toBe(404);
  });

  it('revokes consent: runs UPDATE and returns ok', async () => {
    mocks.sql.mockResolvedValue([{ staff_id: 'staff-1' }]);
    const { res, captured } = makeRes();
    await handler(makeReq({ action: 'revoke' }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const body = captured.body as { success: true; data: { ok: true; action: string } };
    expect(body.data.action).toBe('revoke');
  });

  it('revoke: returns 404 when no attendance_credentials row exists', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res, captured } = makeRes();
    await handler(makeReq({ action: 'revoke' }), res);
    expect(captured.statusCode).toBe(404);
  });

  it('returns 500 on a DB failure during grant', async () => {
    mocks.sql.mockRejectedValue(new Error('DB down'));
    const { res, captured } = makeRes();
    await handler(makeReq({ action: 'grant' }), res);
    expect(captured.statusCode).toBe(500);
  });
});
