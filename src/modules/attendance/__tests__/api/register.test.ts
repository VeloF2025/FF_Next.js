import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findExistingStaffForRegistration: vi.fn(),
  createSelfRegisteredFieldWorker: vi.fn(),
  storeRegistrationSelfie: vi.fn(),
  generateOtp: vi.fn(() => '123456'),
  hashOtp: vi.fn(async () => 'h'),
  upsertPendingOtp: vi.fn(async () => ({ sent: true, cooldownMs: 0 })),
  sendOtpViaWhatsApp: vi.fn(async () => undefined),
  sql: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/services/staff/staffPhoneDedup', () => ({ findExistingStaffForRegistration: mocks.findExistingStaffForRegistration }));
vi.mock('@/modules/attendance/portal/registrationUtils', () => ({
  createSelfRegisteredFieldWorker: mocks.createSelfRegisteredFieldWorker,
  storeRegistrationSelfie: mocks.storeRegistrationSelfie,
}));
vi.mock('@/modules/attendance/portal/otpUtils', () => ({
  generateOtp: mocks.generateOtp, hashOtp: mocks.hashOtp, upsertPendingOtp: mocks.upsertPendingOtp,
  sendOtpViaWhatsApp: mocks.sendOtpViaWhatsApp,
  normaliseSaPhone: (s: string) => (/^0\d{9}$/.test(s) ? '+27' + s.slice(1) : null),
}));

import handler from '../../../../../pages/api/my/register';

function makeReq(body: unknown, method = 'POST'): NextApiRequest {
  return { method, body, headers: { 'user-agent': 't' }, socket: { remoteAddress: '127.0.0.1' }, query: {} } as unknown as NextApiRequest;
}
function makeRes() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = { status(c: number) { captured.statusCode = c; return this; }, json(d: unknown) { captured.body = d; return this; }, setHeader() {}, getHeader() {} };
  return { res: res as unknown as NextApiResponse, captured };
}
const VALID = { firstName: 'Thabo', lastName: 'M', phone: '0821234567', projectId: 'p1', role: 'technician', idNumber: '9001015800087', selfieBase64: 'AAAA' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertPendingOtp.mockResolvedValue({ sent: true, cooldownMs: 0 });
  mocks.createSelfRegisteredFieldWorker.mockResolvedValue('fw-1');
  mocks.storeRegistrationSelfie.mockResolvedValue('/storage/registrations/fw-1/selfie.jpg');
  mocks.sql.mockResolvedValue([]);
});

describe('POST /api/my/register', () => {
  it('405s on non-POST', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq(VALID, 'GET'), res);
    expect(captured.statusCode).toBe(405);
  });
  it('400s on missing fields', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ firstName: 'A' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.createSelfRegisteredFieldWorker).not.toHaveBeenCalled();
  });
  it('400s on malformed phone', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID, phone: 'xyz' }), res);
    expect(captured.statusCode).toBe(400);
  });
  it('400s on bad role', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID, role: 'admin' }), res);
    expect(captured.statusCode).toBe(400);
  });
  it('new phone → creates worker, stores selfie, sends OTP, 200', async () => {
    mocks.findExistingStaffForRegistration.mockResolvedValue(null);
    const { res, captured } = makeRes();
    await handler(makeReq(VALID), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.createSelfRegisteredFieldWorker).toHaveBeenCalledTimes(1);
    expect(mocks.storeRegistrationSelfie).toHaveBeenCalledWith({ base64: 'AAAA', staffId: 'fw-1' });
    expect(mocks.sql).toHaveBeenCalled();
    expect(mocks.sendOtpViaWhatsApp).toHaveBeenCalledTimes(1);
  });
  it('existing phone → no create, still sends OTP, 200', async () => {
    mocks.findExistingStaffForRegistration.mockResolvedValue({ id: 'staff-x' });
    const { res, captured } = makeRes();
    await handler(makeReq(VALID), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.createSelfRegisteredFieldWorker).not.toHaveBeenCalled();
    expect(mocks.upsertPendingOtp).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'staff-x' }));
  });
});
