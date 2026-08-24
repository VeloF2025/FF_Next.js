/**
 * Stock-take simplification contract tests:
 *  - count.ts zero_remaining bulk path (only uncounted lines, in_progress only)
 *  - lines.ts single-item add path (routing, status gate, dedupe/location SQL)
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
  withAuth: (h: (req: NextApiRequest, res: NextApiResponse) => unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import countHandler from '../[id]/count';
import linesHandler from '../[id]/lines';

/** Flattened SQL text of a tagged-template call. */
function q(call: unknown[]): string {
  return (call[0] as string[]).join(' $? ').replace(/\s+/g, ' ');
}

const TAKE_ID = '11111111-1111-1111-1111-111111111111';
const ITEM_ID = '22222222-2222-2222-2222-222222222222';

async function post(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  body: Record<string, unknown>
) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    query: { id: TAKE_ID },
    body,
  });
  await handler(req, res);
  return res;
}

describe('POST /count zero_remaining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('zeroes only uncounted lines of this take and reports the count', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: TAKE_ID, status: 'in_progress' }]) // take lookup
      .mockResolvedValueOnce([{ id: 'l1' }, { id: 'l2' }]); // bulk update RETURNING

    const res = await post(countHandler, { zero_remaining: true });

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data.zeroed).toBe(2);

    const update = q(sqlMock.mock.calls[1]!);
    expect(update).toMatch(/UPDATE stock_take_lines/);
    expect(update).toMatch(/counted_quantity = 0/);
    expect(update).toMatch(/counted_quantity IS NULL/);
    expect(update).toMatch(/stock_take_id =/);
    expect(update).toMatch(/status = 'counted'/);
  });

  it('refuses when the take is not in progress', async () => {
    sqlMock.mockResolvedValueOnce([{ id: TAKE_ID, status: 'draft' }]);

    const res = await post(countHandler, { zero_remaining: true });

    expect(res._getStatusCode()).toBe(400);
    // Nothing was updated
    expect(sqlMock.mock.calls.length).toBe(1);
  });
});

describe('POST /lines with stock_item_id (add single line)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts one line scoped to the take location, deduped, and refreshes total_items', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: TAKE_ID, status: 'in_progress' }]) // take lookup
      .mockResolvedValueOnce([{ id: 'new-line' }]) // insert RETURNING
      .mockResolvedValueOnce([]); // total_items refresh

    const res = await post(linesHandler, { stock_item_id: ITEM_ID });

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data.line_id).toBe('new-line');

    const insert = q(sqlMock.mock.calls[1]!);
    expect(insert).toMatch(/INSERT INTO stock_take_lines/);
    expect(insert).toMatch(/location_id = st\.location_id/); // expected from the take's location
    expect(insert).toMatch(/NOT EXISTS/); // dedupe against existing lines
    expect(insert).toMatch(/si\.is_active = true/);
    expect(insert).toMatch(/st\.location_id IS NOT NULL/);

    const refresh = q(sqlMock.mock.calls[2]!);
    expect(refresh).toMatch(/UPDATE stock_takes/);
    expect(refresh).toMatch(/total_items/);
  });

  it('400s when the item is a duplicate or inactive (insert returns no row)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: TAKE_ID, status: 'in_progress' }])
      .mockResolvedValueOnce([]); // nothing inserted

    const res = await post(linesHandler, { stock_item_id: ITEM_ID });

    expect(res._getStatusCode()).toBe(400);
  });

  it('refuses on completed takes', async () => {
    sqlMock.mockResolvedValueOnce([{ id: TAKE_ID, status: 'pending_review' }]);

    const res = await post(linesHandler, { stock_item_id: ITEM_ID });

    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock.mock.calls.length).toBe(1);
  });

  it('still runs full initialization when no stock_item_id is given', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: TAKE_ID, status: 'draft' }])
      .mockResolvedValueOnce([{ items_added: 18 }]);

    const res = await post(linesHandler, {});

    expect(res._getStatusCode()).toBe(200);
    expect(q(sqlMock.mock.calls[1]!)).toMatch(/initialize_stock_take_lines/);
    expect(res._getJSONData().data.items_added).toBe(18);
  });
});
