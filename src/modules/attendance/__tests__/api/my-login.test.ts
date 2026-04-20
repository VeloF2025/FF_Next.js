/**
 * Handler-level tests for POST /api/my/login.
 *
 * Mocks the credentialUtils + sessionUtils boundaries to keep the tests
 * fast and DB-free while still exercising the handler's branching logic:
 * unified 401 responses, lockout silence, timing padding, stage breadcrumbs.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAuthRowByPhone: vi.fn(),
  findAuthRowByEmail: vi.fn(),
  verifyCredential: vi.fn(),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  recordSuccessfulLogin: vi.fn().mockResolvedValue(undefined),
  consumeTimingPadding: vi.fn().mockResolvedValue(undefined),
  lockoutMsRemaining: vi.fn(),
  issueSession: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/modules/attendance/portal/credentialUtils', () => ({
  findAuthRowByPhone: mocks.findAuthRowByPhone,
  findAuthRowByEmail: mocks.findAuthRowByEmail,
  verifyCredential: mocks.verifyCredential,
  recordFailedAttempt: mocks.recordFailedAttempt,
  recordSuccessfulLogin: mocks.recordSuccessfulLogin,
  consumeTimingPadding: mocks.consumeTimingPadding,
  lockoutMsRemaining: mocks.lockoutMsRemaining,
}));

vi.mock('@/modules/attendance/portal/sessionUtils', () => ({
  issueSession: mocks.issueSession,
}));

import handler from '../../../../../pages/api/my/login';

function makeReq(body: unknown): NextApiRequest {
  return {
    method: 'POST',
    body,
    headers: { 'user-agent': 'test' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as NextApiRequest;
}

interface CapturedRes {
  statusCode: number;
  body?: unknown;
  headers: Record<string, string | number | string[] | undefined>;
}

function makeRes(): { res: NextApiResponse; captured: CapturedRes } {
  const captured: CapturedRes = { statusCode: 200, headers: {} };
  const res = {
    statusCode: 200,
    status(code: number) {
      captured.statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      captured.body = data;
      return this;
    },
    setHeader(k: string, v: string | number | string[]) {
      captured.headers[k] = v;
    },
    getHeader(k: string) {
      return captured.headers[k];
    },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

const ACTIVE_ROW_WITH_PASSWORD = {
  staff_id: 'staff-123',
  pin_hash: null,
  password_hash: '$2b$12$fakehash.fakehash.fakehash.fakehash.fakehash.fakeha',
  failed_attempts: 0,
  locked_until: null,
  staff_status: 'active',
  staff_name: 'Test Smoke',
  staff_phone: '+27821234567',
  staff_email: 'smoke@test.local',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lockoutMsRemaining.mockReturnValue(0);
  mocks.issueSession.mockResolvedValue({
    sessionId: 'new-sid',
    staffId: 'staff-123',
    staffName: 'Test Smoke',
    method: 'password',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
});

describe('POST /api/my/login', () => {
  it('rejects non-POST', async () => {
    const req = { method: 'GET', headers: {} } as unknown as NextApiRequest;
    const { res, captured } = makeRes();
    await handler(req, res);
    expect(captured.statusCode).toBe(405);
  });

  it('rejects malformed body (missing fields)', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ method: 'password' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('rejects unknown method', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'magic', identifier: 'a@b', credential: 'x' }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('returns 401 + burns bcrypt time when no row matches (password flow)', async () => {
    mocks.findAuthRowByEmail.mockResolvedValue(null);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'password', identifier: 'unknown@test.local', credential: 'pw' }),
      res
    );
    expect(captured.statusCode).toBe(401);
    expect(mocks.consumeTimingPadding).toHaveBeenCalledWith('pw');
    expect(mocks.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it('returns 401 + burns bcrypt time when no row matches (pin flow)', async () => {
    mocks.findAuthRowByPhone.mockResolvedValue(null);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'pin', identifier: '0821234567', credential: '111111' }),
      res
    );
    expect(captured.statusCode).toBe(401);
    expect(mocks.consumeTimingPadding).toHaveBeenCalledWith('111111');
  });

  it('returns 401 + does NOT reveal lockout to the caller', async () => {
    mocks.findAuthRowByEmail.mockResolvedValue(ACTIVE_ROW_WITH_PASSWORD);
    mocks.lockoutMsRemaining.mockReturnValue(5 * 60_000);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'password', identifier: 'smoke@test.local', credential: 'pw' }),
      res
    );
    // The raw body — must NOT contain 'locked' or '429' style info.
    expect(captured.statusCode).toBe(401);
    const body = JSON.stringify(captured.body ?? {}).toLowerCase();
    expect(body).not.toMatch(/locked/);
    expect(body).not.toMatch(/retry/);
    expect(body).not.toMatch(/minutes/);
    // Timing padding should still run.
    expect(mocks.consumeTimingPadding).toHaveBeenCalled();
  });

  it('returns 401 when staff status is not active (no status leak)', async () => {
    mocks.findAuthRowByEmail.mockResolvedValue({
      ...ACTIVE_ROW_WITH_PASSWORD,
      staff_status: 'terminated',
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'password', identifier: 'smoke@test.local', credential: 'pw' }),
      res
    );
    expect(captured.statusCode).toBe(401);
    const body = JSON.stringify(captured.body ?? {}).toLowerCase();
    expect(body).not.toMatch(/not active/);
    expect(body).not.toMatch(/terminated/);
  });

  it('counts a wrong-method attempt as a failed attempt', async () => {
    // Row has only password_hash; caller tries pin flow.
    mocks.findAuthRowByPhone.mockResolvedValue({
      ...ACTIVE_ROW_WITH_PASSWORD,
      pin_hash: null,
      password_hash: 'hash',
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'pin', identifier: '0821234567', credential: '111111' }),
      res
    );
    expect(captured.statusCode).toBe(401);
    expect(mocks.recordFailedAttempt).toHaveBeenCalledWith('staff-123');
  });

  it('returns 401 and records failure when credential is wrong', async () => {
    mocks.findAuthRowByEmail.mockResolvedValue(ACTIVE_ROW_WITH_PASSWORD);
    mocks.verifyCredential.mockResolvedValue(false);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'password', identifier: 'smoke@test.local', credential: 'nope' }),
      res
    );
    expect(captured.statusCode).toBe(401);
    expect(mocks.recordFailedAttempt).toHaveBeenCalledWith('staff-123');
    expect(mocks.recordSuccessfulLogin).not.toHaveBeenCalled();
    expect(mocks.issueSession).not.toHaveBeenCalled();
  });

  it('returns 200 + issues session on correct credential', async () => {
    mocks.findAuthRowByEmail.mockResolvedValue(ACTIVE_ROW_WITH_PASSWORD);
    mocks.verifyCredential.mockResolvedValue(true);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'password', identifier: 'smoke@test.local', credential: 'correct' }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.recordSuccessfulLogin).toHaveBeenCalledWith('staff-123');
    expect(mocks.issueSession).toHaveBeenCalled();
    const body = captured.body as { success: true; data: { staffId: string; name: string } };
    expect(body.data.staffId).toBe('staff-123');
    expect(body.data.name).toBe('Test Smoke');
  });

  it('rejects non-string identifier / credential with 400, not 500', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'password', identifier: 12345, credential: { not: 'string' } }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });
});
