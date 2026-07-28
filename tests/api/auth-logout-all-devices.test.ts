/**
 * Regression guard: "log out of all devices" must sweep MCP sessions too.
 *
 * Adding a `kind` column to `user_sessions` introduced a browser-only default on
 * `deleteAllUserSessions`. Left wired to this route, the `allDevices` branch would have
 * deleted browser rows ONLY — so a user who suspected compromise and hit "sign out
 * everywhere" would keep a live MCP token (provisionable for up to 90 days), while the
 * handler still answered "Logged out from all devices". The claim has to stay true.
 *
 * The assertions that matter are the pairing: `allDevices` takes the kind-agnostic
 * sweep, and ordinary logout does NOT — a routine sign-out must leave connectors alive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { verifyToken, getSession, deleteSession, deleteEveryUserSession, deleteAllUserSessions } =
  vi.hoisted(() => ({
    verifyToken: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteEveryUserSession: vi.fn(),
    deleteAllUserSessions: vi.fn(),
  }));

// `getSession` is not imported by this handler yet — the read-only gate that calls it
// lands in the next PR of this stack. Mocked here anyway so this file keeps testing the
// sweep rather than silently exercising the handler's catch block once that gate arrives:
// an unmocked `getSession` is `undefined`, `await undefined(...)` throws, and the catch
// returns a bland 200 that looks nothing like the assertion that was meant to run.
vi.mock('@/lib/auth', () => ({
  verifyToken,
  getSession,
  deleteSession,
  deleteEveryUserSession,
  deleteAllUserSessions,
  AUTH_COOKIE_NAME: 'ff_auth_token',
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const USER_ID = 'user-1';
const SESSION_ID = 'sess-1';

async function callLogout(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    body,
  });
  req.cookies = { ff_auth_token: 'the.jwt.value' };
  const handler = (await import('@/pages/api/auth/logout')).default;
  await handler(req, res);
  return res;
}

describe('POST /api/auth/logout — allDevices sweeps every session kind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyToken.mockResolvedValue({ sub: USER_ID, sessionId: SESSION_ID });
    // A browser session: the caller is a real user, not a read-only MCP token.
    getSession.mockResolvedValue({ id: SESSION_ID, userId: USER_ID, kind: 'browser' });
  });

  it('allDevices sweeps kind-agnostically, so an MCP token cannot survive it', async () => {
    const res = await callLogout({ allDevices: true });

    expect(res._getStatusCode()).toBe(200);
    expect(deleteEveryUserSession).toHaveBeenCalledTimes(1);
    expect(deleteEveryUserSession).toHaveBeenCalledWith(USER_ID);
    // The browser-only variant would leave mcp rows behind — it must not be used here.
    expect(deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('still claims "all devices" only because the sweep really is all devices', async () => {
    const res = await callLogout({ allDevices: true });

    expect(JSON.parse(res._getData()).data.message).toBe('Logged out from all devices');
    expect(deleteEveryUserSession).toHaveBeenCalledTimes(1);
  });

  it('ordinary logout drops only the current session, leaving connectors alive', async () => {
    const res = await callLogout({});

    expect(res._getStatusCode()).toBe(200);
    expect(deleteSession).toHaveBeenCalledWith(SESSION_ID);
    expect(deleteEveryUserSession).not.toHaveBeenCalled();
    expect(deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('clears the auth cookie on the allDevices path', async () => {
    const res = await callLogout({ allDevices: true });

    const cookie = String(res.getHeader('Set-Cookie'));
    expect(cookie).toContain('ff_auth_token=');
    expect(cookie).toContain('Max-Age=0');
  });
});
