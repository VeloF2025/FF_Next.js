vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/notifications/services/whatsappDelivery', () => ({ sendWhatsAppGroup: vi.fn() }));
// Bypass /my auth: run the inner handler with an injected session.
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession: (h: unknown) => (req: unknown, res: unknown) =>
    (h as (r: unknown, s: unknown, sess: unknown) => unknown)(req, res, { staffId: 'staff-1' }),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import handler from '../appeal';

const mockQuery = vi.mocked(pool.query);

function run(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  return (handler as unknown as (rq: NextApiRequest, rs: NextApiResponse) => Promise<void>)(req, res).then(() => res);
}

const baseBody = {
  drNumber: 'DR001', stepNumber: 6, appealText: 'green cable is visible',
  photoUrl: 'data:image/jpeg;base64,AAAA', attemptNumber: 3, jobType: 'activations',
};

describe('POST /api/my/sitecam/appeal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation((async (sql: string) => {
      if (sql.includes('FROM staff')) return { rows: [{ first_name: 'Ada', last_name: 'Lovelace' }], rowCount: 1 };
      if (sql.includes('INSERT INTO sitecam_appeals')) return { rows: [{ id: 'appeal-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as never);
  });

  it('persists job_type in the INSERT', async () => {
    const res = await run(baseBody);
    expect(res._getStatusCode()).toBe(200);
    const insert = mockQuery.mock.calls.map((c) => c[0] as string).find((s) => s.includes('INSERT INTO sitecam_appeals'));
    expect(insert).toContain('job_type');
    const insertCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO sitecam_appeals'));
    expect(insertCall?.[1]).toContain('activations');
  });

  it('persists a civils job_type', async () => {
    const res = await run({ ...baseBody, jobType: 'civils' });
    expect(res._getStatusCode()).toBe(200);
    const insertCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO sitecam_appeals'));
    expect(insertCall?.[1]).toContain('civils');
  });

  it('rejects an explicit invalid job_type with 400', async () => {
    const res = await run({ ...baseBody, jobType: 'plumbing' });
    expect(res._getStatusCode()).toBe(400);
  });

  it('tolerates a missing job_type (stale PWA) — stores NULL rather than rejecting', async () => {
    const { jobType: _omit, ...noJobType } = baseBody;
    const res = await run(noJobType);
    expect(res._getStatusCode()).toBe(200);
    const insertCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO sitecam_appeals'));
    expect(insertCall?.[1]?.[8]).toBeNull();
  });
});
