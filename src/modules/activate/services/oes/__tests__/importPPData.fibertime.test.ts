/**
 * Guards the Fibertime sheet-DR status flip in importPPData. The pure helpers
 * (collectSheetDrTriples, normalizeSheetDropNumber) are tested elsewhere; the
 * load-bearing invariant lives in the UPDATE itself: it may only claim rows that
 * are still `not_found`, and it writes `located_fibertime` with the sheet DR.
 * Removing the `not_found` guard (which is what makes the flip idempotent and
 * stops it clobbering a serial-keyed resolution) must fail a test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture every query the import runs; answer the one call that needs a real
// shape (the batch insert returns an id) and give everything else an empty result.
const calls: Array<{ sql: string; params: unknown[] }> = [];
vi.mock('@/lib/db', () => ({
  default: {
    query: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/INSERT INTO oes_pp_import_batches/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'test-batch' }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
  },
}));
vi.mock('@/lib/featureFlags', () => ({ isOntLifecycleV2Enabled: () => false }));

import { importPPData } from '../oesImportService';

describe('importPPData — Fibertime sheet-DR status flip', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('flips only not_found rows to located_fibertime, keyed on serial+project, with the sheet DR', async () => {
    await importPPData(
      [{ project: 'MOA', serial_number: 'SER1', date_registered: null, latitude: null, longitude: null, drop_number: 'DR123' }],
      'fibertime-sheet.xlsx',
    );

    const flip = calls.find(c => /resolution_status = 'located_fibertime'/.test(c.sql));
    expect(flip, 'the Fibertime status-flip UPDATE should run when a sheet DR is present').toBeTruthy();

    // The guard that makes the flip idempotent and non-clobbering. Deleting it is
    // the mutation this test exists to catch.
    expect(flip!.sql).toMatch(/pp\.resolution_status = 'not_found'/);
    // Matched on serial AND project (both halves of the unique key), not serial alone.
    expect(flip!.sql).toMatch(/pp\.serial_number = s\.serial/);
    expect(flip!.sql).toMatch(/pp\.project = s\.project/);

    // Params carry the triple + filename in unnest order.
    expect(flip!.params[0]).toEqual(['SER1']);
    expect(flip!.params[1]).toEqual(['MOA']);
    expect(flip!.params[2]).toEqual(['DR123']);
    expect(flip!.params[3]).toBe('fibertime-sheet.xlsx');
  });

  it('runs no Fibertime flip when the sheet carries no drop numbers', async () => {
    await importPPData(
      [{ project: 'MOA', serial_number: 'SER1', date_registered: null, latitude: null, longitude: null, drop_number: null }],
      'fibertime-sheet.xlsx',
    );
    expect(calls.some(c => /resolution_status = 'located_fibertime'/.test(c.sql))).toBe(false);
  });
});
