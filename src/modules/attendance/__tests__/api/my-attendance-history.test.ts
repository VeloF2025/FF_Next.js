/**
 * Tests for GET /api/my/attendance/history — focus on the limit clamping
 * logic that guards against DoS / runaway pulls.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  listRecentEntries: vi.fn(),
  mapOpenCorrectionsByEntry: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/attendance/portal/sessionUtils', () => ({
  verifySession: mocks.verifySession,
}));
vi.mock('@/modules/attendance/portal/clockUtils', () => ({
  listRecentEntries: mocks.listRecentEntries,
}));
vi.mock('@/modules/attendance/workflow/correctionEligibility', () => ({
  mapOpenCorrectionsByEntry: mocks.mapOpenCorrectionsByEntry,
}));

import handler from '../../../../../pages/api/my/attendance/history';

const VALID_SESSION = {
  sessionId: 'sid', staffId: 'staff-1', staffName: 'T',
  method: 'pin' as const,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

function makeReq(query: Record<string, string> = {}): NextApiRequest {
  return {
    method: 'GET',
    query,
    headers: { 'user-agent': 'test' },
    socket: {},
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
  mocks.listRecentEntries.mockResolvedValue([]);
  mocks.mapOpenCorrectionsByEntry.mockResolvedValue(new Map());
});

function entryRow(id: string) {
  return {
    id,
    work_date: '2026-08-11',
    clock_in_at: '2026-08-11T05:52:00.000Z',
    clock_out_at: null,
    status: 'open',
    site_geofence_id: null,
    vehicle_assignment_id: null,
    selfie_in_url: null,
    selfie_out_url: null,
  };
}

function entriesOf(captured: { body?: unknown }) {
  return (captured.body as { data: { entries: { entryId: string; correctionExceptionId: string | null }[] } })
    .data.entries;
}

describe('GET /api/my/attendance/history', () => {
  it('uses default 14 when no limit given', async () => {
    const { res } = makeRes();
    await handler(makeReq(), res);
    expect(mocks.listRecentEntries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 14 })
    );
  });

  it('caps at 60 when a larger limit is requested', async () => {
    const { res } = makeRes();
    await handler(makeReq({ limit: '1000' }), res);
    expect(mocks.listRecentEntries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 60 })
    );
  });

  it('falls back to 14 for non-numeric limit', async () => {
    const { res } = makeRes();
    await handler(makeReq({ limit: 'abc' }), res);
    expect(mocks.listRecentEntries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 14 })
    );
  });

  it('falls back to 14 for negative limit', async () => {
    const { res } = makeRes();
    await handler(makeReq({ limit: '-5' }), res);
    expect(mocks.listRecentEntries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 14 })
    );
  });

  it('honours a valid in-range limit', async () => {
    const { res } = makeRes();
    await handler(makeReq({ limit: '30' }), res);
    expect(mocks.listRecentEntries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 30 })
    );
  });
});

describe('GET /api/my/attendance/history — correction targets', () => {
  it('exposes the open exception id for the entry that has one', async () => {
    mocks.listRecentEntries.mockResolvedValue([entryRow('entry-1'), entryRow('entry-2')]);
    mocks.mapOpenCorrectionsByEntry.mockResolvedValue(new Map([['entry-1', 'exception-1']]));

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    // Scoped to the caller, and asked only for the entries being rendered.
    expect(mocks.mapOpenCorrectionsByEntry).toHaveBeenCalledWith('staff-1', ['entry-1', 'entry-2']);
    const entries = entriesOf(captured);
    expect(entries.map((e) => [e.entryId, e.correctionExceptionId])).toEqual([
      ['entry-1', 'exception-1'],
      // Null, not undefined: the UI hides the correction button on this one
      // rather than linking to a form the POST route would 409.
      ['entry-2', null],
    ]);
  });

  it('returns null for every entry when nothing is awaiting the worker', async () => {
    mocks.listRecentEntries.mockResolvedValue([entryRow('entry-1')]);
    mocks.mapOpenCorrectionsByEntry.mockResolvedValue(new Map());

    const { res, captured } = makeRes();
    await handler(makeReq(), res);

    expect(entriesOf(captured)[0].correctionExceptionId).toBeNull();
  });
});
