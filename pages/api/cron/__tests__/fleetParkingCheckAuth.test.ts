import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const runParkingCheck = vi.fn();
vi.mock('@/modules/fleet/parking/runParkingCheck', () => ({
  runParkingCheck: (...a: unknown[]) => runParkingCheck(...a),
}));

import handler from '../fleet-parking-check';

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}

const REPORT = {
  checkDate: '2026-08-04',
  evaluated: 0,
  counts: { compliant: 0, violation: 0, unknown: 0, not_verifiable: 0, no_address: 0 },
  errors: 0,
  results: [],
};

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  runParkingCheck.mockReset();
  runParkingCheck.mockResolvedValue(REPORT);
  process.env.CRON_SECRET = 'test-secret';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('fleet-parking-check cron auth', () => {
  it('rejects a request with no secret header', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} } as unknown as NextApiRequest, res);
    expect(res.statusCode).toBe(401);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong secret', async () => {
    const res = mockRes();
    await handler(
      { method: 'GET', headers: { 'x-cron-secret': 'nope' } } as unknown as NextApiRequest,
      res
    );
    expect(res.statusCode).toBe(401);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });

  // Fail closed: an unset secret must never mean "allow everyone".
  it('refuses to run when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = mockRes();
    await handler(
      { method: 'GET', headers: { 'x-cron-secret': 'anything' } } as unknown as NextApiRequest,
      res
    );
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });

  it('rejects an unsupported method', async () => {
    const res = mockRes();
    await handler(
      { method: 'DELETE', headers: { 'x-cron-secret': 'test-secret' } } as unknown as NextApiRequest,
      res
    );
    expect(res.statusCode).toBe(405);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });

  it('runs the check when the secret matches', async () => {
    const res = mockRes();
    await handler(
      { method: 'GET', headers: { 'x-cron-secret': 'test-secret' } } as unknown as NextApiRequest,
      res
    );
    expect(runParkingCheck).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    // A wrong payload here is invisible to a status-code-only assertion, and
    // the cron wrapper logs this body as the run's record.
    expect(res.body).toMatchObject({ success: true, data: REPORT });
  });

  it('returns 500 when runParkingCheck throws', async () => {
    runParkingCheck.mockRejectedValue(new Error('Database connection failed'));
    const res = mockRes();
    await handler(
      { method: 'GET', headers: { 'x-cron-secret': 'test-secret' } } as unknown as NextApiRequest,
      res
    );
    expect(res.statusCode).toBe(500);
  });
});

/**
 * Backfill of a missed night. The important property is that a date the handler
 * refuses STOPS the request — a rejected date that fell through to `new Date()`
 * would overwrite a good row with tonight's evidence under yesterday's name.
 */
describe('fleet-parking-check date override', () => {
  async function call(query: Record<string, unknown>) {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { 'x-cron-secret': 'test-secret' },
        query,
      } as unknown as NextApiRequest,
      res
    );
    return res;
  }

  it('defaults to now when no date is supplied', async () => {
    const before = Date.now();
    await call({});
    const [checkAt] = runParkingCheck.mock.calls[0] as [Date];
    expect(checkAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(checkAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('runs a past date as of 20:00 SAST that day', async () => {
    const res = await call({ date: '2026-08-04' });
    expect(res.statusCode).toBe(200);
    const [checkAt] = runParkingCheck.mock.calls[0] as [Date];
    // 20:00 SAST (UTC+2) is 18:00 UTC.
    expect(checkAt.toISOString()).toBe('2026-08-04T18:00:00.000Z');
  });

  it.each([
    ['04-08-2026', 'wrong order'],
    ['2026-8-4', 'unpadded'],
    ['not-a-date', 'not a date at all'],
    ['2026-02-30', 'a day that does not exist'],
    ['', 'empty'],
  ])('rejects %s (%s) without running the check', async (date) => {
    const res = await call({ date });
    expect(res.statusCode).toBe(400);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });

  // Repeated query params arrive as an array; that must not be coerced.
  it('rejects a repeated date param', async () => {
    const res = await call({ date: ['2026-08-04', '2026-08-05'] });
    expect(res.statusCode).toBe(400);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });

  it('rejects a future date', async () => {
    const res = await call({ date: '2099-01-01' });
    expect(res.statusCode).toBe(400);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });
});
