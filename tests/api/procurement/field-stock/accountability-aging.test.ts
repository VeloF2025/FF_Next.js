/**
 * Tests for the accountability holder endpoints' Tier 2 aging + project
 * breakdown (migration 409 companion views).
 *
 *   GET /accountability/holders            — LEFT JOINs v_holder_held_aging,
 *                                            surfaces bucket columns per holder.
 *   GET /accountability/holders/[holderId] — adds aging buckets + a per-project
 *                                            held-stock breakdown.
 *
 * Both routes use @/lib/db-pool and are wrapped in withAuth (stubbed to a
 * passthrough). The DB layer is mocked, so these assert the handler's SQL shape
 * (the new view join / breakdown query) and the response mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { listSql, detailQuery, detailQueryOne } = vi.hoisted(() => ({
  listSql: vi.fn(),
  detailQuery: vi.fn(),
  detailQueryOne: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => {
  const sql = (...args: unknown[]) => listSql(...args);
  sql.query = (...args: unknown[]) => listSql(...args);
  return { sql, query: detailQuery, queryOne: detailQueryOne };
});
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
}));

import listHandler from '../../../../pages/api/procurement/field-stock/accountability/holders/index';
import detailHandler from '../../../../pages/api/procurement/field-stock/accountability/holders/[holderId]/index';

function makeRes() {
  const res = {} as NextApiResponse & { statusCode?: number; jsonData?: Record<string, unknown> };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as NextApiResponse['status'];
  res.json = vi.fn((data) => {
    res.jsonData = data;
    return res;
  }) as NextApiResponse['json'];
  res.setHeader = vi.fn(() => res) as unknown as NextApiResponse['setHeader'];
  return res;
}

function makeReq(query: Record<string, unknown> = {}): NextApiRequest {
  return { method: 'GET', query, body: {} } as unknown as NextApiRequest;
}

describe('GET /accountability/holders — aging buckets', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('joins v_holder_held_aging and returns bucket columns', async () => {
    listSql.mockResolvedValueOnce([
      {
        holder_id: 'h-1', holder_type: 'staff', name: 'Louis Ellis',
        held_count: '1', held_value: '624.74',
        held_age_0_7: '1', held_age_8_30: '0', held_age_31_plus: '0',
        oldest_held_days: '0', oldest_held_at: null,
      },
    ]);

    const res = makeRes();
    await listHandler(makeReq(), res as unknown as NextApiResponse);

    const sqlText = String((listSql.mock.calls[0] as unknown[])[0]);
    expect(sqlText).toContain('v_holder_held_aging');
    expect(sqlText).toContain('held_age_31_plus');

    const data = res.jsonData?.data as Array<Record<string, unknown>>;
    expect(data[0]!.held_age_0_7).toBe('1');
  });

  it('qualifies the isBlocked filter against the joined alias', async () => {
    listSql.mockResolvedValueOnce([]);
    const res = makeRes();
    await listHandler(makeReq({ isBlocked: 'true' }), res as unknown as NextApiResponse);

    const sqlText = String((listSql.mock.calls[0] as unknown[])[0]);
    expect(sqlText).toContain('va.is_blocked = true');
  });

  it('qualifies the hasUnaccounted filter against the joined alias', async () => {
    listSql.mockResolvedValueOnce([]);
    const res = makeRes();
    await listHandler(makeReq({ hasUnaccounted: 'true' }), res as unknown as NextApiResponse);

    const sqlText = String((listSql.mock.calls[0] as unknown[])[0]);
    expect(sqlText).toContain('va.unaccounted_count > 0');
  });

  it('405s on non-GET', async () => {
    const res = makeRes();
    const req = { method: 'POST', query: {}, body: {} } as unknown as NextApiRequest;
    await listHandler(req, res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(405);
    expect(listSql).not.toHaveBeenCalled();
  });
});

describe('GET /accountability/holders/[holderId] — aging + project breakdown', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns the project breakdown alongside custody and serials', async () => {
    detailQueryOne.mockResolvedValueOnce({
      holder_id: 'h-1', name: 'Louis Ellis', held_count: '1',
      held_age_0_7: '1', held_age_8_30: '0', held_age_31_plus: '0', oldest_held_days: '0',
    });
    // custody, serials, projectBreakdown — in handler call order.
    detailQuery
      .mockResolvedValueOnce([]) // custody
      .mockResolvedValueOnce([{ id: 's-1', serial_number: 'SN1', stock_item_id: 'i-1', status: 'issued' }]) // serials
      .mockResolvedValueOnce([{ project_id: null, project_name: null, held_count: '1', held_value: '624.74' }]); // breakdown

    const res = makeRes();
    await detailHandler(
      makeReq({ holderId: 'h-1' }),
      res as unknown as NextApiResponse,
    );

    expect(res.jsonData?.data).toBeDefined();
    const data = res.jsonData!.data as { projectBreakdown: Array<Record<string, unknown>>; held_age_0_7: string };
    expect(data.projectBreakdown).toHaveLength(1);
    expect(data.held_age_0_7).toBe('1');

    // The breakdown query targets the companion view.
    const breakdownSql = String((detailQuery.mock.calls[2] as unknown[])[0]);
    expect(breakdownSql).toContain('v_holder_project_breakdown');
  });

  it('404s when the holder row is absent', async () => {
    detailQueryOne.mockResolvedValueOnce(null);
    const res = makeRes();
    await detailHandler(makeReq({ holderId: 'missing' }), res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(404);
    expect(detailQuery).not.toHaveBeenCalled();
  });

  it('422s when holderId is not a string (route array)', async () => {
    const res = makeRes();
    await detailHandler(
      makeReq({ holderId: ['a', 'b'] }),
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(422);
    expect(detailQueryOne).not.toHaveBeenCalled();
  });

  it('405s on non-GET', async () => {
    const res = makeRes();
    const req = { method: 'DELETE', query: { holderId: 'h-1' }, body: {} } as unknown as NextApiRequest;
    await detailHandler(req, res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(405);
    expect(detailQueryOne).not.toHaveBeenCalled();
  });
});
