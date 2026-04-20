/**
 * Handler-level tests for POST /api/my/attendance/clock-out.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getSelfieConsentState: vi.fn(),
  findOpenEntry: vi.fn(),
  closeOpenEntry: vi.fn(),
  insertException: vi.fn().mockResolvedValue(undefined),
  storeSelfie: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/attendance/portal/sessionUtils', () => ({
  verifySession: mocks.verifySession,
}));
vi.mock('@/modules/attendance/portal/clockUtils', () => ({
  findOpenEntry: mocks.findOpenEntry,
  getSelfieConsentState: mocks.getSelfieConsentState,
  closeOpenEntry: mocks.closeOpenEntry,
  insertException: mocks.insertException,
}));
vi.mock('@/modules/attendance/portal/selfieUtils', () => ({
  storeSelfie: mocks.storeSelfie,
}));

import handler from '../../../../../pages/api/my/attendance/clock-out';

const VALID_SESSION = {
  sessionId: 'sid-1',
  staffId: 'staff-1',
  staffName: 'Test Smoke',
  method: 'pin' as const,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

const FAKE_SELFIE = 'A'.repeat(200);
const nowIso = (offset = 0) => new Date(Date.now() + offset).toISOString();

function makeReq(body: unknown): NextApiRequest {
  return {
    method: 'POST',
    body,
    headers: { 'user-agent': 'test' },
    socket: { remoteAddress: '127.0.0.1' },
    query: {},
  } as unknown as NextApiRequest;
}

function makeRes() {
  const captured: { statusCode: number; body?: unknown; headers: Record<string, unknown> } = {
    statusCode: 200,
    headers: {},
  };
  const res = {
    statusCode: 200,
    status(c: number) { captured.statusCode = c; this.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    setHeader() {},
    getHeader() { return undefined; },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

const openEntry = {
  id: 'entry-open',
  staff_id: 'staff-1',
  work_date: '2026-04-20',
  clock_in_at: new Date(Date.now() - 3 * 3600_000).toISOString(), // 3h ago
  clock_in_lat: '-26.27',
  clock_in_lon: '27.95',
  status: 'open' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifySession.mockResolvedValue({ valid: true, session: VALID_SESSION });
  mocks.getSelfieConsentState.mockResolvedValue('granted');
  mocks.findOpenEntry.mockResolvedValue(openEntry);
  mocks.storeSelfie.mockResolvedValue({
    url: '/storage/out.jpg', path: 'attendance/staff-1/2026-04-20/out.jpg', size: 1000,
  });
  mocks.closeOpenEntry.mockResolvedValue({
    ...openEntry,
    clock_out_at: new Date().toISOString(),
    clock_out_lat: '-26.27',
    clock_out_lon: '27.95',
    selfie_out_url: '/storage/out.jpg',
    status: 'closed',
  });
});

describe('POST /api/my/attendance/clock-out', () => {
  it('401s when session is invalid', async () => {
    mocks.verifySession.mockResolvedValue({ valid: false, session: null, reason: 'none' });
    const { res, captured } = makeRes();
    await handler(makeReq({ lat: 0, lon: 0, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }), res);
    expect(captured.statusCode).toBe(401);
  });

  it('400s on clock_skew before any DB work', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: 0, lon: 0, client_occurred_at: nowIso(-15 * 60_000), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(400);
    expect(mocks.findOpenEntry).not.toHaveBeenCalled();
  });

  it('404s when no open entry exists', async () => {
    mocks.findOpenEntry.mockResolvedValue(null);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(404);
    const body = captured.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe('no_open_entry');
  });

  it('grandfathers the close when consent was revoked mid-shift', async () => {
    // Open entry exists; consent now 'revoked'. Expect: still closes,
    // logs a manual_override exception, returns 200.
    mocks.getSelfieConsentState.mockResolvedValue('revoked');
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.closeOpenEntry).toHaveBeenCalled();
    expect(mocks.insertException).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'manual_override',
        details: expect.objectContaining({ reason: 'consent_revoked_mid_shift' }),
      })
    );
  });

  it('403s when the credentials row is missing entirely', async () => {
    mocks.getSelfieConsentState.mockResolvedValue('missing');
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(403);
    expect(mocks.closeOpenEntry).not.toHaveBeenCalled();
  });

  it('409s with update_missed when closeOpenEntry returns null (race)', async () => {
    mocks.closeOpenEntry.mockResolvedValue(null);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(409);
    const body = captured.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe('update_missed');
  });

  it('200s on happy path with non-negative durationMs', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { data?: { durationMs?: number } };
    expect(body.data?.durationMs).toBeGreaterThan(0);
  });

  it('logs vehicle_gps_mismatch when clock-out is > 50 km from clock-in', async () => {
    // Clock-in was in JHB (-26.27, 27.95), clock out in Pretoria (~55 km).
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -25.74, lon: 28.19, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.insertException).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'vehicle_gps_mismatch',
        details: expect.objectContaining({ reason: 'clock_out_far_from_clock_in' }),
      })
    );
  });

  it('does not log vehicle_gps_mismatch for short-distance clock-out', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.28, lon: 27.96, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(200);
    const vehicleExceptions = mocks.insertException.mock.calls.filter(
      (c: unknown[]) => (c[0] as { kind?: string }).kind === 'vehicle_gps_mismatch'
    );
    expect(vehicleExceptions).toHaveLength(0);
  });
});
