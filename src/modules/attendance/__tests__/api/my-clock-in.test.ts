/**
 * Handler-level tests for POST /api/my/attendance/clock-in.
 * Everything below the session gate is mocked so we can exercise branches
 * without a real DB or VF Storage.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getSelfieConsentState: vi.fn(),
  findOpenEntry: vi.fn(),
  findActiveVehicleAssignment: vi.fn(),
  insertClockIn: vi.fn(),
  insertException: vi.fn().mockResolvedValue(undefined),
  sastWorkDate: vi.fn(() => '2026-04-20'),
  matchGeofence: vi.fn(),
  storeSelfie: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/modules/attendance/portal/sessionUtils', () => ({
  verifySession: mocks.verifySession,
}));

vi.mock('@/modules/attendance/portal/clockUtils', () => ({
  getSelfieConsentState: mocks.getSelfieConsentState,
  findOpenEntry: mocks.findOpenEntry,
  findActiveVehicleAssignment: mocks.findActiveVehicleAssignment,
  insertClockIn: mocks.insertClockIn,
  insertException: mocks.insertException,
  sastWorkDate: mocks.sastWorkDate,
}));

vi.mock('@/modules/attendance/portal/geofenceUtils', () => ({
  matchGeofence: mocks.matchGeofence,
}));

vi.mock('@/modules/attendance/portal/selfieUtils', () => ({
  storeSelfie: mocks.storeSelfie,
}));

vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

// VFStorageService is only used for orphan-selfie cleanup on a 23505 race.
// Stub it so the module loads in the test environment without pulling the
// real HTTP/sharp/Blob chain.
vi.mock('@/services/vfStorageAdapter', () => ({
  VFStorageService: class {
    async deleteFile() { return { success: true }; }
  },
}));

import handler from '../../../../../pages/api/my/attendance/clock-in';

const VALID_SESSION = {
  sessionId: 'sid-123',
  staffId: 'staff-456',
  staffName: 'Test Smoke',
  method: 'pin' as const,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

// A valid-looking base64 string > 100 chars so the handler's length guard passes.
const FAKE_SELFIE = 'A'.repeat(200);

function makeReq(body: unknown): NextApiRequest {
  return {
    method: 'POST',
    body,
    headers: { 'user-agent': 'test' },
    socket: { remoteAddress: '127.0.0.1' },
    query: {},
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
    status(c: number) {
      captured.statusCode = c;
      this.statusCode = c;
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifySession.mockResolvedValue({ valid: true, session: VALID_SESSION });
  mocks.getSelfieConsentState.mockResolvedValue('granted');
  mocks.findOpenEntry.mockResolvedValue(null);
  mocks.findActiveVehicleAssignment.mockResolvedValue(null);
  mocks.matchGeofence.mockResolvedValue({
    siteId: 'site-789',
    siteName: 'Lawley POP 1',
    distanceM: 42,
    inside: true,
    fallback: false,
  });
  mocks.storeSelfie.mockResolvedValue({
    url: '/storage/attendance/staff-456/2026-04-20/in.jpg',
    path: 'attendance/staff-456/2026-04-20/in.jpg',
    size: 123_456,
  });
  mocks.insertClockIn.mockResolvedValue({
    id: 'entry-999',
    staff_id: 'staff-456',
    work_date: '2026-04-20',
    clock_in_at: new Date().toISOString(),
    clock_out_at: null,
    clock_in_lat: '-26.27',
    clock_in_lon: '27.95',
    clock_in_accuracy_m: '12',
    clock_out_lat: null,
    clock_out_lon: null,
    clock_out_accuracy_m: null,
    selfie_in_url: '/storage/attendance/staff-456/2026-04-20/in.jpg',
    selfie_out_url: null,
    vehicle_assignment_id: null,
    site_geofence_id: 'site-789',
    status: 'open',
    notes: null,
  });
  mocks.sql.mockResolvedValue([{ home_site_id: null }]);
});

describe('POST /api/my/attendance/clock-in', () => {
  it('401s when session is invalid', async () => {
    mocks.verifySession.mockResolvedValue({ valid: false, session: null, reason: 'no_cookie_or_bad_signature' });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(401);
  });

  it('405s on GET', async () => {
    const req = { method: 'GET', headers: {}, socket: {}, query: {} } as unknown as NextApiRequest;
    const { res, captured } = makeRes();
    await handler(req, res);
    expect(captured.statusCode).toBe(405);
  });

  it('400s on missing / invalid lat/lon', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('400s on invalid client_occurred_at', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: 0, lon: 0, client_occurred_at: 'not-an-iso-date', selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('400s on missing selfie_base64', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: 0, lon: 0, client_occurred_at: nowIso() }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('403s + consent_required when selfie consent revoked', async () => {
    mocks.getSelfieConsentState.mockResolvedValue('revoked');
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(403);
    const body = captured.body as { error?: { details?: { reason?: string; consentState?: string } } };
    expect(body.error?.details?.reason).toBe('consent_required');
    expect(body.error?.details?.consentState).toBe('revoked');
  });

  it('403s with honest message when credentials row is missing', async () => {
    mocks.getSelfieConsentState.mockResolvedValue('missing');
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(403);
    const body = captured.body as { error?: { message?: string; details?: { consentState?: string } } };
    expect(body.error?.details?.consentState).toBe('missing');
    // Message should say "not set up" not "revoked" — different triage path.
    expect(body.error?.message?.toLowerCase()).toMatch(/not set up|contact hr/);
  });

  it('409s + open_entry when an open entry already exists', async () => {
    mocks.findOpenEntry.mockResolvedValue({
      id: 'entry-already-open',
      work_date: '2026-04-19',
      clock_in_at: new Date(Date.now() - 20 * 3600_000).toISOString(),
      status: 'open',
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(409);
    const body = captured.body as { error?: { details?: { reason?: string; openEntryId?: string } } };
    expect(body.error?.details?.reason).toBe('open_entry');
    expect(body.error?.details?.openEntryId).toBe('entry-already-open');
  });

  it('400s + clock_skew when device time is >2 min off', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        lat: -26.27,
        lon: 27.95,
        client_occurred_at: nowIso(-10 * 60_000), // 10 min in the past
        selfie_base64: FAKE_SELFIE,
      }),
      res
    );
    expect(captured.statusCode).toBe(400);
    const body = captured.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe('clock_skew');
  });

  it('200s on the happy path and returns entry + site info', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        lat: -26.27,
        lon: 27.95,
        accuracy_m: 12,
        client_occurred_at: nowIso(),
        selfie_base64: FAKE_SELFIE,
      }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.storeSelfie).toHaveBeenCalled();
    expect(mocks.insertClockIn).toHaveBeenCalled();
    const body = captured.body as { success: true; data: { entryId: string; siteId: string; insideSite: boolean } };
    expect(body.data.entryId).toBe('entry-999');
    expect(body.data.siteId).toBe('site-789');
    expect(body.data.insideSite).toBe(true);
    // No geofence_mismatch exception since we were inside.
    expect(mocks.insertException).not.toHaveBeenCalled();
  });

  it('logs geofence_mismatch when GPS is outside any radius', async () => {
    mocks.matchGeofence.mockResolvedValue({
      siteId: null,
      siteName: null,
      distanceM: null,
      inside: false,
      fallback: false,
    });
    mocks.insertClockIn.mockResolvedValue({
      id: 'entry-nomatch',
      staff_id: 'staff-456',
      work_date: '2026-04-20',
      clock_in_at: new Date().toISOString(),
      clock_out_at: null,
      clock_in_lat: '0',
      clock_in_lon: '0',
      clock_in_accuracy_m: null,
      clock_out_lat: null,
      clock_out_lon: null,
      clock_out_accuracy_m: null,
      selfie_in_url: '/storage/x',
      selfie_out_url: null,
      vehicle_assignment_id: null,
      site_geofence_id: null,
      status: 'open',
      notes: null,
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: 0, lon: 0, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.insertException).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'geofence_mismatch', entryId: 'entry-nomatch', severity: 'warning' })
    );
  });

  it('uploads selfie BEFORE calling insertClockIn (ordering contract)', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(200);
    // invocationCallOrder increases globally — lower number = earlier call.
    const uploadOrder = mocks.storeSelfie.mock.invocationCallOrder[0]!;
    const insertOrder = mocks.insertClockIn.mock.invocationCallOrder[0]!;
    expect(uploadOrder).toBeLessThan(insertOrder);
  });

  it('does NOT call insertClockIn when selfie upload fails', async () => {
    mocks.storeSelfie.mockRejectedValueOnce(new Error('VF Storage down'));
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(500);
    expect(mocks.insertClockIn).not.toHaveBeenCalled();
  });

  it('returns 409 + raced=true when INSERT hits unique-violation (23505)', async () => {
    // Simulate a concurrent request winning the race: findOpenEntry said null,
    // but by the time we INSERT the partial-unique index rejects.
    const pgErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    mocks.insertClockIn.mockRejectedValueOnce(pgErr);
    // After the race, findOpenEntry will now find the winning entry
    // (second call, for the 409 payload).
    mocks.findOpenEntry
      .mockResolvedValueOnce(null) // initial advisory check
      .mockResolvedValueOnce({
        id: 'entry-winner',
        work_date: '2026-04-20',
        clock_in_at: new Date().toISOString(),
        status: 'open',
      });

    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(409);
    const body = captured.body as {
      error?: { details?: { reason?: string; raced?: boolean; openEntryId?: string } };
    };
    expect(body.error?.details?.reason).toBe('open_entry');
    expect(body.error?.details?.raced).toBe(true);
    expect(body.error?.details?.openEntryId).toBe('entry-winner');
  });

  it('logs low_accuracy exception when accuracy_m > 100', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        lat: -26.27,
        lon: 27.95,
        accuracy_m: 250,
        client_occurred_at: nowIso(),
        selfie_base64: FAKE_SELFIE,
      }),
      res
    );
    expect(captured.statusCode).toBe(200);
    const calls = mocks.insertException.mock.calls.map((c: unknown[]) => c[0]);
    const lowAcc = calls.find(
      (c) => (c as { details?: { reason?: string } }).details?.reason === 'low_accuracy'
    );
    expect(lowAcc).toBeDefined();
  });
});
