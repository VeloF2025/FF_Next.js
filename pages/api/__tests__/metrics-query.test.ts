import { describe, it, expect, vi } from 'vitest';
// Import the NAMED handler, not the default export. The default is wrapped in
// withAuth, so an unauthenticated request returns 401 before reaching any of the
// 400/404/405 paths below — the assertions would pass against the wrong status.
// Auth itself is covered in metrics-query.auth.test.ts.
import { handler } from '../metrics-query';

function mockRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  // methodNotAllowed sets the Allow header; without this the 405 test throws
  // "res.setHeader is not a function" instead of asserting the status.
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

const get = (query: Record<string, string>) => ({ method: 'GET', query }) as never;
const VALID = { key: 'zone_uptake', from: '2026-07-01', to: '2026-07-31', grain: 'week' };

describe('GET /api/metrics-query', () => {
  it('rejects POST — MCP tokens are GET-only, so POST must never be accepted', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects an unknown metric key with 404, not a zero', async () => {
    const res = mockRes();
    await handler(get({ ...VALID, key: 'nope' }), res as never);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejects an unsupported grain with 400 rather than silently downgrading it', async () => {
    const res = mockRes();
    await handler(get({ ...VALID, grain: 'day' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a dimension the metric does not declare with 400', async () => {
    const res = mockRes();
    await handler(get({ ...VALID, dimensions: 'pop' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a missing required field with 400', async () => {
    const res = mockRes();
    await handler(get({ key: 'zone_uptake' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a malformed date with 400', async () => {
    const res = mockRes();
    await handler(get({ ...VALID, from: '01-07-2026' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a real-looking but non-existent date with 400', async () => {
    const res = mockRes();
    await handler(get({ ...VALID, from: '2026-02-31' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an inverted range with 400', async () => {
    const res = mockRes();
    await handler(get({ ...VALID, from: '2026-07-31', to: '2026-07-01' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a range beyond the maximum with 400', async () => {
    const res = mockRes();
    await handler(get({ ...VALID, from: '2020-01-01' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects year 0000, which JS accepts but PostgreSQL cannot parse', async () => {
    const res = mockRes();
    await handler(get({ ...VALID, from: '0000-01-01', to: '0000-01-02' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a duplicated query parameter rather than silently taking the first', async () => {
    const res = mockRes();
    await handler(
      { method: 'GET', query: { ...VALID, key: ['zone_uptake', 'pp_open_balance'] } } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an empty dimension token rather than normalising it away', async () => {
    const res = mockRes();
    await handler(get({ ...VALID, dimensions: 'project,,zone' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('counts an inclusive range correctly at the boundary', async () => {
    // 2026-01-01..2027-01-01 is exactly 366 inclusive days — the limit, allowed.
    // 2027-01-02 is 367 and must be rejected. Asserting only the reject side would
    // also pass if the +1 were missing, so both sides are checked.
    const ok = mockRes();
    await handler(get({ ...VALID, from: '2026-01-01', to: '2027-01-01' }), ok as never);
    expect(ok.status).not.toHaveBeenCalledWith(400);

    const tooLong = mockRes();
    await handler(get({ ...VALID, from: '2026-01-01', to: '2027-01-02' }), tooLong as never);
    expect(tooLong.status).toHaveBeenCalledWith(400);
  });
});
