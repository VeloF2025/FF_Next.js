/**
 * `pages/api/auth/logout.ts` resolves the user itself via `verifyToken` rather than going
 * through `withAuth`, so it does not inherit the read-only MCP gate. Without an explicit
 * check, an MCP token could POST here and — with `allDevices` — terminate every session
 * on the account, including the owner's live browser session.
 *
 * The tests that matter are the two negatives: a read-only session must delete NOTHING,
 * and a browser session must still be able to log out (the gate must not break logout).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';

const { verifyToken, getSession, deleteSession, deleteAllUserSessions } = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteAllUserSessions: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  verifyToken,
  getSession,
  deleteSession,
  deleteAllUserSessions,
  AUTH_COOKIE_NAME: 'ff_auth_token',
}));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import handler from '@/pages/api/auth/logout';

function post(body: Record<string, unknown> = {}) {
  const { req, res } = createMocks({
    method: 'POST',
    body,
    cookies: { ff_auth_token: 'the.jwt' },
  });
  return { req: req as never, res: res as never & { _getStatusCode(): number; _getData(): string } };
}

describe('POST /api/auth/logout — read-only gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyToken.mockResolvedValue({ sub: 'user-1', sessionId: 'sess-1' });
  });

  it('refuses a read-only MCP session and deletes nothing', async () => {
    getSession.mockResolvedValue({ id: 'sess-1', userId: 'user-1', kind: 'mcp' });
    const { req, res } = post({ allDevices: true });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(JSON.parse(res._getData()).error.code).toBe('MCP_READ_ONLY');
    // The whole point: a read-only credential must not be able to end the account's
    // live browser session.
    expect(deleteAllUserSessions).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('still logs out a normal browser session', async () => {
    getSession.mockResolvedValue({ id: 'sess-1', userId: 'user-1', kind: 'browser' });
    const { req, res } = post();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(deleteSession).toHaveBeenCalledWith('sess-1');
  });

  it('still sweeps all devices for a browser session', async () => {
    getSession.mockResolvedValue({ id: 'sess-1', userId: 'user-1', kind: 'browser' });
    const { req, res } = post({ allDevices: true });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(deleteAllUserSessions).toHaveBeenCalledWith('user-1');
  });

  it('still clears the cookie when the token is invalid', async () => {
    // This route deliberately forgives a bad token so a stale cookie can always be shed.
    // The gate must not turn that into a 401 — which is why withAuth was not used.
    verifyToken.mockResolvedValue(null);
    const { req, res } = post();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
