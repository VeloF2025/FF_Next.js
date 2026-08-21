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
const RECEIVER = '7f325850-b286-42c5-9d76-dfba5d692200';
/** Every call now needs a receiver — it is the batch key. */
const post = (body: Record<string, unknown>) =>
  ({ method: 'POST', query: {}, body: { receiverStaffId: RECEIVER, ...body } }) as unknown as NextApiRequest;
const data = (res: { jsonData?: Record<string, unknown> }) =>
  res.jsonData?.data as Record<string, unknown>;

/**
 * Answers for the two content reads, routed by WHAT the query is rather than by
 * call order. Position-based queues broke the moment a query was added ahead of
 * them — which has now happened twice — and a test that fails on ordering fails
 * for the wrong reason.
 */
let stockRows: unknown[] = [];
let duplicateRows: unknown[] = [];

/** Route each query to its answer by the table it reads. */
function installSql() {
  mockSql.mockImplementation(async (strings: unknown) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (/FROM staff/i.test(text)) return [{ id: RECEIVER, name: 'Tshepo Mahlangu' }];
    if (/FROM stock_serials/i.test(text)) return stockRows;
    if (/FROM eod_install_sheets/i.test(text)) return duplicateRows;
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateSheet.mockResolvedValue({ id: 'sheet-1' });
  stockRows = [];
  duplicateRows = [];
  installSql();
});

describe('classification', () => {
  it('flags a serial the system still believes is on the shelf', async () => {
    // ALCLB48F4F5A really is in_stock at Mamelodi Pop1 while the 2026-05-11
    // sheet records it handed out against DR1871183.
    stockRows = [
      { serial_number: 'ALCLB48F4F5A', status: 'in_stock' },
      { serial_number: 'ALCLB48E1234', status: 'activated' },
    ];
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
    stockRows = [{ serial_number: 'A1B2C3D4', status: 'in_stock' }];
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), makeRes());

    // Assert on what the statements DO, not how many there are — the count
    // changes whenever a read is added (it already has, for the duplicate
    // check) and a count assertion would fail for the wrong reason.
    const statements = mockSql.mock.calls.map((c) => String(c[0]));
    expect(statements.some((s) => /UPDATE|INSERT|DELETE/i.test(s))).toBe(false);
    expect(statements.some((s) => /stock_serials/i.test(s))).toBe(true); // the read
    expect(statements.filter((s) => /stock_serials/i.test(s))
      .every((s) => /^\s*SELECT/i.test(s.trim()))).toBe(true);
  });

  it('records the sheet as scanned, not as VLM-extracted', async () => {
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), makeRes());
    expect(mockCreateSheet).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'scanned', sheetDate: '2026-05-11' }),
    );
  });

  it('captures only the ONT column — the rest of the form is handwritten', async () => {
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
    await handler(post({
      sheetDate: '2026-05-11', serials: ['A1B2C3D4', 'A1B2C3D4', 'E5F6G7H8'],
    }), makeRes());
    const entries = (mockCreateSheet.mock.calls[0]![0] as { entries: unknown[] }).entries;
    expect(entries).toHaveLength(2);
  });

  it('upper-cases so a lowercase read still matches stock', async () => {
    stockRows = [{ serial_number: 'A1B2C3D4', status: 'activated' }];
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

describe('recording the same sheet twice', () => {
  it('returns the existing sheet instead of creating a second copy', async () => {
    // photo_hash's unique index is PARTIAL (WHERE photo_hash IS NOT NULL) and
    // this path has no photo, so the database will not stop a double-tap.
    // Every duplicate would double-count into the reconciliation stats.
    duplicateRows = [{ id: 'sheet-already' }];

    const res = makeRes();
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), res);

    expect(data(res).sheetId).toBe('sheet-already');
    expect(data(res).duplicateSheet).toBe(true);
    expect(mockCreateSheet).not.toHaveBeenCalled();
  });

  it('still reports what the sheet found, so the storeman gets an answer', async () => {
    stockRows = [{ serial_number: 'A1B2C3D4', status: 'in_stock' }];
    duplicateRows = [{ id: 'sheet-already' }];

    const res = makeRes();
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), res);

    // The contradiction still surfaces on a re-scan — that is the whole point.
    expect(data(res).contradictsStock).toBe(1);
  });

  it('creates the sheet when the serial set differs on the same date', async () => {
    // Two different pages can share a date; only an identical serial set is a
    // duplicate.
    // no matching sheet
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), makeRes());
    expect(mockCreateSheet).toHaveBeenCalled();
  });

  it('hashes the same sheet identically whatever order it was scanned in', async () => {
    // A page scanned bottom-to-top must collide with one scanned top-to-bottom.
    const hashFor = async (serials: string[]) => {
      mockCreateSheet.mockClear();
      await handler(post({ sheetDate: '2026-05-11', serials }), makeRes());
      return (mockCreateSheet.mock.calls[0]![0] as { contentHash: string }).contentHash;
    };
    expect(await hashFor(['E5F6G7H8', 'A1B2C3D4']))
      .toBe(await hashFor(['A1B2C3D4', 'E5F6G7H8']));
  });

  it('gives a DIFFERENT hash to a different date or a different serial set', async () => {
    const hashFor = async (sheetDate: string, serials: string[]) => {
      mockCreateSheet.mockClear();
      await handler(post({ sheetDate, serials }), makeRes());
      return (mockCreateSheet.mock.calls[0]![0] as { contentHash: string }).contentHash;
    };
    const base = await hashFor('2026-05-11', ['A1B2C3D4']);
    expect(await hashFor('2026-05-12', ['A1B2C3D4'])).not.toBe(base);
    expect(await hashFor('2026-05-11', ['A1B2C3D4', 'E5F6G7H8'])).not.toBe(base);
  });

  it('returns the winner when it LOSES the insert race', async () => {
    // The check-then-insert window: both submissions read "none", both insert,
    // one hits the unique index from migration 517. That violation is the
    // answer, not an error — this is the double-tap case.
    // Fast-path check finds none; the re-read after the clash finds the winner.
    let dupReads = 0;
    mockSql.mockImplementation(async (strings: unknown) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/FROM staff/i.test(text)) return [{ id: RECEIVER, name: 'Tshepo Mahlangu' }];
      if (/FROM eod_install_sheets/i.test(text)) {
        dupReads += 1;
        return dupReads === 1 ? [] : [{ id: 'sheet-winner' }];
      }
      return [];
    });
    mockCreateSheet.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));

    const res = makeRes();
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), res);

    expect(data(res).sheetId).toBe('sheet-winner');
    expect(data(res).duplicateSheet).toBe(true);
  });

  it('does NOT swallow an unrelated database error', async () => {
    // Only 23505 means "already recorded". Anything else must surface.
    mockCreateSheet.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '42P01' }));
    await expect(
      handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), makeRes()),
    ).rejects.toThrow('boom');
  });
});

describe('the receiver defines the batch', () => {
  it('refuses a batch with no receiver', async () => {
    // One batch = one receiver, one date. Without a receiver there is no batch.
    const res = makeRes();
    await handler(
      { method: 'POST', query: {}, body: { sheetDate: '2026-05-11', serials: ['A1B2C3D4'] } } as never,
      res,
    );
    expect(res.statusCode).toBe(422);
    expect(mockCreateSheet).not.toHaveBeenCalled();
  });

  it('refuses a receiver who does not exist', async () => {
    mockSql.mockImplementation(async (strings: unknown) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/FROM staff/i.test(text)) return []; // nobody
      return [];
    });
    const res = makeRes();
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), res);
    expect(res.statusCode).toBe(422);
    expect(mockCreateSheet).not.toHaveBeenCalled();
  });

  it('refuses a receiver whose staff row has no usable name', async () => {
    // `first || ' ' || last` yields NULL in Postgres if either side is NULL,
    // and an empty pair yields a lone space. Either would put a nameless
    // receiver on a report whose whole point is naming one. The query uses
    // concat_ws + nullif(trim(...)) so both arrive here as null.
    mockSql.mockImplementation(async (strings: unknown) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/FROM staff/i.test(text)) return [{ id: RECEIVER, name: null }];
      return [];
    });
    const res = makeRes();
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), res);
    expect(res.statusCode).toBe(422);
    expect(mockCreateSheet).not.toHaveBeenCalled();
  });

  it('asks Postgres for a trimmed, null-safe name', async () => {
    // Pins the query shape: plain `a || ' ' || b` reintroduces the null.
    await handler(post({ sheetDate: '2026-05-11', serials: ['A1B2C3D4'] }), makeRes());
    const staffQuery = mockSql.mock.calls
      .map((c) => (Array.isArray(c[0]) ? c[0].join(' ') : String(c[0])))
      .find((t) => /FROM staff/i.test(t))!;
    expect(staffQuery).toMatch(/concat_ws/i);
    expect(staffQuery).toMatch(/nullif\(trim\(/i);
  });

  it('takes the name from the staff row, never from the client', async () => {
    // Typed names give 'Tshepo', 'T. Mahlangu' and 'Tshepo Mahlangu' as three
    // receivers. The batch key has to be the id, and the name has to be ours.
    await handler(
      { method: 'POST', query: {}, body: {
        receiverStaffId: RECEIVER,
        sheetDate: '2026-05-11',
        serials: ['A1B2C3D4'],
        technicianName: 'T. MAHLANGU (typed)',
      } } as never,
      makeRes(),
    );
    expect(mockCreateSheet).toHaveBeenCalledWith(expect.objectContaining({
      technicianId: RECEIVER,
      technicianName: 'Tshepo Mahlangu',
    }));
  });

  it('gives two receivers DIFFERENT hashes for the same date and serials', async () => {
    // Without the receiver in the hash, the second batch would be silently
    // discarded as a duplicate of the first — losing a real handover.
    const OTHER = '62d20fe3-9b91-46c5-b4a0-54487c5a967d';
    const hashFor = async (receiverStaffId: string) => {
      mockCreateSheet.mockClear();
      mockSql.mockImplementation(async (strings: unknown) => {
        const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
        if (/FROM staff/i.test(text)) return [{ id: receiverStaffId, name: 'Someone' }];
        return [];
      });
      await handler(
        { method: 'POST', query: {}, body: {
          receiverStaffId, sheetDate: '2026-05-11', serials: ['A1B2C3D4'],
        } } as never,
        makeRes(),
      );
      return (mockCreateSheet.mock.calls[0]![0] as { contentHash: string }).contentHash;
    };
    expect(await hashFor(RECEIVER)).not.toBe(await hashFor(OTHER));
  });

  it('rejects a malformed receiver id without querying for it', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: {}, body: {
        receiverStaffId: "not-a-uuid' OR 1=1--", sheetDate: '2026-05-11', serials: ['A1B2C3D4'],
      } } as never,
      res,
    );
    expect(res.statusCode).toBe(422);
    expect(mockSql).not.toHaveBeenCalled();
  });
});

