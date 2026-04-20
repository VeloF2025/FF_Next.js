/**
 * Handler-level tests for POST /api/my/login/verify-otp.
 *
 * Contract under test:
 *   - Bad input shape → 400 (not 401) so legitimate users see the fix.
 *   - All "auth failed" paths → 401 with GENERIC_AUTH_FAIL (unified).
 *   - Every early-return before bcrypt burns `consumeTimingPadding` so known
 *     vs unknown phone cannot be distinguished by latency.
 *   - Bad OTP bumps BOTH `pending_otp_attempts` AND `failed_attempts` — the
 *     latter trips the shared 15-min lockout that login.ts also uses.
 *   - Locked account → 401 + timing padding, no mutation.
 *   - Valid OTP + issueSession failure → 200 with sessionIssued:false so the
 *     committed PIN is preserved (user can sign in via login.ts next).
 *   - OTP_MAX_ATTEMPTS - 1 attempts + bad OTP → bump (no invalidate); on the
 *     next call with attempts=MAX → invalidate (burns the OTP).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findPendingOtpByPhone: vi.fn(),
  normaliseSaPhone: vi.fn(),
  verifyOtp: vi.fn(),
  bumpOtpAttempts: vi.fn().mockResolvedValue(undefined),
  invalidatePendingOtp: vi.fn().mockResolvedValue(undefined),
  commitPinAndClearOtp: vi.fn().mockResolvedValue(undefined),
  hashPin: vi.fn(),
  issueSession: vi.fn(),
  consumeTimingPadding: vi.fn().mockResolvedValue(undefined),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  lockoutMsRemaining: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/modules/attendance/portal/otpUtils', () => ({
  findPendingOtpByPhone: mocks.findPendingOtpByPhone,
  normaliseSaPhone: mocks.normaliseSaPhone,
  verifyOtp: mocks.verifyOtp,
  bumpOtpAttempts: mocks.bumpOtpAttempts,
  invalidatePendingOtp: mocks.invalidatePendingOtp,
  commitPinAndClearOtp: mocks.commitPinAndClearOtp,
  OTP_MAX_ATTEMPTS: 5,
}));

vi.mock('@/modules/attendance/portal/credentialUtils', () => ({
  hashPin: mocks.hashPin,
  consumeTimingPadding: mocks.consumeTimingPadding,
  recordFailedAttempt: mocks.recordFailedAttempt,
  lockoutMsRemaining: mocks.lockoutMsRemaining,
}));

vi.mock('@/modules/attendance/portal/sessionUtils', () => ({
  issueSession: mocks.issueSession,
}));

import handler from '../../../../../pages/api/my/login/verify-otp';

function makeReq(body: unknown, method: string = 'POST'): NextApiRequest {
  return {
    method,
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

const VALID_PENDING_ROW = () => ({
  staff_id: 'staff-1',
  staff_name: 'Test Smoke',
  pending_otp_hash: 'hash-of-123456',
  pending_otp_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  pending_otp_attempts: 0,
  phone_verified_at: null,
  pin_hash: null,
  failed_attempts: 0,
  locked_until: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.normaliseSaPhone.mockImplementation((raw: string) => {
    if (typeof raw !== 'string') return null;
    if (/^\+27\d{9}$/.test(raw)) return raw;
    if (/^0\d{9}$/.test(raw)) return `+27${raw.slice(1)}`;
    return null;
  });
  mocks.verifyOtp.mockResolvedValue(true);
  mocks.hashPin.mockResolvedValue('pin-hash');
  mocks.lockoutMsRemaining.mockReturnValue(0);
  mocks.issueSession.mockResolvedValue({
    sessionId: 'sid-1',
    staffId: 'staff-1',
    staffName: 'Test Smoke',
    method: 'pin',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
});

describe('POST /api/my/login/verify-otp', () => {
  it('rejects non-POST with 405', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('rejects malformed phone/otp with 400 (not 401 — user fixable)', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: 'nope', otp: '1' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.findPendingOtpByPhone).not.toHaveBeenCalled();
  });

  it('rejects malformed new_pin with 400 BEFORE burning an OTP attempt', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ phone: '+27821234567', otp: '123456', new_pin: '12345' }),
      res
    );
    expect(captured.statusCode).toBe(400);
    expect(mocks.findPendingOtpByPhone).not.toHaveBeenCalled();
    expect(mocks.bumpOtpAttempts).not.toHaveBeenCalled();
  });

  it('returns 401 + burns bcrypt time for unknown phone (no enumeration oracle)', async () => {
    mocks.findPendingOtpByPhone.mockResolvedValue(null);
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27829999999', otp: '123456' }), res);
    expect(captured.statusCode).toBe(401);
    expect(mocks.consumeTimingPadding).toHaveBeenCalledWith('123456');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('returns 401 + burns bcrypt time + skips mutations when account is locked', async () => {
    mocks.findPendingOtpByPhone.mockResolvedValue(VALID_PENDING_ROW());
    mocks.lockoutMsRemaining.mockReturnValue(5 * 60_000);
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567', otp: '123456' }), res);
    expect(captured.statusCode).toBe(401);
    expect(mocks.consumeTimingPadding).toHaveBeenCalledWith('123456');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.bumpOtpAttempts).not.toHaveBeenCalled();
    expect(mocks.recordFailedAttempt).not.toHaveBeenCalled();
    // The 401 body must not reveal the lockout to the client.
    const body = JSON.stringify(captured.body ?? {}).toLowerCase();
    expect(body).not.toMatch(/lock/);
    expect(body).not.toMatch(/minutes/);
  });

  it('returns 401 + burns bcrypt time when no pending OTP is set', async () => {
    mocks.findPendingOtpByPhone.mockResolvedValue({
      ...VALID_PENDING_ROW(),
      pending_otp_hash: null,
      pending_otp_expires_at: null,
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567', otp: '123456' }), res);
    expect(captured.statusCode).toBe(401);
    expect(mocks.consumeTimingPadding).toHaveBeenCalledWith('123456');
  });

  it('returns 401, burns bcrypt time, and invalidates OTP when attempts exhausted', async () => {
    mocks.findPendingOtpByPhone.mockResolvedValue({
      ...VALID_PENDING_ROW(),
      pending_otp_attempts: 5,
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567', otp: '123456' }), res);
    expect(captured.statusCode).toBe(401);
    expect(mocks.consumeTimingPadding).toHaveBeenCalledWith('123456');
    expect(mocks.invalidatePendingOtp).toHaveBeenCalledWith('staff-1');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('returns 401, burns bcrypt time, and invalidates OTP when expired', async () => {
    mocks.findPendingOtpByPhone.mockResolvedValue({
      ...VALID_PENDING_ROW(),
      pending_otp_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567', otp: '123456' }), res);
    expect(captured.statusCode).toBe(401);
    expect(mocks.consumeTimingPadding).toHaveBeenCalledWith('123456');
    expect(mocks.invalidatePendingOtp).toHaveBeenCalledWith('staff-1');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('returns 401 and bumps BOTH counters on bad OTP (per-OTP + shared lockout)', async () => {
    mocks.findPendingOtpByPhone.mockResolvedValue(VALID_PENDING_ROW());
    mocks.verifyOtp.mockResolvedValue(false);
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567', otp: '000000' }), res);
    expect(captured.statusCode).toBe(401);
    expect(mocks.bumpOtpAttempts).toHaveBeenCalledWith('staff-1');
    expect(mocks.recordFailedAttempt).toHaveBeenCalledWith('staff-1');
    expect(mocks.invalidatePendingOtp).not.toHaveBeenCalled();
    expect(mocks.issueSession).not.toHaveBeenCalled();
  });

  it('5th-attempt boundary: attempts=4 + bad OTP → bump only (no invalidate yet)', async () => {
    mocks.findPendingOtpByPhone.mockResolvedValue({
      ...VALID_PENDING_ROW(),
      pending_otp_attempts: 4,
    });
    mocks.verifyOtp.mockResolvedValue(false);
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567', otp: '000000' }), res);
    expect(captured.statusCode).toBe(401);
    expect(mocks.bumpOtpAttempts).toHaveBeenCalledWith('staff-1');
    expect(mocks.recordFailedAttempt).toHaveBeenCalledWith('staff-1');
    expect(mocks.invalidatePendingOtp).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).toHaveBeenCalled();
  });

  it('commits PIN and issues session on valid OTP with new_pin', async () => {
    mocks.findPendingOtpByPhone.mockResolvedValue(VALID_PENDING_ROW());
    mocks.verifyOtp.mockResolvedValue(true);
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        phone: '+27821234567',
        otp: '123456',
        new_pin: '987654',
        device_fingerprint: 'dev-abc',
      }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.hashPin).toHaveBeenCalledWith('987654');
    expect(mocks.commitPinAndClearOtp).toHaveBeenCalledWith({
      staffId: 'staff-1',
      pinHash: 'pin-hash',
      deviceFingerprint: 'dev-abc',
    });
    expect(mocks.issueSession).toHaveBeenCalled();
    const body = captured.body as {
      success: true;
      data: { pinSet: boolean; staffId: string; sessionIssued: boolean };
    };
    expect(body.data.pinSet).toBe(true);
    expect(body.data.staffId).toBe('staff-1');
    expect(body.data.sessionIssued).toBe(true);
  });

  it('consumes OTP and issues session on valid OTP without new_pin (recovery path)', async () => {
    mocks.findPendingOtpByPhone.mockResolvedValue(VALID_PENDING_ROW());
    mocks.verifyOtp.mockResolvedValue(true);
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567', otp: '123456' }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.commitPinAndClearOtp).not.toHaveBeenCalled();
    expect(mocks.invalidatePendingOtp).toHaveBeenCalledWith('staff-1');
    expect(mocks.issueSession).toHaveBeenCalled();
    const body = captured.body as { success: true; data: { pinSet: boolean } };
    expect(body.data.pinSet).toBe(false);
  });

  it('preserves PIN commit when issueSession fails AFTER commit (returns sessionIssued:false)', async () => {
    mocks.findPendingOtpByPhone.mockResolvedValue(VALID_PENDING_ROW());
    mocks.verifyOtp.mockResolvedValue(true);
    mocks.issueSession.mockRejectedValue(new Error('session audit insert failed'));
    const { res, captured } = makeRes();
    await handler(
      makeReq({ phone: '+27821234567', otp: '123456', new_pin: '987654' }),
      res
    );
    // Must be 200, not 500, so the client knows the PIN was saved and can
    // redirect to the normal PIN login rather than re-prompting for OTP.
    expect(captured.statusCode).toBe(200);
    expect(mocks.commitPinAndClearOtp).toHaveBeenCalled();
    const body = captured.body as {
      success: true;
      data: { pinSet: boolean; sessionIssued: boolean };
    };
    expect(body.data.pinSet).toBe(true);
    expect(body.data.sessionIssued).toBe(false);
  });
});
