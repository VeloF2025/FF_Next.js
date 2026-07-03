vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withRole: () => (h: unknown) => h,
}));
const client = { query: vi.fn(), release: vi.fn() };
vi.mock('@/lib/db', () => ({ default: { connect: vi.fn(() => Promise.resolve(client)) } }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../decision';

function run(id: string, body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', query: { id }, body });
  (req as unknown as { user: { id: string } }).user = { id: 'mgr-1' };
  return (handler as unknown as (rq: NextApiRequest, rs: NextApiResponse) => Promise<void>)(req, res).then(() => res);
}

describe('POST /api/activate/sitecam-appeals/[id]/decision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE sitecam_appeals')) return Promise.resolve({ rows: [{ dr_number: 'DR001', step_number: 6 }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  it('computes human_agreed_with_vlm in the UPDATE', async () => {
    const res = await run('a1', { decision: 'approved' });
    expect(res._getStatusCode()).toBe(200);
    const update = client.query.mock.calls.map((c: unknown[]) => c[0] as string).find((s) => s.includes('UPDATE sitecam_appeals'));
    expect(update).toContain('human_agreed_with_vlm');
    expect(update).toContain('vlm_recommendation');
    expect(update).toMatch(/uncertain/);
  });

  it('rejects an invalid decision with 400', async () => {
    const res = await run('a1', { decision: 'maybe' });
    expect(res._getStatusCode()).toBe(400);
  });
});
