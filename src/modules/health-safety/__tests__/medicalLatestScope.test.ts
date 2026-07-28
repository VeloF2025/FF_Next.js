/**
 * The "latest medical per worker" SQL contract — pinned as real assertions
 * against the actual query text, not through a mocked service.
 *
 * Two surfaces answer the same question and MUST agree:
 *   * medicalService.computeContractorMedicalSummary — filters to the
 *     contractor, then DISTINCT ON the worker;
 *   * GET /api/health-safety/medicals?latest_only=true — ranks with
 *     ROW_NUMBER() and filters on the resulting is_latest flag.
 *
 * They disagreed once already: the list ranked by worker alone while the
 * service ranked within the contractor, so for a worker holding certificates
 * under two contractors, `?contractor_id=X&latest_only=true` could return zero
 * rows while the gate reported one worker on file for X. Both now partition by
 * (contractor, worker).
 *
 * These tests execute the real handler/service against a captured SQL mock, so
 * the assertions are about the SQL that actually ships — a change to either
 * partition key fails here.
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

import listHandler from '../../../../pages/api/health-safety/medicals/index';
import { computeContractorMedicalSummary } from '../services/medicalService';

/** Flatten a tagged-template call back into comparable query text. */
function queryText(call: unknown[]): string {
  return (call[0] as string[]).join(' ? ').replace(/\s+/g, ' ');
}

const CONTRACTOR = '11111111-2222-3333-4444-555555555555';

describe('latest-medical scoping: list and gate rollup use the same partition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
  });

  it('the list ranks by (contractor_id, worker), not by worker alone', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { latest_only: 'true' },
    });
    await listHandler(req, res);

    const sqlText = queryText(sqlMock.mock.calls[0]!);
    expect(sqlText).toMatch(
      /PARTITION BY m\.contractor_id, COALESCE\(m\.staff_id, m\.team_member_id\)/
    );
    // The regression this guards: partitioning by worker alone.
    expect(sqlText).not.toMatch(/PARTITION BY COALESCE\(m\.staff_id, m\.team_member_id\)\s/);
    expect(sqlText).toMatch(/ORDER BY m\.exam_date DESC, m\.created_at DESC/);
  });

  it('the gate rollup filters to the contractor BEFORE collapsing to one row per worker', async () => {
    await computeContractorMedicalSummary(CONTRACTOR);

    const sqlText = queryText(sqlMock.mock.calls[0]!);
    const distinctAt = sqlText.indexOf('DISTINCT ON (COALESCE(m.staff_id, m.team_member_id))');
    const whereAt = sqlText.indexOf('WHERE m.contractor_id =');
    expect(distinctAt).toBeGreaterThan(-1);
    expect(whereAt).toBeGreaterThan(-1);
    // The contractor filter must be inside the same CTE that de-duplicates —
    // filtering after the collapse would let another contractor's newer
    // certificate hide this contractor's own current one.
    expect(whereAt).toBeGreaterThan(distinctAt);
    expect(sqlText).toMatch(/ORDER BY COALESCE\(m\.staff_id, m\.team_member_id\), m\.exam_date DESC/);
  });

  it('the contractor id is bound as a parameter, never interpolated into the SQL', async () => {
    await computeContractorMedicalSummary(CONTRACTOR);
    const call = sqlMock.mock.calls[0]!;
    expect(queryText(call)).not.toContain(CONTRACTOR);
    expect(call.slice(1)).toContain(CONTRACTOR);
  });

  it('an empty result set rolls up to all-zero counts, which must not block the gate', async () => {
    // Postgres returns one all-zero row for an aggregate over no rows, but the
    // service must also survive a genuinely empty result without throwing.
    sqlMock.mockResolvedValueOnce([]);
    const summary = await computeContractorMedicalSummary(CONTRACTOR);

    expect(summary).toEqual({
      contractor_id: CONTRACTOR,
      workers_with_medicals: 0,
      current: 0,
      expiring_soon: 0,
      expired: 0,
      unfit: 0,
      restricted: 0,
    });
  });

  it('counts come back as numbers even when the driver hands back numeric strings', async () => {
    // node-pg returns bigint/numeric as strings; ::int in the query avoids that,
    // but the Number() coercion is the belt-and-braces the gate comparisons rely
    // on (`unfit > 0` would be true for the string "0" without it).
    sqlMock.mockResolvedValueOnce([
      {
        workers_with_medicals: '3',
        current: '2',
        expiring_soon: '1',
        expired: '1',
        unfit: '0',
        restricted: '0',
      },
    ]);
    const summary = await computeContractorMedicalSummary(CONTRACTOR);

    expect(summary.workers_with_medicals).toBe(3);
    expect(summary.unfit).toBe(0);
    expect(summary.unfit > 0).toBe(false);
  });

  it('the list rejects a malformed uuid filter with 400 rather than letting the ::uuid cast 500', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { contractor_id: 'not-a-uuid' },
    });
    await listHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
