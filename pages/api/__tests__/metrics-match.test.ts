import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../metrics-match';
import { userHasPermission } from '@/lib/permissions';

vi.mock('@/lib/permissions', () => ({
  userHasPermission: vi.fn(),
}));

// Give pp_open_balance a permission of its own. All three real metrics declare
// `analytics.reports`, so without this no allow/deny combination could separate
// "filtered before matching" from "matched then discarded".
vi.mock('@/modules/metrics/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/metrics/registry')>();
  return {
    ...actual,
    METRICS: actual.METRICS.map((m) =>
      m.key === 'pp_open_balance' ? { ...m, permission: 'hidden.permission' } : m,
    ),
  };
});

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

  it('returns additivity, so a client can size its date window before querying', async () => {
    // Without this a caller cannot tell a level from an event count until AFTER it has
    // committed to a window — by which point the window is what produced the number.
    // pp_open_balance is a nightly stock, so it must report as semi-additive.
    const res = mockRes();
    await handler(req({ q: PP_QUESTION }, AS_MANAGER), res as never);
    const data = payload(res) as { metric?: { additivity?: string } };
    expect(data.metric?.additivity).toBe('semi-additive');
  });

  it('does not match a metric the caller may not read', async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const res = mockRes();
    await handler(req({ q: PP_QUESTION }, { id: 'u1', role: 'viewer' }), res as never);
    expect((payload(res) as { kind: string }).kind).toBe('none');
  });

  it('filters BEFORE matching, so a hidden metric cannot mask a permitted one', async () => {
    // ⚠️ Denying everything and expecting 'none' does NOT distinguish the two
    // orderings — match-then-discard produces 'none' too. This question contains
    // both 'open pre-provisions' (19 chars) and 'zone uptake' (11), so the
    // longest-alias rule makes the DENIED metric win outright:
    //   filter first        -> zone_uptake, an answer the caller may have
    //   match then discard  -> 'none', a false dead end
    // The registry is mocked because all three real metrics share one permission
    // key, so no combination of allow/deny on the real registry could separate them.
    vi.mocked(userHasPermission).mockImplementation(
      async (_userId: string, permission: string) => permission !== 'hidden.permission',
    );
    const res = mockRes();
    await handler(
      req({ q: 'zone uptake versus open pre-provisions' }, AS_MANAGER),
      res as never,
    );
    const data = payload(res) as { kind: string; metric?: { key: string } };
    expect(data.kind).toBe('exact');
    expect(data.metric?.key).toBe('zone_uptake');
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
    // The status alone would still pass against a bare `res.status(500)` with no
    // body, which is exactly the framework-level failure this guards against — so
    // assert the envelope the repo's contract promises.
    const body = res.json.mock.calls.at(-1)?.[0] as {
      success?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(body?.success).toBe(false);
    expect(body?.error?.code).toBeTruthy();
    // ...and it must not leak the underlying database error to the caller.
    expect(JSON.stringify(body)).not.toContain('db down');
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
