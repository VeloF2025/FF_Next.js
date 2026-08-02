import { describe, it, expect, vi, beforeEach } from 'vitest';
import wrapped, { handler } from '../metrics-query';
import { userHasPermission } from '@/lib/permissions';

// The permission lookup is a database round-trip. It has its own tests; what is
// under test here is whether this endpoint *asks* and whether it obeys the answer.
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

const VALID = { key: 'zone_uptake', from: '2026-07-01', to: '2026-07-31', grain: 'week' };

beforeEach(() => {
  vi.mocked(userHasPermission).mockReset();
});

describe('metrics-query auth', () => {
  it('returns 401 with no session', async () => {
    const res = mockRes();
    await wrapped(
      { method: 'GET', query: VALID, headers: {}, cookies: {} } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when req.user is absent even though the request is otherwise valid', async () => {
    // Guards the fail-open shape directly: a null user must DENY, not fall through
    // to the `role === 'super_admin'` comparison (which evaluates false on null and
    // reads as "just not an admin") and on into the permission call with an
    // undefined id.
    const res = mockRes();
    await handler({ method: 'GET', query: VALID } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(userHasPermission).not.toHaveBeenCalled();
  });

  it('returns 403 for an authenticated user without the metric permission', async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const res = mockRes();
    await handler(
      { method: 'GET', query: VALID, user: { id: 'u1', role: 'viewer' } } as never,
      res as never,
    );
    expect(userHasPermission).toHaveBeenCalledWith('u1', 'analytics.reports', 'view');
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('checks the permission the metric declares, not a hard-coded one', async () => {
    // The whole reason this is a runtime check rather than the repo's static
    // withPermission() composition: the required permission is per-metric.
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { ...VALID, key: 'pp_open_balance', grain: 'day' },
        user: { id: 'u1', role: 'viewer' },
      } as never,
      res as never,
    );
    expect(userHasPermission).toHaveBeenCalledWith('u1', 'analytics.reports', 'view');
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
