import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above every top-level statement, so the spies they
// close over must be created inside vi.hoisted.
const { mintFfMcpToken, getUserSessions } = vi.hoisted(() => ({
  mintFfMcpToken: vi.fn(),
  getUserSessions: vi.fn(),
}));

vi.mock('@/lib/auth/mcpToken', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/mcpToken')>('@/lib/auth/mcpToken');
  return { ...actual, mintFfMcpToken };
});
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/auth');
  return {
    ...actual,
    getUserSessions,
    // withAuth is exercised separately; here it passes the handler through so the test
    // can supply an already-verified req.user, matching the real wrapper's contract.
    withAuth: (h: unknown) => h,
  };
});

import handler from '../mcp-tokens';

type MockRes = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

const makeRes = (): MockRes => {
  const r = {} as MockRes;
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
};

const makeReq = (method: string, body?: unknown) =>
  ({ method, body, query: {}, headers: {}, user: { id: 'u1', email: 'lew@x.co' } }) as never;

describe('/api/me/mcp-tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FF_MCP_TOKEN_UI_ENABLED = 'true';
  });

  it('404s when the feature flag is off', async () => {
    process.env.FF_MCP_TOKEN_UI_ENABLED = '';
    const res = makeRes();
    await handler(makeReq('POST', {}), res as never);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mintFfMcpToken).not.toHaveBeenCalled();
  });

  it('rejects an unknown lifetime without minting', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { lifetime: '10y' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mintFfMcpToken).not.toHaveBeenCalled();
  });

  it('defaults to 30d and passes the verified user through', async () => {
    mintFfMcpToken.mockResolvedValue({
      token: 'jwt',
      expiresAt: new Date('2026-08-24'),
      sessionId: 's1',
    });
    const res = makeRes();
    await handler(makeReq('POST', {}), res as never);
    expect(mintFfMcpToken).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      '30d',
      expect.objectContaining({ label: undefined })
    );
  });

  it('lists only mcp sessions and never leaks token_hash', async () => {
    getUserSessions.mockResolvedValue([
      {
        id: 's1',
        kind: 'mcp',
        label: 'Claude',
        tokenHash: 'SECRETHASH',
        createdAt: new Date(),
        expiresAt: new Date(),
        lastUsedAt: undefined,
      },
    ]);
    const res = makeRes();
    await handler(makeReq('GET'), res as never);
    expect(getUserSessions).toHaveBeenCalledWith('u1', 'mcp');
    const payload = JSON.stringify(res.json.mock.calls);
    expect(payload).not.toContain('SECRETHASH');
    expect(payload).toContain('s1');
  });
});
