/**
 * PATCH /api/health-safety/medicals/[medicalId] — lost-update guard.
 *
 * The handler reads the row, merges the patch over that snapshot, then writes
 * EVERY column back. Without an optimistic-concurrency check, two concurrent
 * PATCHes that each touch a different field would have the later write restore
 * its own stale snapshot over the earlier one — silently reverting it.
 *
 * The guard is `AND updated_at::text = <token read with the row>`; zero rows
 * affected means someone else wrote in between, which must surface as 409 and
 * NOT as a success with stale data.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/auth', () => ({
  withPermission: () => (h: unknown) => h,
  withAuth: (h: (req: NextApiRequest, res: NextApiResponse) => unknown) => h,
  getAuthUser: vi.fn(() => ({ id: 'user-1', email: 'a@velocityfibre.co.za' })),
}));

import detailHandler from '../../../../pages/api/health-safety/medicals/[medicalId]';

const EXISTING = {
  id: 'med-1',
  worker_name: 'Test Worker',
  contractor_id: null,
  project_id: null,
  exam_date: '2026-03-01',
  expiry_date: '2027-03-01',
  outcome: 'fit',
  restrictions: null,
  practitioner: 'Dr Example',
  practice_number: null,
  certificate_number: null,
  certificate_url: null,
  notes: null,
  updated_at_token: '2026-07-27 15:00:00.123456+00',
};

function queryText(call: unknown[]): string {
  return (call[0] as string[]).join(' ? ').replace(/\s+/g, ' ');
}

async function patch(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'PATCH',
    query: { medicalId: 'med-1' },
    body,
  });
  await detailHandler(req, res);
  return res;
}

describe('PATCH medicals — optimistic concurrency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('guards the UPDATE on the updated_at token read with the row', async () => {
    sqlMock
      .mockResolvedValueOnce([EXISTING]) // SELECT
      .mockResolvedValueOnce([{ ...EXISTING, outcome: 'unfit' }]) // UPDATE
      .mockResolvedValueOnce([]); // activity log

    const res = await patch({ outcome: 'unfit' });
    expect(res._getStatusCode()).toBe(200);

    const updateCall = sqlMock.mock.calls[1]!;
    expect(queryText(updateCall)).toMatch(/AND updated_at::text = \?/);
    // The token itself must be BOUND, and must be the one just read.
    expect(updateCall.slice(1)).toContain(EXISTING.updated_at_token);
  });

  it('reads the token as ::text so microsecond precision survives the round-trip', async () => {
    sqlMock.mockResolvedValueOnce([EXISTING]).mockResolvedValueOnce([EXISTING]).mockResolvedValueOnce([]);
    await patch({ notes: 'x' });

    // A JS Date would truncate 15:00:00.123456 to milliseconds and never match.
    expect(queryText(sqlMock.mock.calls[0]!)).toMatch(/updated_at::text AS updated_at_token/);
  });

  it('409s when the row changed underneath (UPDATE matched no rows)', async () => {
    sqlMock
      .mockResolvedValueOnce([EXISTING]) // SELECT
      .mockResolvedValueOnce([]); //        UPDATE matched nothing — someone else wrote

    const res = await patch({ outcome: 'unfit' });

    expect(res._getStatusCode()).toBe(409);
    // Must not have logged a success activity for a write that did not happen.
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('rejects clearing exam_date rather than silently keeping the old value', async () => {
    sqlMock.mockResolvedValueOnce([EXISTING]);
    const res = await patch({ exam_date: null });

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.message).toMatch(/exam_date cannot be cleared/);
    expect(sqlMock).toHaveBeenCalledTimes(1); // no UPDATE attempted
  });

  it('still enforces the restrictions invariant against the merged row', async () => {
    sqlMock.mockResolvedValueOnce([EXISTING]); // existing has restrictions = null
    const res = await patch({ outcome: 'fit_with_restriction' });

    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('404s on an unknown id without attempting an update', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const res = await patch({ notes: 'x' });

    expect(res._getStatusCode()).toBe(404);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});
