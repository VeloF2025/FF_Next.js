vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withRole: () => (h: unknown) => h,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import handler from '@/pages/api/activate/sitecam-appeals';

const mockQuery = vi.mocked(pool.query);

function run(query: Record<string, string>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET', query });
  return (handler as unknown as (rq: NextApiRequest, rs: NextApiResponse) => Promise<void>)(req, res).then(() => res);
}

describe('GET /api/activate/sitecam-appeals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
  });

  it('selects the advisory vlm_* columns', async () => {
    await run({ status: 'pending' });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('vlm_recommendation');
    expect(sql).toContain('vlm_confidence');
    expect(sql).toContain('vlm_reasoning');
    expect(sql).toContain('vlm_checks');
    expect(sql).toContain('vlm_serial_read');
    expect(sql).toContain('human_agreed_with_vlm');
  });

  it('rejects a bad status with 400', async () => {
    const res = await run({ status: 'bogus' });
    expect(res._getStatusCode()).toBe(400);
  });
});
