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

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  runParkingCheck.mockReset();
  runParkingCheck.mockResolvedValue({
    checkDate: '2026-08-04', evaluated: 0,
    counts: { compliant: 0, violation: 0, unknown: 0, not_verifiable: 0, no_address: 0 },
    errors: 0,
  });
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
