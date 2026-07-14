vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
// Avoid the real 1Map network call — resolve the cross-reference as pending.
vi.mock('@/modules/sitecam/lib/serialCrossRef', () => ({
  crossReferenceSerial: vi.fn(async () => ({ status: 'pending', expectedSerial: null })),
  crossRefStatusToColumn: (s: string) => (s === 'verified' ? 'pass' : s === 'mismatch' ? 'fail' : 'pending'),
}));
// Bypass /my auth: run the inner handler with an injected session.
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession: (h: unknown) => (req: unknown, res: unknown) =>
    (h as (r: unknown, s: unknown, sess: unknown) => unknown)(req, res, { staffId: 'staff-1' }),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import handler from '../verify-serial';

const mockQuery = vi.mocked(pool.query);

function run(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  return (handler as unknown as (rq: NextApiRequest, rs: NextApiResponse) => Promise<void>)(req, res).then(() => res);
}

/** The upsert SQL string the handler ran, if any. */
function upsertSql(): string | undefined {
  return mockQuery.mock.calls.map((c) => c[0] as string).find((s) => s.includes('dr_photo_unified_reviews'));
}

const ONT = 'ALCLB48CC3CA';
const UPS = 'GU18W12V2508057584';

describe('POST /api/my/sitecam/verify-serial — device routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation((async () => ({ rows: [], rowCount: 1 })) as never);
  });

  it('writes the UPS columns when device="ups" even at step 6 (6b)', async () => {
    const res = await run({ drNumber: 'DR2600734', step: 6, device: 'ups', scannedSerial: UPS, attemptNumber: 1 });
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data.result).toBe('saved');
    const sql = upsertSql();
    expect(sql).toContain('ups_serial_scanned');
    expect(sql).not.toContain('ont_serial_scanned');
    const params = mockQuery.mock.calls.find((c) => (c[0] as string).includes('dr_photo_unified_reviews'))?.[1];
    expect(params).toContain(UPS);
  });

  it('writes the ONT columns when device="ont" at step 6 (6a)', async () => {
    const res = await run({ drNumber: 'DR2600734', step: 6, device: 'ont', scannedSerial: ONT, attemptNumber: 1 });
    expect(res._getStatusCode()).toBe(200);
    expect(upsertSql()).toContain('ont_serial_scanned');
    expect(upsertSql()).not.toContain('ups_serial_scanned');
  });

  it('falls back to the legacy step inference when device is absent (6→ONT, 8→UPS)', async () => {
    const ontRes = await run({ drNumber: 'DR1', step: 6, scannedSerial: ONT, attemptNumber: 1 });
    expect(ontRes._getStatusCode()).toBe(200);
    expect(upsertSql()).toContain('ont_serial_scanned');

    vi.clearAllMocks();
    mockQuery.mockImplementation((async () => ({ rows: [], rowCount: 1 })) as never);
    const upsRes = await run({ drNumber: 'DR1', step: 8, scannedSerial: UPS, attemptNumber: 1 });
    expect(upsRes._getStatusCode()).toBe(200);
    expect(upsertSql()).toContain('ups_serial_scanned');
  });

  it('rejects with 400 when no device and the step is neither 6 nor 8', async () => {
    const res = await run({ drNumber: 'DR1', step: 7, scannedSerial: ONT, attemptNumber: 1 });
    expect(res._getStatusCode()).toBe(400);
  });
});
