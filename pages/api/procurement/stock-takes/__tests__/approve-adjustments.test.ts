/**
 * Stock-take approval tests for pages/api/procurement/stock-takes/[id]/actions.ts
 *
 * These pin the behaviours the approval rewrite introduced:
 *  - absolute write: stock_quants is SET to the counted quantity, not
 *    incremented by a stale variance;
 *  - the take flips to 'approved' LAST, attributed to the session user;
 *  - a location-less take is rejected before any transaction;
 *  - a concurrent approval (FOR UPDATE re-check fails) returns 409, not 500.
 *
 * The real handler runs; only the DB boundary is mocked. The db-pool
 * transaction is replaced with a fake that records every query and returns
 * canned rows by SQL text, so the assertions exercise the actual control flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const mocks = vi.hoisted(() => ({
  neonRows: [] as unknown[],
  neonTag: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({
  // The handler's top-level SELECT of the stock take uses the neon tag.
  neon: () => mocks.neonTag,
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ transaction: mocks.transaction }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  AuthenticatedRequest: class {},
}));

import handler from '../[id]/actions';

const USER = { id: 'user-approver', role: 'admin', email: 'a@x.co', name: 'Ann Approver' };

interface RecordedQuery { text: string; params: unknown[] }

function invoke(takeRow: Record<string, unknown>, txnBehaviour?: {
  lockedStatus?: string;
  recorded?: RecordedQuery[];
}) {
  mocks.neonTag.mockResolvedValueOnce([takeRow]);
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    query: { id: takeRow.id as string },
    body: { action: 'approve', approval_notes: 'ok' },
  });
  (req as unknown as { user: typeof USER }).user = USER;
  return (handler as unknown as (r: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res).then(() => res);
}

/** Build a fake txn whose responses are keyed off the SQL text. */
function makeTxn(recorded: RecordedQuery[], lockedStatus = 'pending_review') {
  const respond = (text: string): unknown[] => {
    if (text.includes('FOR UPDATE')) {
      return [{ status: lockedStatus, reference_number: 'ST-2026-0001', location_id: 'loc-1' }];
    }
    if (text.includes("code = 'ADJUST'")) return [{ id: 'adjust-loc' }];
    if (text.includes('variance_quantity != 0')) {
      return [{
        id: 'line-1',
        stock_item_id: 'item-1',
        location_id: 'loc-1',
        counted_quantity: '10',
        recount_quantity: null,
        expected_quantity: '4',
        standard_cost: '2',
      }];
    }
    if (text.includes('UPDATE stock_takes')) {
      return [{ id: 'take-1', status: 'approved', reference_number: 'ST-2026-0001' }];
    }
    return [];
  };
  return {
    async query(text: string, params: unknown[] = []) { recorded.push({ text, params }); return respond(text); },
    async queryOne(text: string, params: unknown[] = []) { recorded.push({ text, params }); return respond(text)[0] ?? null; },
  };
}

describe('stock-take approve', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the counted quantity absolutely and flips status last, attributed to the session user', async () => {
    const recorded: RecordedQuery[] = [];
    mocks.transaction.mockImplementation((cb: (t: unknown) => Promise<unknown>) => cb(makeTxn(recorded)));

    const res = await invoke({ id: 'take-1', status: 'pending_review', reference_number: 'ST-2026-0001', location_id: 'loc-1' });

    expect(res._getStatusCode()).toBe(200);

    // Absolute write: the stock_quants upsert receives the counted value (10),
    // NOT the variance (10 - 4 = 6).
    const quantWrite = recorded.find(q => q.text.includes('INSERT INTO stock_quants'));
    expect(quantWrite).toBeDefined();
    expect(quantWrite!.params).toEqual(['item-1', 'loc-1', 10]);

    // Adjustment audit + status flip attributed to the session user id.
    const finalUpdate = recorded.find(q => q.text.includes('UPDATE stock_takes'));
    expect(finalUpdate!.params).toContain('user-approver');
    // The status flip must be the LAST recorded write.
    expect(recorded[recorded.length - 1].text).toContain('UPDATE stock_takes');

    const body = JSON.parse(res._getData());
    expect(body.data.adjustments_applied).toBe(1);
  });

  it('rejects a location-less take before opening a transaction', async () => {
    const res = await invoke({ id: 'take-1', status: 'pending_review', reference_number: 'ST-X', location_id: null });
    expect(res._getStatusCode()).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns 409 when a concurrent approval already moved the take (FOR UPDATE re-check)', async () => {
    const recorded: RecordedQuery[] = [];
    mocks.transaction.mockImplementation((cb: (t: unknown) => Promise<unknown>) => cb(makeTxn(recorded, 'approved')));

    const res = await invoke({ id: 'take-1', status: 'pending_review', reference_number: 'ST-X', location_id: 'loc-1' });

    expect(res._getStatusCode()).toBe(409);
    // No stock write happened.
    expect(recorded.find(q => q.text.includes('INSERT INTO stock_quants'))).toBeUndefined();
  });
});
