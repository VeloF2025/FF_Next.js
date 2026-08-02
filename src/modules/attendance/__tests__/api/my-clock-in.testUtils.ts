import type { NextApiRequest, NextApiResponse } from 'next';
import { vi } from 'vitest';

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
  findRequiredAttendanceAction: vi.fn(),
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
  captureRateAtClockIn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/attendance/portal/geofenceUtils', () => ({
  matchGeofence: mocks.matchGeofence,
}));

vi.mock('@/modules/attendance/portal/selfieUtils', () => ({
  storeSelfie: mocks.storeSelfie,
}));

vi.mock('@/modules/attendance/portal/clockInFinalization', () => ({
  finalizeClockIn: async (args: unknown) => ({
    ok: true,
    entry: await mocks.insertClockIn(args),
  }),
}));

vi.mock('@/modules/attendance/workflow/requiredActionQueries', () => ({
  findRequiredAttendanceAction: mocks.findRequiredAttendanceAction,
}));

vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

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

export function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export const FAKE_SELFIE = 'A'.repeat(200);

export function makeReq(body: unknown): NextApiRequest {
  return {
    method: 'POST',
    body,
    headers: { 'user-agent': 'test' },
    socket: { remoteAddress: '127.0.0.1' },
    query: {},
  } as unknown as NextApiRequest;
}

export interface CapturedRes {
  statusCode: number;
  body?: unknown;
  headers: Record<string, string | number | string[] | undefined>;
}

export function makeRes(): { res: NextApiResponse; captured: CapturedRes } {
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

export function resetClockInMocks(): void {
  vi.clearAllMocks();
  mocks.verifySession.mockResolvedValue({ valid: true, session: VALID_SESSION });
  mocks.getSelfieConsentState.mockResolvedValue('granted');
  mocks.findOpenEntry.mockResolvedValue(null);
  mocks.findRequiredAttendanceAction.mockResolvedValue(null);
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
}

export { handler, mocks };
