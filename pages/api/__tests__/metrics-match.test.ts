import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../metrics-match';
import { userHasPermission } from '@/lib/permissions';

vi.mock('@/lib/permissions', () => ({
  userHasPermission: vi.fn(),
}));

function mockRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

function payload(res: ReturnType<typeof mockRes>) {
  const body = res.json.mock.calls.at(-1)?.[0] as { data?: Record<string, unknown> } | undefined;
  return body?.data ?? {};
}

const PP_QUESTION = 'how many open pre-provisions';
// `user` defaults via ?? rather than a default parameter: a default parameter
// fires on `undefined`, so passing undefined to mean "no session" would silently
// hand the handler a real user and the 401 case would never be exercised.
const req = (query: Record<string, unknown>, user?: unknown) =>
  ({ method: 'GET', query, user: user ?? undefined }) as never;
const AS_MANAGER = { id: 'u1', role: 'manager' };

beforeEach(() => {
  vi.mocked(userHasPermission).mockReset();
  vi.mocked(userHasPermission).mockResolvedValue(true);
});

describe('GET /api/metrics-match', () => {
  it('rejects POST — MCP tokens are GET-only', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects a missing question with 400', async () => {
    const res = mockRes();
    await handler(req({}, AS_MANAGER), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a blank question with 400 rather than matching nothing', async () => {
    const res = mockRes();
    await handler(req({ q: '   ' }, AS_MANAGER), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a duplicated q parameter', async () => {
    const res = mockRes();
    await handler(req({ q: ['a', 'b'] }, AS_MANAGER), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 401 when req.user is absent rather than matching anyway', async () => {
    const res = mockRes();
    await handler(req({ q: PP_QUESTION }), res as never);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(userHasPermission).not.toHaveBeenCalled();
  });

  it('resolves a question to a metric key', async () => {
    const res = mockRes();
    await handler(req({ q: PP_QUESTION }, AS_MANAGER), res as never);
    const data = payload(res) as { kind: string; metric?: { key: string } };
    expect(data.kind).toBe('exact');
    expect(data.metric?.key).toBe('pp_open_balance');
  });

  it('does not match a metric the caller may not read', async () => {
    // Matching over the full registry and filtering afterwards would still
    // advertise a hidden metric's existence. The same question that resolves
    // above must come back as no-match here.
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const res = mockRes();
    await handler(req({ q: PP_QUESTION }, { id: 'u1', role: 'viewer' }), res as never);
    expect((payload(res) as { kind: string }).kind).toBe('none');
  });

  it('skips the permission lookup entirely for a super admin', async () => {
    const res = mockRes();
    await handler(req({ q: PP_QUESTION }, { id: 'u1', role: 'super_admin' }), res as never);
    expect(userHasPermission).not.toHaveBeenCalled();
    expect((payload(res) as { kind: string }).kind).toBe('exact');
  });

  it('returns a structured 500 when the RBAC lookup fails, not a framework error', async () => {
    // withAuth returns the handler promise rather than awaiting it, so an
    // unhandled rejection here would escape into Next's default error path with
    // no log line and no response envelope.
    vi.mocked(userHasPermission).mockRejectedValue(new Error('db down'));
    const res = mockRes();
    await handler(req({ q: PP_QUESTION }, AS_MANAGER), res as never);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('reports no match so the caller can fall back to RAG', async () => {
    const res = mockRes();
    await handler(req({ q: 'what did we discuss about splicing' }, AS_MANAGER), res as never);
    expect((payload(res) as { kind: string }).kind).toBe('none');
  });

  it('never leaks the citation string, which names internal tables', async () => {
    const res = mockRes();
    await handler(req({ q: PP_QUESTION }, AS_MANAGER), res as never);
    expect(JSON.stringify(payload(res))).not.toContain('metric_snapshots');
  });
});
