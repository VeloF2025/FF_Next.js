import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The handler acquires a pool connection only after auth and validation pass, so
// these tests never reach the DB. Mocked anyway so an accidental fall-through
// fails loudly rather than opening a real connection.
vi.mock('@/lib/db', () => ({
  default: { connect: vi.fn(async () => { throw new Error('should not connect in these tests'); }) },
}));

import handler from '@/pages/api/cron/metrics-snapshot';

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

const SECRET = 'test-cron-secret';
const auth = { authorization: `Bearer ${SECRET}` };

/** Today in SAST, matching the handler's own derivation. */
const todaySast = () => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);

const req = (over: Record<string, unknown> = {}) =>
  ({ method: 'GET', query: {}, headers: auth, ...over }) as never;

describe('GET /api/cron/metrics-snapshot', () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.CRON_SECRET = original;
    vi.restoreAllMocks();
  });

  it('refuses to run when CRON_SECRET is unset, rather than accepting "Bearer undefined"', async () => {
    delete process.env.CRON_SECRET;
    const res = mockRes();
    await handler(req({ headers: { authorization: 'Bearer undefined' } }), res as never);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('rejects a wrong secret', async () => {
    const res = mockRes();
    await handler(req({ headers: { authorization: 'Bearer nope' } }), res as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects verbs it does not implement', async () => {
    const res = mockRes();
    await handler(req({ method: 'DELETE' }), res as never);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects a malformed date', async () => {
    const res = mockRes();
    await handler(req({ query: { date: '01-08-2026' } }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // The important one. The sources read CURRENT state, so accepting a past date
  // would record today's open entities as that day's history AND write a
  // completion row that permanently blocks the real capture.
  it('rejects a past date rather than fabricating history', async () => {
    const res = mockRes();
    await handler(req({ query: { date: '2026-07-15' } }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0]?.[0];
    expect(JSON.stringify(body)).toMatch(/fabricated history/i);
  });

  it('rejects a future date', async () => {
    const res = mockRes();
    await handler(req({ query: { date: '2099-01-01' } }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts today (same-day retry) and proceeds past validation to the DB', async () => {
    const res = mockRes();
    // The mocked pool throws, so reaching it proves validation passed — the
    // handler returns 500 from the connection guard, not 400 from validation.
    await handler(req({ query: { date: todaySast() } }), res as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.status).not.toHaveBeenCalledWith(400);
  });
});
