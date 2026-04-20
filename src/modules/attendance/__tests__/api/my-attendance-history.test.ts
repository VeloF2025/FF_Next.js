/**
 * Tests for GET /api/my/attendance/history — focus on the limit clamping
 * logic that guards against DoS / runaway pulls.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  listRecentEntries: vi.fn(),
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
});

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
