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

const { verifyToken, getSession, deleteSession, deleteEveryUserSession, deleteAllUserSessions } =
  vi.hoisted(() => ({
    verifyToken: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteEveryUserSession: vi.fn(),
    deleteAllUserSessions: vi.fn(),
  }));

// Both sweep functions are mocked, and the negatives below assert on BOTH. Asserting
// only the one the handler happens to call today would go quietly vacuous the moment
// that choice changes — which is exactly what happened when `allDevices` moved from
// `deleteAllUserSessions` to `deleteEveryUserSession`.
vi.mock('@/lib/auth', () => ({
  verifyToken,
  getSession,
  deleteSession,
  deleteEveryUserSession,
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
    // live browser session — by either sweep.
    expect(deleteEveryUserSession).not.toHaveBeenCalled();
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
    // Kind-agnostic: "all devices" must include MCP connectors, so the browser-only
    // sweep is the wrong one here.
    expect(deleteEveryUserSession).toHaveBeenCalledWith('user-1');
    expect(deleteAllUserSessions).not.toHaveBeenCalled();
  });

  /**
   * `getSession` returns null both when the row is gone and when it has expired, while
   * the JWT stays valid until its own exp. That is the state a REVOKED MCP token sits
   * in — and since the JWT carries no `kind`, the `session?.kind === 'mcp'` check above
   * cannot see it: `undefined === 'mcp'` is false, so the gate silently does not fire.
   * Without the null check, a revoked read-only token could still wipe every session on
   * the account, which is the exact act this gate exists to prevent.
   */
  it('refuses the all-devices sweep when the session cannot be resolved', async () => {
    getSession.mockResolvedValue(null);
    const { req, res } = post({ allDevices: true });

    await handler(req, res);

    expect(deleteEveryUserSession).not.toHaveBeenCalled();
    expect(deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('does not claim "all devices" when the sweep was withheld', async () => {
    getSession.mockResolvedValue(null);
    const { req, res } = post({ allDevices: true });

    await handler(req, res);

    // Cookie relief is preserved — only the destructive sweep is withheld.
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).data.message).toBe('Logged out successfully');
    expect(String(res.getHeader('Set-Cookie'))).toContain('Max-Age=0');
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
