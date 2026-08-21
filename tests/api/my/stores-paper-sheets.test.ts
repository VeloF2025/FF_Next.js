/**
 * POST /api/my/stores/paper-sheets — recording a historical paper sheet.
 *
 * The endpoint captures what an old sheet says and classifies each serial
 * against stock. It must NOT move stock: the ONT left the shelf months ago,
 * and 72% of the serials on the May 2026 sheets were already recorded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockSql, mockCreateSheet } = vi.hoisted(() => ({
  mockSql: vi.fn(), mockCreateSheet: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => {
  const sql = (...a: unknown[]) => mockSql(...a);
  sql.query = (...a: unknown[]) => mockSql(...a);
  return { sql };
});
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
vi.mock('@/modules/data-sync/services/eodSheetService', () => ({
  createSheet: (...a: unknown[]) => mockCreateSheet(...a),
}));

import handler from '../../../pages/api/my/stores/paper-sheets';

function makeRes() {
  const res = {} as NextApiResponse & { statusCode?: number; jsonData?: Record<string, unknown> };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; }) as NextApiResponse['status'];
  res.json = vi.fn((d) => { res.jsonData = d; return res; }) as NextApiResponse['json'];
  res.setHeader = vi.fn(() => res) as unknown as NextApiResponse['setHeader'];
  return res;
}
const post = (body: Record<string, unknown>) =>
  ({ method: 'POST', query: {}, body }) as unknown as NextApiRequest;
const data = (res: { jsonData?: Record<string, unknown> }) =>
  res.jsonData?.data as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateSheet.mockResolvedValue({ id: 'sheet-1' });
});

describe('classification', () => {
  it('flags a serial the system still believes is on the shelf', async () => {
    // ALCLB48F4F5A really is in_stock at Mamelodi Pop1 while the 2026-05-11
    // sheet records it handed out against DR1871183.
    mockSql.mockResolvedValueOnce([
      { serial_number: 'ALCLB48F4F5A', status: 'in_stock' },
      { serial_number: 'ALCLB48E1234', status: 'activated' },
    ]);
    const res = makeRes();
    await handler(post({
      sheetDate: '2026-05-11',
      serials: ['ALCLB48F4F5A', 'ALCLB48E1234', 'ALCLB49486FF'],
    }), res);

    const d = data(res);
    expect(d.contradictsStock).toBe(1);
    expect(d.alreadyRecorded).toBe(1);
    expect(d.unknownSerial).toBe(1); // no row at all
  });

  it('does NOT write to stock_serials', async () => {
    mockSql.mockResolvedValueOnce([{ serial_number: 'A1B2C3D4', status: 'in_stock' }]);
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), makeRes());

    // Exactly one query — the read that classifies. Back-dating stock movement
    // is irreversible and is deliberately not done here.
    expect(mockSql).toHaveBeenCalledTimes(1);
    const statements = mockSql.mock.calls.map((c) => String(c[0]));
    expect(statements.some((s) => /UPDATE|INSERT|DELETE/i.test(s))).toBe(false);
  });

  it('records the sheet as scanned, not as VLM-extracted', async () => {
    mockSql.mockResolvedValueOnce([]);
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), makeRes());
    expect(mockCreateSheet).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'scanned', sheetDate: '2026-05-11' }),
    );
  });

  it('captures only the ONT column — the rest of the form is handwritten', async () => {
    mockSql.mockResolvedValueOnce([]);
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), makeRes());
    const entry = (mockCreateSheet.mock.calls[0]![0] as {
      entries: Array<Record<string, unknown>>;
    }).entries[0]!;
    expect(entry.ontSerial).toBe('A1B2C3D4');
    expect(entry.gizzuSerial).toBeNull();
    expect(entry.drNumber).toBeNull();
  });
});

describe('the sheet date', () => {
  it('is required — a past document must carry its own date', async () => {
    const res = makeRes();
    await handler(post({ serials: ['A1B2C3D4'] }), res);
    expect(res.statusCode).toBe(422);
    expect(mockCreateSheet).not.toHaveBeenCalled();
  });

  it('rejects a malformed date', async () => {
    const res = makeRes();
    await handler(post({ sheetDate: '11/05/2026', serials: ['A1B2C3D4'] }), res);
    expect(res.statusCode).toBe(422);
  });

  it('rejects a future date', async () => {
    const res = makeRes();
    await handler(post({ sheetDate: '2099-01-01', serials: ['A1B2C3D4'] }), res);
    expect(res.statusCode).toBe(422);
    expect(mockCreateSheet).not.toHaveBeenCalled();
  });
});

describe('input handling', () => {
  it('deduplicates a serial scanned twice off the same page', async () => {
    mockSql.mockResolvedValueOnce([]);
    await handler(post({
      sheetDate: '2026-05-11', serials: ['A1B2C3D4', 'A1B2C3D4', 'E5F6G7H8'],
    }), makeRes());
    const entries = (mockCreateSheet.mock.calls[0]![0] as { entries: unknown[] }).entries;
    expect(entries).toHaveLength(2);
  });

  it('upper-cases so a lowercase read still matches stock', async () => {
    mockSql.mockResolvedValueOnce([{ serial_number: 'A1B2C3D4', status: 'activated' }]);
    const res = makeRes();
    await handler(post({ sheetDate: '2026-05-11', serials: ['a1b2c3d4'] }), res);
    expect(data(res).alreadyRecorded).toBe(1);
  });

  it('rejects an empty scan and a malformed serial', async () => {
    const r1 = makeRes();
    await handler(post({ sheetDate: '2026-05-11', serials: [] }), r1);
    expect(r1.statusCode).toBe(422);

    const r2 = makeRes();
    await handler(post({ sheetDate: '2026-05-11', serials: ['no'] }), r2);
    expect(r2.statusCode).toBe(422);
  });
});
