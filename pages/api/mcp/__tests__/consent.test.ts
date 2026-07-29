import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above every top-level statement, so the spies they
// close over must be created inside vi.hoisted.
const { mintFfMcpToken, deleteSession, logError, logWarn } = vi.hoisted(() => ({
  mintFfMcpToken: vi.fn(),
  deleteSession: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: logError, warn: logWarn, info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/mcpToken', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/mcpToken')>('@/lib/auth/mcpToken');
  return { ...actual, mintFfMcpToken };
});
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/auth');
  return {
    ...actual,
    deleteSession,
    // Mirrors the real wrapper's contract (401 with no verified user) rather than a
    // blind passthrough, so a handler that dropped withAuth fails the unauth case here.
    withAuth:
      (h: (req: unknown, res: unknown) => unknown) =>
      (req: { user?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
        if (!req.user) {
          res.status(401).json({ success: false });
          return;
        }
        return h(req, res);
      },
  };
});

import handler from '../consent';

type MockRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
};

const makeRes = (): MockRes => {
  const r = {} as MockRes;
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  r.setHeader = vi.fn().mockReturnValue(r);
  return r;
};

const VALID_STATE_ID = 'pZJqcS1uZH4fXo0WmXtYyRA7d2NcQk5g';
const MINTED = { token: 'jwt-do-not-echo', expiresAt: new Date('2026-10-27'), sessionId: 'sess-1' };

const makeReq = (method: string, body?: unknown, user: unknown = { id: 'u1', email: 'lew@x.co' }) =>
  ({ method, body, query: {}, headers: { 'user-agent': 'vitest' }, user }) as never;

const fetchMock = vi.fn();

const responseBody = (res: MockRes) => JSON.stringify(res.json.mock.calls);

describe('/api/mcp/consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    process.env.FF_MCP_CALLBACK_SECRET = 'shared-callback-secret';
    delete process.env.FF_REMOTE_MCP_URL;
    deleteSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FF_MCP_CALLBACK_SECRET;
  });

  it('401s without a verified user and mints nothing', async () => {
    const res = makeRes();
    // null, not undefined — an explicit undefined would trigger makeReq's default user.
    await handler(makeReq('POST', { stateId: VALID_STATE_ID }, null), res as never);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mintFfMcpToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('405s non-POST methods and mints nothing', async () => {
    const res = makeRes();
    await handler(makeReq('GET'), res as never);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mintFfMcpToken).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['blank', ''],
    ['whitespace', '   '],
    ['wrong charset', 'state id with spaces!'],
    ['too short', 'abc'],
    ['non-string', { nested: true }],
  ])('rejects a %s stateId with 400 and mints nothing', async (_label, stateId) => {
    const res = makeRes();
    await handler(makeReq('POST', { stateId }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mintFfMcpToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('502s without minting when the callback secret is not configured', async () => {
    delete process.env.FF_MCP_CALLBACK_SECRET;
    const res = makeRes();
    await handler(makeReq('POST', { stateId: VALID_STATE_ID }), res as never);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(mintFfMcpToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mints for the verified req.user, calls the service callback, and returns only the redirectUrl', async () => {
    mintFfMcpToken.mockResolvedValue(MINTED);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=abc' }),
    });
    const res = makeRes();
    // A body-supplied identity must be ignored — identity is req.user, always.
    await handler(makeReq('POST', { stateId: VALID_STATE_ID, userId: 'attacker' }), res as never);

    expect(mintFfMcpToken).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      '90d',
      expect.objectContaining({ label: 'Claude connector', userAgent: 'vitest' })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:7416/authorize/complete');
    expect(init.method).toBe('POST');
    expect(init.headers['x-ff-mcp-secret']).toBe('shared-callback-secret');
    expect(JSON.parse(init.body)).toEqual({ stateId: VALID_STATE_ID, token: MINTED.token });

    expect(deleteSession).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: { redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=abc' },
      })
    );
    expect(responseBody(res)).not.toContain(MINTED.token);
  });

  it('honours FF_REMOTE_MCP_URL for the callback target', async () => {
    process.env.FF_REMOTE_MCP_URL = 'http://127.0.0.1:9999/';
    mintFfMcpToken.mockResolvedValue(MINTED);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ redirectUrl: 'https://claude.ai/cb' }) });
    const res = makeRes();
    await handler(makeReq('POST', { stateId: VALID_STATE_ID }), res as never);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:9999/authorize/complete');
  });

  it('deletes the minted session and 502s when the callback answers non-2xx', async () => {
    mintFfMcpToken.mockResolvedValue(MINTED);
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}), text: async () => 'state expired' });
    const res = makeRes();
    await handler(makeReq('POST', { stateId: VALID_STATE_ID }), res as never);

    expect(deleteSession).toHaveBeenCalledWith(MINTED.sessionId);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(responseBody(res)).not.toContain(MINTED.token);
  });

  it('deletes the minted session and 502s when the callback is unreachable', async () => {
    mintFfMcpToken.mockResolvedValue(MINTED);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = makeRes();
    await handler(makeReq('POST', { stateId: VALID_STATE_ID }), res as never);

    expect(deleteSession).toHaveBeenCalledWith(MINTED.sessionId);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(responseBody(res)).not.toContain(MINTED.token);
  });

  it.each([
    ['javascript: URI', 'javascript:alert(document.cookie)'],
    ['data: URI', 'data:text/html,<script>alert(1)</script>'],
    ['scheme-relative', '//evil.example/cb'],
    ['not a URL at all', 'not-a-url'],
  ])(
    'deletes the session and 502s when the callback returns a %s as redirectUrl',
    async (_label, redirectUrl) => {
      // The consent page feeds this straight to window.location.assign, so a
      // non-http(s) scheme would execute in the user's authenticated origin.
      mintFfMcpToken.mockResolvedValue(MINTED);
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ redirectUrl }) });
      const res = makeRes();
      await handler(makeReq('POST', { stateId: VALID_STATE_ID }), res as never);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(deleteSession).toHaveBeenCalledWith(MINTED.sessionId);
      expect(responseBody(res)).not.toContain(redirectUrl);
    }
  );

  it('accepts a plain http redirect, so local and dev hosts still work', async () => {
    mintFfMcpToken.mockResolvedValue(MINTED);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ redirectUrl: 'http://localhost:3011/cb?code=x' }),
    });
    const res = makeRes();
    await handler(makeReq('POST', { stateId: VALID_STATE_ID }), res as never);
    expect(deleteSession).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { redirectUrl: 'http://localhost:3011/cb?code=x' } })
    );
  });

  it('500s (not 502) when minting itself fails, and never calls the service', async () => {
    // Exercises the outer catch in the default export — a mint failure is our fault,
    // not the gateway's, and there is no session to clean up because none was created.
    mintFfMcpToken.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await handler(makeReq('POST', { stateId: VALID_STATE_ID }), res as never);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('logs loudly when consent fails AND cleanup fails, so the orphan is traceable', async () => {
    mintFfMcpToken.mockResolvedValue(MINTED);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    deleteSession.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await handler(makeReq('POST', { stateId: VALID_STATE_ID }), res as never);

    // Without this the catch is a de facto empty catch: a live credential nobody can see.
    const orphanLog = logError.mock.calls.find((c) => String(c[0]).includes('ORPHANED MCP SESSION'));
    expect(orphanLog).toBeTruthy();
    expect(orphanLog?.[1]).toEqual(expect.objectContaining({ sessionId: MINTED.sessionId }));
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('deletes the session and 502s when the callback 2xx body has no redirectUrl', async () => {
    mintFfMcpToken.mockResolvedValue(MINTED);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const res = makeRes();
    await handler(makeReq('POST', { stateId: VALID_STATE_ID }), res as never);

    expect(deleteSession).toHaveBeenCalledWith(MINTED.sessionId);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('still 502s (fail closed) when the orphan cleanup itself fails', async () => {
    mintFfMcpToken.mockResolvedValue(MINTED);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    deleteSession.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await handler(makeReq('POST', { stateId: VALID_STATE_ID }), res as never);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(responseBody(res)).not.toContain(MINTED.token);
  });
});
