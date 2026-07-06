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

  function updateSql(): string {
    const sql = client.query.mock.calls.map((c: unknown[]) => c[0] as string).find((s) => s.includes('UPDATE sitecam_appeals'));
    // Collapse whitespace so the assertions pin the CASE logic, not the formatting.
    return (sql ?? '').replace(/\s+/g, ' ');
  }

  it('pins the exact agreement CASE mapping so a transposed comparator fails', async () => {
    const res = await run('a1', { decision: 'approved' });
    expect(res._getStatusCode()).toBe(200);
    const sql = updateSql();
    expect(sql).toContain('human_agreed_with_vlm = CASE');
    // No comparable recommendation → NULL (never a false "disagreed").
    expect(sql).toContain("WHEN vlm_recommendation IS NULL OR vlm_recommendation = 'uncertain' THEN NULL");
    // Agreement is true ONLY when the human decision matches the definite recommendation.
    expect(sql).toContain("WHEN vlm_recommendation = 'approve' AND $1 = 'approved' THEN true");
    expect(sql).toContain("WHEN vlm_recommendation = 'deny' AND $1 = 'denied' THEN true");
    // Every other (mismatch) combination → false.
    expect(sql).toContain('ELSE false');
  });

  it('records a denied decision and binds params in the expected order', async () => {
    const res = await run('a1', { decision: 'denied', denialReason: 'blurry photo' });
    expect(res._getStatusCode()).toBe(200);
    const call = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE sitecam_appeals'));
    // [decision, decidedBy, denialReason, id]
    expect(call?.[1]).toEqual(['denied', 'mgr-1', 'blurry photo', 'a1']);
  });

  it('returns 404 when the appeal id does not exist', async () => {
    client.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('UPDATE sitecam_appeals') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 0 }),
    );
    const res = await run('missing', { decision: 'approved' });
    expect(res._getStatusCode()).toBe(404);
  });

  it('rejects an invalid decision with 400', async () => {
    const res = await run('a1', { decision: 'maybe' });
    expect(res._getStatusCode()).toBe(400);
  });
});
