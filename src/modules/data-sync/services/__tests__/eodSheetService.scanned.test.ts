/**
 * createSheet on the SCANNED path must not reach stock-adjacent tables.
 *
 * The endpoint test mocks the whole eodSheetService away, so it proves the
 * HANDLER issues one query — not that the service it calls stays clean. Today
 * it does, but only because every scanned entry carries drNumber: null, which
 * makes writeBackDrSerials's candidate filter empty. That is an incidental
 * property of a field value, and threading a DR number through later (for the
 * handwritten columns, say) would silently reintroduce a write with nothing to
 * catch it.
 *
 * So this drives the REAL createSheet against a fake sql and asserts on the
 * statements it actually issues.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock('@/lib/db-pool', () => {
  const sql = (...a: unknown[]) => mockSql(...a);
  sql.query = (...a: unknown[]) => mockSql(...a);
  return { sql };
});
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// The REAL import path. An earlier version mocked '@/services/serialHistoryService',
// which does not exist — so nothing was mocked, and the write-back test made a
// live fetch to the placeholder DATABASE_URL on every CI run. It passed only
// because the Neon HTTP driver rejects that host fast and eodSheetService
// swallows the error; a slower DNS or egress policy would turn it into a hang.
const { mockLogSerialChange } = vi.hoisted(() => ({
  mockLogSerialChange: vi.fn(async () => ({ historyId: 'hist-1' })),
}));
vi.mock('@/modules/activate/services/activity-log/serialHistory', () => ({
  logSerialChange: (...a: unknown[]) => mockLogSerialChange(...a),
}));

import { createSheet } from '../eodSheetService';

/** Every SQL statement the call issued, joined for whole-run assertions. */
const statements = () => mockSql.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '));

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue([{ id: 'sheet-1' }]);
});

const scannedInput = (over: Record<string, unknown> = {}) => ({
  sheetDate: '2026-05-11',
  source: 'scanned' as const,
  velocityRepName: null,
  velocityRepId: null,
  technicianName: 'Tshepo Mahlangu',
  technicianId: null,
  photoUrl: null,
  photoHash: null,
  vlmRawJson: null,
  uploadedBy: 'stores-1',
  entries: [
    {
      rowNumber: 1,
      ontSerial: 'ALCLB48F4F5A',
      gizzuSerial: null,
      drNumber: null,
      gizzuDrNumber: null,
      ponNumber: null,
      address: null,
    },
  ],
  ...over,
});

describe('createSheet on the scanned path', () => {
  it('never touches stock_serials', async () => {
    await createSheet(scannedInput());
    expect(statements().some((s) => /stock_serials/i.test(s))).toBe(false);
  });

  it('never writes to dr_photo_unified_reviews', async () => {
    // writeBackDrSerials updates that table when an entry has BOTH a DR number
    // and an ONT serial. Scanned entries have no DR number, so it must not run.
    await createSheet(scannedInput());
    expect(statements().some((s) => /dr_photo_unified_reviews/i.test(s))).toBe(false);
  });

  it('issues no UPDATE or DELETE at all — only the sheet and entry inserts', async () => {
    await createSheet(scannedInput());
    const writes = statements().filter((s) => /^\s*(UPDATE|DELETE)/i.test(s));
    expect(writes).toEqual([]);
  });

  it('records the sheet as scanned', async () => {
    await createSheet(scannedInput());
    const params = mockSql.mock.calls[0]!.slice(1);
    expect(params).toContain('scanned');
  });

  it('defaults to vlm when no source is given, preserving the old path', async () => {
    const { source: _drop, ...withoutSource } = scannedInput();
    await createSheet(withoutSource as Parameters<typeof createSheet>[0]);
    expect(mockSql.mock.calls[0]!.slice(1)).toContain('vlm');
  });

  it('DOES reach the write-back when an entry carries a DR number', async () => {
    // The guard is the null drNumber, not the scanned source. Proving the
    // write-back is reachable at all is what makes the tests above meaningful
    // — otherwise they would pass against a writeBackDrSerials that was simply
    // broken or never called.
    mockSql.mockResolvedValue([{ id: 'sheet-1', ont_serial_scanned: 'OLD' }]);
    await createSheet(scannedInput({
      entries: [{
        rowNumber: 1, ontSerial: 'ALCLB48F4F5A', gizzuSerial: null,
        drNumber: 'DR1871183', gizzuDrNumber: null, ponNumber: null, address: null,
      }],
    }));
    expect(statements().some((s) => /dr_photo_unified_reviews/i.test(s))).toBe(true);
    // Proves the mock is wired to the path the service actually imports. With
    // the wrong module path the real logSerialChange runs instead — it opens a
    // live connection, the service swallows the failure, and this assertion is
    // the only thing that notices.
    expect(mockLogSerialChange).toHaveBeenCalled();
  });
});
