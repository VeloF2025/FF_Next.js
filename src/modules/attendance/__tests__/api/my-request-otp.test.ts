/**
 * Handler-level tests for POST /api/my/login/request-otp.
 *
 * Contract under test:
 *   - Always returns 200, regardless of whether the phone maps to a staff
 *     row. No enumeration oracle.
 *   - Generates + persists an OTP and calls the WA sender only when the
 *     phone does match an active staff.
 *   - Swallows the send silently when the cooldown hasn't elapsed.
 *   - Swallows WA sender failures (still 200).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAuthRowByPhone: vi.fn(),
  generateOtp: vi.fn(),
  hashOtp: vi.fn(),
  normaliseSaPhone: vi.fn(),
  sendOtpViaWhatsApp: vi.fn(),
  upsertPendingOtp: vi.fn(),
  lockoutMsRemaining: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/modules/attendance/portal/otpUtils', () => ({
  findAuthRowByPhone: mocks.findAuthRowByPhone,
  generateOtp: mocks.generateOtp,
  hashOtp: mocks.hashOtp,
  normaliseSaPhone: mocks.normaliseSaPhone,
  sendOtpViaWhatsApp: mocks.sendOtpViaWhatsApp,
  upsertPendingOtp: mocks.upsertPendingOtp,
}));

vi.mock('@/modules/attendance/portal/credentialUtils', () => ({
  lockoutMsRemaining: mocks.lockoutMsRemaining,
}));

import handler from '../../../../../pages/api/my/login/request-otp';

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

const ACTIVE_ROW = {
  staff_id: 'staff-1',
  pin_hash: null,
  password_hash: null,
  failed_attempts: 0,
  locked_until: null,
  staff_status: 'active',
  staff_name: 'Test Smoke',
  staff_phone: '+27821234567',
  staff_email: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.normaliseSaPhone.mockImplementation((raw: string) => {
    if (typeof raw !== 'string') return null;
    if (/^\+27\d{9}$/.test(raw)) return raw;
    if (/^0\d{9}$/.test(raw)) return `+27${raw.slice(1)}`;
    return null;
  });
  mocks.generateOtp.mockReturnValue('123456');
  mocks.hashOtp.mockResolvedValue('hash-123456');
  mocks.upsertPendingOtp.mockResolvedValue({ sent: true, cooldownMs: 0 });
  mocks.sendOtpViaWhatsApp.mockResolvedValue(undefined);
  mocks.lockoutMsRemaining.mockReturnValue(0);
});

describe('POST /api/my/login/request-otp', () => {
  it('rejects non-POST with 405', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('returns 200 even when phone is malformed, without touching DB or WA', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: 'not-a-phone' }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.findAuthRowByPhone).not.toHaveBeenCalled();
    expect(mocks.sendOtpViaWhatsApp).not.toHaveBeenCalled();
  });

  it('returns 200 for unknown phone without sending anything (no enumeration oracle)', async () => {
    mocks.findAuthRowByPhone.mockResolvedValue(null);
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27829999999' }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.findAuthRowByPhone).toHaveBeenCalled();
    expect(mocks.upsertPendingOtp).not.toHaveBeenCalled();
    expect(mocks.sendOtpViaWhatsApp).not.toHaveBeenCalled();
  });

  it('generates OTP, persists, and sends when phone matches active staff', async () => {
    mocks.findAuthRowByPhone.mockResolvedValue(ACTIVE_ROW);
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567' }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.generateOtp).toHaveBeenCalled();
    expect(mocks.hashOtp).toHaveBeenCalledWith('123456');
    expect(mocks.upsertPendingOtp).toHaveBeenCalledWith({
      staffId: 'staff-1',
      otpHash: 'hash-123456',
    });
    expect(mocks.sendOtpViaWhatsApp).toHaveBeenCalledWith({
      phone: '+27821234567',
      otp: '123456',
      staffName: 'Test Smoke',
    });
  });

  it('swallows cooldown-blocked sends (no WA call, still 200)', async () => {
    mocks.findAuthRowByPhone.mockResolvedValue(ACTIVE_ROW);
    mocks.upsertPendingOtp.mockResolvedValue({ sent: false, cooldownMs: 45_000 });
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567' }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.sendOtpViaWhatsApp).not.toHaveBeenCalled();
  });

  it('returns 200 even when the WA sender throws', async () => {
    mocks.findAuthRowByPhone.mockResolvedValue(ACTIVE_ROW);
    mocks.sendOtpViaWhatsApp.mockRejectedValue(new Error('WA exploded'));
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567' }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.sendOtpViaWhatsApp).toHaveBeenCalled();
  });

  it('returns 200 even when the DB lookup throws (no state leak)', async () => {
    mocks.findAuthRowByPhone.mockRejectedValue(new Error('DB down'));
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567' }), res);
    expect(captured.statusCode).toBe(200);
  });

  it('refuses to send OTP when account is locked (shared lockout with login)', async () => {
    mocks.findAuthRowByPhone.mockResolvedValue(ACTIVE_ROW);
    mocks.lockoutMsRemaining.mockReturnValue(5 * 60_000);
    const { res, captured } = makeRes();
    await handler(makeReq({ phone: '+27821234567' }), res);
    expect(captured.statusCode).toBe(200);
    // Must NOT generate, persist, or send during lockout — otherwise the
    // attacker could flood a victim's WA even while the account is locked.
    expect(mocks.generateOtp).not.toHaveBeenCalled();
    expect(mocks.upsertPendingOtp).not.toHaveBeenCalled();
    expect(mocks.sendOtpViaWhatsApp).not.toHaveBeenCalled();
  });
});
