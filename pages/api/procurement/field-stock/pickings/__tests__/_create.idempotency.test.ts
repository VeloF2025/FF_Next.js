/**
 * createPicking — server-side idempotency replay.
 * A create carrying an idempotencyKey that already exists must return the
 * existing picking WITHOUT inserting a new one (mirrors returns migration 359).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Text-aware neon mock: the idempotency lookup returns an existing row; any
// other query returns []. An INSERT reaching the mock would be a bug (the
// replay must short-circuit before it), so we record whether one is attempted.
const sqlCalls: string[] = [];
const EXISTING = { id: 'existing-picking', picking_number: 'PCK-000007', status: 'done' };

vi.mock('@neondatabase/serverless', () => ({
  neon: () => (strings: TemplateStringsArray, ..._vals: unknown[]) => {
    const text = strings.join('?');
    sqlCalls.push(text);
    if (/WHERE idempotency_key =/i.test(text)) return Promise.resolve([EXISTING]);
    return Promise.resolve([]);
  },
}));
vi.mock('../_validation', () => ({
  validateFieldDefaultDestination: vi.fn().mockResolvedValue({ ok: true }),
  validateSerialsAvailable: vi.fn().mockResolvedValue({ ok: true, resolvedSerialIds: new Map() }),
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { createPicking } from '../_create';

function mockRes() {
  const res: Partial<NextApiResponse> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => { res.statusCode = code; return res; }) as never;
  res.json = vi.fn().mockImplementation((body: unknown) => { res.body = body; return res; }) as never;
  return res as NextApiResponse & { statusCode?: number; body?: unknown };
}

describe('createPicking idempotency', () => {
  beforeEach(() => { sqlCalls.length = 0; vi.clearAllMocks(); });

  it('returns the existing picking and never INSERTs when the key already exists', async () => {
    const res = mockRes();
    await createPicking(
      { body: {
        pickingType: 'issue', sourceLocationId: 'src', destinationLocationId: 'dst',
        idempotencyKey: 'idem-123',
        lines: [{ stockItemId: 'i1', plannedQuantity: 5, serialIds: ['S1'] }],
      } } as NextApiRequest,
      res, 'staff1');

    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).toContain('existing-picking');
    // No INSERT was attempted — the replay short-circuited.
    expect(sqlCalls.some((s) => /INSERT INTO stock_pickings/i.test(s))).toBe(false);
    // The idempotency lookup did run.
    expect(sqlCalls.some((s) => /WHERE idempotency_key =/i.test(s))).toBe(true);
  });
});
