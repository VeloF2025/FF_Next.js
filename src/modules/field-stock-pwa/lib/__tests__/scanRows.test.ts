/**
 * buildScanRows — carton members collapse to one row; loose serials stay individual.
 */
import { describe, it, expect } from 'vitest';
import { buildScanRows } from '../scanRows';
import type { PwaScannedSerial } from '../../types';

function s(over: Partial<PwaScannedSerial> & { serialNumber: string }): PwaScannedSerial {
  return {
    stockItemId: 'i', stockItemName: 'FT-ONT', scannedAt: 1, state: 'valid', ...over,
  };
}

describe('buildScanRows', () => {
  it('collapses a carton to a single group row carrying every member', () => {
    const rows = buildScanRows([
      s({ serialNumber: 'A1', groupId: 'g1', groupLabel: 'Box · 3 serials' }),
      s({ serialNumber: 'A2', groupId: 'g1', groupLabel: 'Box · 3 serials' }),
      s({ serialNumber: 'A3', groupId: 'g1', groupLabel: 'Box · 3 serials' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'group', groupId: 'g1', label: 'Box · 3 serials' });
    expect(rows[0]!.type === 'group' && rows[0]!.members.map((m) => m.serialNumber))
      .toEqual(['A1', 'A2', 'A3']);
  });

  it('renders newest-first so the last scan is at the top', () => {
    const rows = buildScanRows([
      s({ serialNumber: 'BOX1', groupId: 'g1', groupLabel: 'Box · 1 serials' }),
      s({ serialNumber: 'LOOSE1' }),
      s({ serialNumber: 'LOOSE2' }),
    ]);
    expect(rows.map((r) => (r.type === 'group' ? r.groupId : r.serial.serialNumber)))
      .toEqual(['LOOSE2', 'LOOSE1', 'g1']);
  });

  it('keeps two separate cartons as two separate rows', () => {
    const rows = buildScanRows([
      s({ serialNumber: 'A1', groupId: 'g1', groupLabel: 'Box · 1 serials' }),
      s({ serialNumber: 'B1', groupId: 'g2', groupLabel: 'Box · 1 serials' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type === 'group' && r.groupId)).toEqual(['g2', 'g1']);
  });

  it('falls back to a plain Box label when the group label is missing', () => {
    const rows = buildScanRows([s({ serialNumber: 'A1', groupId: 'g1' })]);
    expect(rows[0]!.type === 'group' && rows[0]!.label).toBe('Box');
  });

  it('returns an empty list for an empty scan', () => {
    expect(buildScanRows([])).toEqual([]);
  });
});
