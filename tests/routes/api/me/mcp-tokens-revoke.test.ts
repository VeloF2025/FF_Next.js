/**
 * Tests for DELETE /api/me/mcp-tokens/:id.
 *
 * The ownership check in this handler is the only thing standing between a user and
 * another user's session row, so it is pinned here: not-yours, not-an-mcp-session and
 * does-not-exist must all be refused, all with the SAME message so the endpoint cannot
 * be used to probe for valid session ids.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, deleteSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/auth');
  return { ...actual, getSession, deleteSession, withAuth: (h: unknown) => h };
});

import handler from '@/pages/api/me/mcp-tokens/[id]';

type MockRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  // apiResponse.methodNotAllowed sets an Allow header — without this the handler's own
  // catch turns a 405 into a 500 and the test would be asserting on the mock, not the code.
  setHeader: ReturnType<typeof vi.fn>;
};

const makeRes = (): MockRes => {
  const r = {} as MockRes;
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  r.setHeader = vi.fn().mockReturnValue(r);
  return r;
};

const makeReq = (method: string, id?: string) =>
  ({
    method,
    query: id === undefined ? {} : { id },
    headers: {},
    body: {},
    user: { id: 'u1', email: 'lew@x.co' },
  }) as never;

const bodyOf = (res: MockRes) => JSON.stringify(res.json.mock.calls);

/** The error payload only — the response envelope carries a timestamp that would
 *  otherwise make two identical refusals compare unequal. */
const errorOf = (res: MockRes) =>
  JSON.stringify((res.json.mock.calls[0]?.[0] as { error?: unknown })?.error);

describe('DELETE /api/me/mcp-tokens/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FF_MCP_TOKEN_UI_ENABLED = 'true';
  });

  it('404s when the feature flag is off, without touching the database', async () => {
    process.env.FF_MCP_TOKEN_UI_ENABLED = '';
    const res = makeRes();
    await handler(makeReq('DELETE', 's1'), res as never);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(getSession).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('revokes the caller’s own mcp session', async () => {
    getSession.mockResolvedValue({ id: 's1', userId: 'u1', kind: 'mcp' });
    const res = makeRes();
    await handler(makeReq('DELETE', 's1'), res as never);
    expect(deleteSession).toHaveBeenCalledWith('s1');
    expect(bodyOf(res)).toContain('revoked');
  });

  it('refuses another user’s session and does not delete it', async () => {
    getSession.mockResolvedValue({ id: 's9', userId: 'SOMEONE-ELSE', kind: 'mcp' });
    const res = makeRes();
    await handler(makeReq('DELETE', 's9'), res as never);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('refuses a browser session id and does not delete it', async () => {
    getSession.mockResolvedValue({ id: 's2', userId: 'u1', kind: 'browser' });
    const res = makeRes();
    await handler(makeReq('DELETE', 's2'), res as never);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('gives the same answer for all three refusals, so ids cannot be probed', async () => {
    const bodies: string[] = [];
    for (const session of [
      null,
      { id: 's9', userId: 'SOMEONE-ELSE', kind: 'mcp' },
      { id: 's2', userId: 'u1', kind: 'browser' },
    ]) {
      getSession.mockResolvedValue(session);
      const res = makeRes();
      await handler(makeReq('DELETE', 'probe'), res as never);
      expect(res.status).toHaveBeenCalledWith(403);
      bodies.push(errorOf(res));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('Token not found or not yours');
  });

  it('rejects a non-DELETE method', async () => {
    const res = makeRes();
    await handler(makeReq('GET', 's1'), res as never);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('rejects a missing id', async () => {
    const res = makeRes();
    await handler(makeReq('DELETE'), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getSession).not.toHaveBeenCalled();
  });
});
