/**
 * Tests for GET /accountability/exceptions (Tier 3.1, migration 410 view
 * v_holder_stock_exceptions).
 *
 * The route uses @/lib/db-pool `query` (parameterized) wrapped in withAuth
 * (stubbed). The DB layer is mocked, so these assert the handler's SQL shape
 * (view target), the parameterized filter construction (class / holder / project
 * / includeAll), and the default exclusion of recent_no_evidence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({ query: (...args: unknown[]) => queryMock(...args) }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h }));

import handler from '../../../../pages/api/procurement/field-stock/accountability/exceptions/index';

function makeRes() {
  const res = {} as NextApiResponse & { statusCode?: number; jsonData?: Record<string, unknown> };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; }) as NextApiResponse['status'];
  res.json = vi.fn((data) => { res.jsonData = data; return res; }) as NextApiResponse['json'];
  res.setHeader = vi.fn(() => res) as unknown as NextApiResponse['setHeader'];
  return res;
}
function makeReq(query: Record<string, unknown> = {}): NextApiRequest {
  return { method: 'GET', query, body: {} } as unknown as NextApiRequest;
}
/** The SQL text + params of the Nth query() call. */
function callOf(n: number) {
  const c = queryMock.mock.calls[n] as unknown[];
  return { sql: String(c[0]), params: (c[1] ?? []) as unknown[] };
}

describe('GET /accountability/exceptions', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('queries v_holder_stock_exceptions and returns rows', async () => {
    queryMock.mockResolvedValueOnce([
      { serial_id: 's-1', serial_number: 'ALCLB491AA22', holder_name: 'Louis Ellis',
        held_days: '45', exception_class: 'aged_no_evidence' },
    ]);
    const res = makeRes();
    await handler(makeReq(), res as unknown as NextApiResponse);

    const { sql } = callOf(0);
    expect(sql).toContain('v_holder_stock_exceptions');
    const data = res.jsonData?.data as Array<Record<string, unknown>>;
    expect(data[0]!.exception_class).toBe('aged_no_evidence');
  });

  it('excludes recent_no_evidence by default (exception classes only)', async () => {
    queryMock.mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq(), res as unknown as NextApiResponse);

    const { sql, params } = callOf(0);
    expect(sql).toContain('exception_class = ANY($1::text[])');
    expect(params[0]).toEqual(['cross_dr_conflict', 'installed_not_cleared', 'aged_no_evidence']);
  });

  it('includeAll=true drops the default class filter', async () => {
    queryMock.mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq({ includeAll: 'true' }), res as unknown as NextApiResponse);

    const { sql } = callOf(0);
    expect(sql).not.toContain('ANY($');
    expect(sql).not.toContain('exception_class =');
  });

  it('filters by a specific class as a bound parameter', async () => {
    queryMock.mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq({ class: 'cross_dr_conflict' }), res as unknown as NextApiResponse);

    const { sql, params } = callOf(0);
    expect(sql).toContain('exception_class = $1');
    expect(params).toContain('cross_dr_conflict');
  });

  it('ignores an unknown class value (falls back to default exception set)', async () => {
    queryMock.mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq({ class: 'bogus' }), res as unknown as NextApiResponse);

    const { sql, params } = callOf(0);
    expect(sql).toContain('exception_class = ANY($1::text[])');
    expect(params[0]).toEqual(['cross_dr_conflict', 'installed_not_cleared', 'aged_no_evidence']);
  });

  it('parameterizes holderId and projectId filters', async () => {
    queryMock.mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq({ holderId: 'h-1', projectId: 'p-9' }), res as unknown as NextApiResponse);

    const { sql, params } = callOf(0);
    expect(sql).toContain('holder_id = $2');
    expect(sql).toContain('project_id = $3');
    expect(params).toEqual([
      ['cross_dr_conflict', 'installed_not_cleared', 'aged_no_evidence'], 'h-1', 'p-9',
    ]);
  });

  it('maps projectId=unassigned to IS NULL (no bind param)', async () => {
    queryMock.mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq({ projectId: 'unassigned' }), res as unknown as NextApiResponse);

    const { sql, params } = callOf(0);
    expect(sql).toContain('project_id IS NULL');
    // only the default class array param is bound
    expect(params).toHaveLength(1);
  });

  it('405s on non-GET', async () => {
    const res = makeRes();
    const req = { method: 'POST', query: {}, body: {} } as unknown as NextApiRequest;
    await handler(req, res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(405);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
