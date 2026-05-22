/**
 * Auth-isolation test for GET /api/my/stores/today.
 *
 * The sibling stores-today.test.ts mocks withMySession as passthrough so it
 * can exercise the handler's 200/405/error paths without real session
 * machinery. That gap leaves the 401 path uncovered (review-team flag M7).
 *
 * This file imports the REAL withMySession + verifySession and drives the
 * handler with a request that has no session cookie — asserting the wrapper
 * actually denies entry before the handler can run.
 */
import { describe, it, expect, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Mock the service so the handler can't reach a real DB even if auth somehow
// passes — the test would still fail-shut. Also mock logger to silence output.
vi.mock('@/modules/field-stock-pwa/services/storesTodayService', () => ({
  getTodayForStoresUser: vi.fn(async () => []),
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// IMPORTANT: do NOT mock withMySession — this file's whole point is to
// exercise the real wrapper.
import handler from '../../../pages/api/my/stores/today';

function makeRes() {
  const res = { headers: {} as Record<string, string> } as NextApiResponse & {
    statusCode?: number;
    jsonData?: { success: boolean; error?: { code?: string; message?: string } };
    headers: Record<string, string>;
  };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as NextApiResponse['status'];
  res.json = vi.fn((data) => {
    res.jsonData = data;
    return res;
  }) as NextApiResponse['json'];
  res.setHeader = vi.fn((name: string, value: string | number | readonly string[]) => {
    res.headers[name] = String(value);
    return res;
  }) as NextApiResponse['setHeader'];
  return res;
}

describe('GET /api/my/stores/today — real withMySession', () => {
  it('returns 401 when no ff_my_session cookie is present', async () => {
    const req = {
      method: 'GET',
      query: {},
      cookies: {},
      headers: {},
    } as unknown as NextApiRequest;
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonData?.success).toBe(false);
  });

  it('returns 401 when the cookie is present but malformed', async () => {
    const req = {
      method: 'GET',
      query: {},
      cookies: { ff_my_session: 'not-a-valid-signed-cookie' },
      headers: {},
    } as unknown as NextApiRequest;
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonData?.success).toBe(false);
  });
});
