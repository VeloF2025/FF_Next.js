/**
 * POST /api/my/stores/serials/validate-batch — the scanPayload boundary.
 *
 * scanPayload arrives from the network, so the handler must hand the core a
 * string or nothing. Coverage at the HTTP layer specifically: the pure
 * eligibility tests prove the parser fails closed, but only this file proves
 * the handler does not pass a non-string through to it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockQuery, mockRun } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockRun: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  sql: Object.assign((...a: unknown[]) => mockQuery(...a), {
    query: (...a: unknown[]) => mockQuery(...a),
  }),
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (h: (req: NextApiRequest, res: NextApiResponse, s: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) => h(req, res, { staffId: 'stores-1' }),
}));
vi.mock('@/modules/field-stock-pwa/lib/storesActor', () => ({
  requireStoresActor: vi.fn(async () => ({
    staffId: 'stores-1', staffRole: 'stores', authRole: null, name: 'Store Man',
  })),
}));
vi.mock('@/pages/api/my/stores/serials/_validateBatchCore', () => ({
  runBatchValidation: (...a: unknown[]) => mockRun(...a),
}));

import handler from '../../../pages/api/my/stores/serials/validate-batch';

const ITEM = '84cc2348-f8a9-486f-826a-6b8b20579765';
const CARTON = 'ALCLB49486FF;ALCLB4948758;ALCLB4948779';

function makeRes() {
  const res = {} as NextApiResponse & { statusCode?: number; jsonData?: Record<string, unknown> };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; }) as NextApiResponse['status'];
  res.json = vi.fn((d) => { res.jsonData = d; return res; }) as NextApiResponse['json'];
  res.setHeader = vi.fn(() => res) as unknown as NextApiResponse['setHeader'];
  return res;
}
const post = (body: Record<string, unknown>) =>
  ({ method: 'POST', query: {}, body }) as unknown as NextApiRequest;

const passedPayload = () =>
  (mockRun.mock.calls.at(-1)?.[1] as { scanPayload?: unknown } | undefined)?.scanPayload;

beforeEach(() => {
  vi.clearAllMocks();
  mockRun.mockResolvedValue({ results: [] });
});

describe('scanPayload is untrusted input', () => {
  it('forwards a real carton payload unchanged', () => {
    return handler(post({ serials: ['ALCLB49486FF'], stockItemId: ITEM, scanPayload: CARTON }), makeRes())
      .then(() => { expect(passedPayload()).toBe(CARTON); });
  });

  it('forwards null when absent', async () => {
    await handler(post({ serials: ['ALCLB49486FF'], stockItemId: ITEM }), makeRes());
    expect(passedPayload()).toBeNull();
  });

  // Every one of these is truthy. None is a string, and none may reach the
  // parser — a non-string would throw or be coerced into something surprising.
  const nonStrings: Array<[string, unknown]> = [
    ['an object', {}],
    ['an array of serials', ['ALCLB49486FF', 'ALCLB4948758']],
    ['a number', 12345],
    ['boolean true', true],
    ['a nested payload', { toString: 'ALCLB49486FF;ALCLB4948758' }],
  ];

  it.each(nonStrings)('sends null rather than %s', async (_label, value) => {
    await handler(
      post({ serials: ['ALCLB49486FF'], stockItemId: ITEM, scanPayload: value }),
      makeRes(),
    );
    expect(passedPayload()).toBeNull();
  });

  it('never sends a scanSource flag — there is nothing to take on trust', async () => {
    await handler(
      post({ serials: ['ALCLB49486FF'], stockItemId: ITEM, scanSource: 'machine' }),
      makeRes(),
    );
    const arg = mockRun.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(arg.scanSource).toBeUndefined();
    // And a caller sending the old flag gains nothing: no payload, no intake.
    expect(arg.scanPayload).toBeNull();
  });
});
