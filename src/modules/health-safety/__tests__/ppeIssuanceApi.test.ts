/**
 * H&S PPE issuance endpoint — validation + the replacement-status SQL contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));
// The issuance GET now also asks how many issues lack a signed acknowledgement
// sheet (migration 489). That count goes through pg.Pool via @/lib/db-pool,
// which this file's neon-shim mock does not cover — unmocked, the pool has no
// connection and the handler dies on `undefined.rows`.
vi.mock('@/modules/health-safety/services/ppeAcknowledgementService', () => ({
  countUnevidencedIssuances: vi.fn(async () => 0),
}));
vi.mock('@/lib/auth', () => ({
  
  withPermission: () => (h: unknown) => h,
  withAuth: (h: (req: NextApiRequest, res: NextApiResponse) => unknown) => h,
  getAuthUser: vi.fn(() => ({ id: 'user-1', email: 'a@velocityfibre.co.za' })),
}));

import handler from '../../../../pages/api/health-safety/ppe/issuance';

function q(call: unknown[]): string {
  return (call[0] as string[]).join('$').replace(/\s+/g, ' ');
}

/** The bound interpolated values of a tagged-template call (everything after the strings array). */
function args(call: unknown[]): unknown[] {
  return call.slice(1);
}

describe('POST /api/health-safety/ppe/issuance — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
  });

  async function post(body: Record<string, unknown>) {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
    await handler(req, res);
    return res;
  }

  it('rejects an issue linked to both staff and a team member', async () => {
    const res = await post({
      ppe_item_id: 'item-1', issued_date: '2026-07-24', worker_name: 'X',
      staff_id: 's1', team_member_id: 't1',
    });
    expect(res._getStatusCode()).toBe(400);
  });

  it('requires ppe_item_id, issued_date and worker_name', async () => {
    const res = await post({ ppe_item_id: 'item-1' });
    expect(res._getStatusCode()).toBe(400);
  });
});

describe('GET /api/health-safety/ppe/issuance — replacement-status SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
  });

  async function get(query: Record<string, string> = {}) {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET', query });
    await handler(req, res);
    return res;
  }

  it("derives overdue/due_soon/ok in SQL from replacement_due", async () => {
    await get();
    const listQuery = sqlMock.mock.calls.map(q).find((t) => /replacement_status/.test(t));
    expect(listQuery).toBeDefined();
    expect(listQuery).toMatch(/WHEN i\.replacement_due < CURRENT_DATE THEN 'overdue'/);
    expect(listQuery).toMatch(/make_interval\(days =>/);
    expect(listQuery).toMatch(/signature_name IS NOT NULL\) AS acknowledged/);
  });

  it('binds the outstanding flag true only when status=outstanding is requested', async () => {
    // The filter text is unconditionally present (it is gated by a bound boolean
    // param, not a spliced fragment), so the flag's VALUE is what proves the
    // filter is active — assert on the bound argument, not the query text.
    await get({ status: 'outstanding' });
    const on = sqlMock.mock.calls.find((c) => /replacement_status/.test(q(c)));
    expect(args(on!)).toContain(true);

    sqlMock.mockClear();
    await get();
    const off = sqlMock.mock.calls.find((c) => /replacement_status/.test(q(c)));
    expect(args(off!)).toContain(false);
    expect(args(off!)).not.toContain(true);
  });
});
