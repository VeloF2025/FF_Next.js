/**
 * POST /api/my/stores/serials/validate-batch — the scanSource gate.
 *
 * scanSource decides whether a serial the stock sheet has never listed may be
 * taken into stock. It arrives from the client, so the endpoint must treat it
 * as untrusted: ONLY the literal 'machine' unlocks intake. Anything else — a
 * truthy object, a differently-cased string, a stray 'true' — has to fall back
 * to 'manual', which refuses.
 *
 * Without this file the normalisation is untested: replacing it with a plain
 * truthiness check passes the entire rest of the suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockQuery, mockRun } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockRun: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  sql: Object.assign((...a: unknown[]) => mockQuery(...a), { query: (...a: unknown[]) => mockQuery(...a) }),
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

function makeRes() {
  const res = {} as NextApiResponse & { statusCode?: number; jsonData?: Record<string, unknown> };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; }) as NextApiResponse['status'];
  res.json = vi.fn((d) => { res.jsonData = d; return res; }) as NextApiResponse['json'];
  res.setHeader = vi.fn(() => res) as unknown as NextApiResponse['setHeader'];
  return res;
}
const post = (body: Record<string, unknown>) =>
  ({ method: 'POST', query: {}, body }) as unknown as NextApiRequest;

/** scanSource actually handed to the validation core. */
const passedScanSource = () =>
  (mockRun.mock.calls.at(-1)?.[1] as { scanSource?: string } | undefined)?.scanSource;

beforeEach(() => {
  vi.clearAllMocks();
  mockRun.mockResolvedValue({ results: [] });
});

describe('scanSource is untrusted input', () => {
  it("passes 'machine' through for a genuine carton scan", async () => {
    await handler(post({ serials: ['ALCLB49486FF'], stockItemId: ITEM, scanSource: 'machine' }), makeRes());
    expect(passedScanSource()).toBe('machine');
  });

  it('falls back to manual when absent', async () => {
    await handler(post({ serials: ['ALCLB49486FF'], stockItemId: ITEM }), makeRes());
    expect(passedScanSource()).toBe('manual');
  });

  // Each of these is truthy. A plain `body.scanSource ? 'machine' : 'manual'`
  // would let every one of them mint stock the sheet has never listed.
  const truthyImposters: Array<[string, unknown]> = [
    ['an object', {}],
    ['an array', ['machine']],
    ['the string true', 'true'],
    ['a different case', 'MACHINE'],
    ['a near miss', 'machine '],
    ['a number', 1],
    ['boolean true', true],
    ['a manual claim', 'manual'],
  ];

  it.each(truthyImposters)('refuses to treat %s as a machine read', async (_label, value) => {
    await handler(
      post({ serials: ['ALCLB49486FF'], stockItemId: ITEM, scanSource: value }),
      makeRes(),
    );
    expect(passedScanSource()).toBe('manual');
  });
});
