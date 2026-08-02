import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../metrics-list';
import { METRICS } from '@/modules/metrics/registry';
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

/** The `data` array the handler passed to apiResponse.success. */
function payload(res: ReturnType<typeof mockRes>) {
  const body = res.json.mock.calls.at(-1)?.[0] as { data?: unknown[] } | undefined;
  return body?.data ?? [];
}

beforeEach(() => {
  vi.mocked(userHasPermission).mockReset();
});

describe('GET /api/metrics-list', () => {
  it('rejects POST — MCP tokens are GET-only', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 401 when req.user is absent rather than listing the catalogue', async () => {
    // The catalogue names internal tables and predicates in `cite`; failing open
    // here would publish them.
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(userHasPermission).not.toHaveBeenCalled();
  });

  it('lists every metric for a super admin without consulting RBAC', async () => {
    const res = mockRes();
    await handler(
      { method: 'GET', query: {}, user: { id: 'u1', role: 'super_admin' } } as never,
      res as never,
    );
    expect(payload(res)).toHaveLength(METRICS.length);
    expect(userHasPermission).not.toHaveBeenCalled();
  });

  it('hides a metric the caller may not view', async () => {
    // Permit only zone_uptake. All three share one permission key today, so the
    // filter is driven per-call to prove it is actually per-metric.
    let call = 0;
    vi.mocked(userHasPermission).mockImplementation(async () => call++ === 0);
    const res = mockRes();
    await handler(
      { method: 'GET', query: {}, user: { id: 'u1', role: 'manager' } } as never,
      res as never,
    );
    const listed = payload(res) as Array<{ key: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]!.key).toBe(METRICS[0]!.key);
  });

  it('returns nothing at all when the caller may view no metric', async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const res = mockRes();
    await handler(
      { method: 'GET', query: {}, user: { id: 'u1', role: 'viewer' } } as never,
      res as never,
    );
    expect(payload(res)).toHaveLength(0);
  });

  it('publishes additivity, without which `total` cannot be interpreted', async () => {
    vi.mocked(userHasPermission).mockResolvedValue(true);
    const res = mockRes();
    await handler(
      { method: 'GET', query: {}, user: { id: 'u1', role: 'manager' } } as never,
      res as never,
    );
    for (const entry of payload(res) as Array<{ key: string; additivity?: string }>) {
      expect(entry.additivity, `${entry.key} omits additivity`).toBeTruthy();
    }
  });
});
