/**
 * Guard test for transitionReceiptStatusBulk's WHERE clause.
 *
 * pg-mem (used elsewhere in this repo for real-SQL integration tests, see
 * retireSupersededPpSerials.test.ts) does not support parameterized
 * `ANY($n::text[])` array binding — confirmed empirically: even a
 * trivially-matching row returns zero rows through pg-mem's pg adapter,
 * regardless of whether the array is passed as a JS array or a Postgres
 * array-literal string. That rules out a real-execution test for this
 * specific query shape.
 *
 * Instead this spies on the actual `sql` tagged-template call and asserts
 * on the REAL generated SQL text + the REAL bound parameter values (not a
 * stub's canned return) — mutation-test grade for the specific regression
 * this PR's safety claim depends on: deleting `AND status = ANY(...)`
 * from the UPDATE would remove that fragment from the captured text and
 * fail every test below.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const queryMock = vi.fn(async (_text: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }));
vi.mock('@/lib/db', () => ({
  default: { query: (text: string, params?: unknown[]) => queryMock(text, params) },
  pool: { query: (text: string, params?: unknown[]) => queryMock(text, params) },
}));

import { transitionReceiptStatusBulk } from '../queries-review-bulk';

const REVIEWER = '00000000-0000-0000-0000-000000000099';
const ID_1 = '00000000-0000-0000-0000-000000000001';
const ID_2 = '00000000-0000-0000-0000-000000000002';

describe('transitionReceiptStatusBulk — generated SQL guard', () => {
  beforeEach(() => {
    queryMock.mockClear();
  });

  it('sends an UPDATE scoped by BOTH the requested ids AND the eligible source statuses', async () => {
    await transitionReceiptStatusBulk({
      ids: [ID_1, ID_2],
      action: 'approve',
      reviewerId: REVIEWER,
      note: null,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [text, params] = queryMock.mock.calls[0] as [string, unknown[]];

    expect(text).toMatch(/UPDATE\s+staff_receipts/i);
    // Both filters must be present and AND-ed — losing either would let
    // the update reach rows outside the requested selection or rows in
    // an ineligible status.
    expect(text).toMatch(/id\s*=\s*ANY\(\$\d+::uuid\[\]\)/i);
    expect(text).toMatch(/status\s*=\s*ANY\(\$\d+::text\[\]\)/i);
    expect(text).toMatch(/AND\s+status\s*=\s*ANY/i);

    // approve's allowed-from set (ALLOWED_TRANSITIONS inverse) is exactly
    // ['submitted','rejected','reconciled'] — 'approved' itself must be
    // absent, since a status can't transition to itself.
    const idsParam = params.find(
      (p): p is string[] => Array.isArray(p) && (p as string[]).includes(ID_1)
    );
    expect(idsParam).toEqual([ID_1, ID_2]);

    const allowedFromParam = params.find(
      (p): p is string[] => Array.isArray(p) && (p as string[]).includes('submitted')
    );
    expect(allowedFromParam?.sort()).toEqual(['reconciled', 'rejected', 'submitted']);
    expect(allowedFromParam).not.toContain('approved');
  });

  it('deduplicates ids before they reach the query', async () => {
    await transitionReceiptStatusBulk({
      ids: [ID_1, ID_1, ID_1],
      action: 'reject',
      reviewerId: REVIEWER,
      note: 'duplicate submission',
    });

    const [, params] = queryMock.mock.calls[0] as [string, unknown[]];
    const idsParam = params.find(
      (p): p is string[] => Array.isArray(p) && (p as string[]).includes(ID_1)
    );
    expect(idsParam).toEqual([ID_1]);
  });

  it("reject's allowed-from set is submitted + approved only", async () => {
    await transitionReceiptStatusBulk({
      ids: [ID_1],
      action: 'reject',
      reviewerId: REVIEWER,
      note: 'reason',
    });

    const [, params] = queryMock.mock.calls[0] as [string, unknown[]];
    const allowedFromParam = params.find(
      (p): p is string[] => Array.isArray(p) && ((p as string[]).includes('submitted') || (p as string[]).includes('approved'))
    );
    expect(allowedFromParam?.sort()).toEqual(['approved', 'submitted']);
  });

  it("reconcile's allowed-from set is approved only", async () => {
    await transitionReceiptStatusBulk({
      ids: [ID_1],
      action: 'reconcile',
      reviewerId: REVIEWER,
      note: null,
    });

    const [, params] = queryMock.mock.calls[0] as [string, unknown[]];
    const allowedFromParam = params.find(
      (p): p is string[] => Array.isArray(p) && (p as string[]).includes('approved')
    );
    expect(allowedFromParam).toEqual(['approved']);
  });
});
