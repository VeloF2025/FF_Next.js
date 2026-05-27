/**
 * Unit tests for filterWarehouseLocations.
 *
 * Verifies that the warehouse picker filter correctly excludes:
 *   - non-warehouse location_type rows (site_store, transit, technician, etc.)
 *   - inactive locations
 *   - the FIELD-DEFAULT synthetic transit destination row
 *   - the "Faulty Equipment Bin" (locationType='warehouse', binType='faulty')
 *   - rows with code='FAULTY' as a belt-and-braces heuristic
 */

import { describe, it, expect } from 'vitest';
import {
  filterWarehouseLocations,
  FIELD_DEFAULT_LOCATION_ID,
  type PwaStockLocation,
} from '../locationDefaults';

// ── Helpers ──────────────────────────────────────────────────────────────────

function loc(overrides: Partial<PwaStockLocation> = {}): PwaStockLocation {
  return {
    id: 'wh-uuid-1',
    name: 'Main Warehouse',
    code: 'MAIN-WH',
    locationType: 'warehouse',
    isActive: true,
    binType: 'main',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('filterWarehouseLocations', () => {
  it('passes a normal active warehouse row', () => {
    const result = filterWarehouseLocations([loc()]);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('MAIN-WH');
  });

  it('excludes rows where locationType !== warehouse', () => {
    const rows = [
      loc({ id: 'ss-1', code: 'SITE-1', locationType: 'site_store' }),
      loc({ id: 'tr-1', code: 'TRANS-1', locationType: 'transit' }),
      loc({ id: 'tc-1', code: 'TECH-1', locationType: 'technician' }),
      loc({ id: 'cu-1', code: 'CUST-1', locationType: 'customer' }),
      loc({ id: 'sc-1', code: 'SCRAP-1', locationType: 'scrap' }),
      loc({ id: 'adj-1', code: 'ADJ-1', locationType: 'adjustment' }),
    ];
    expect(filterWarehouseLocations(rows)).toHaveLength(0);
  });

  it('excludes inactive warehouse rows', () => {
    const result = filterWarehouseLocations([loc({ isActive: false })]);
    expect(result).toHaveLength(0);
  });

  it('excludes the FIELD-DEFAULT synthetic destination row', () => {
    const result = filterWarehouseLocations([
      loc({ id: FIELD_DEFAULT_LOCATION_ID, code: 'FIELD-DEFAULT', locationType: 'transit', binType: null }),
    ]);
    expect(result).toHaveLength(0);
  });

  it('excludes rows with binType=faulty (Faulty Equipment Bin — migration 182)', () => {
    // This is the exact row seeded by migration 182:
    //   locationType='warehouse', binType='faulty', code='FAULTY'
    // locationType alone is not sufficient to exclude it.
    const result = filterWarehouseLocations([
      loc({ id: 'faulty-uuid', code: 'FAULTY', name: 'Faulty Equipment Bin', binType: 'faulty' }),
    ]);
    expect(result).toHaveLength(0);
  });

  it('excludes rows with code=FAULTY even when binType is null (belt-and-braces heuristic)', () => {
    // Defence: if binType column is dropped or unpopulated, the code check still catches it.
    const result = filterWarehouseLocations([
      loc({ id: 'faulty-uuid', code: 'FAULTY', binType: null }),
    ]);
    expect(result).toHaveLength(0);
  });

  it('excludes rows with binType=faulty even when code is unexpected', () => {
    // binType check is primary; code check is secondary belt-and-braces.
    const result = filterWarehouseLocations([
      loc({ id: 'faulty2-uuid', code: 'FAULT-BIN-2', binType: 'faulty' }),
    ]);
    expect(result).toHaveLength(0);
  });

  it('admits warehouse rows with binType=null (pre-migration-182 rows)', () => {
    const result = filterWarehouseLocations([
      loc({ id: 'old-wh', code: 'OLD-WH', binType: null }),
    ]);
    expect(result).toHaveLength(1);
  });

  it('admits quarantine warehouse rows (different bin_type, still selectable)', () => {
    const result = filterWarehouseLocations([
      loc({ id: 'quar-wh', code: 'QUARANTINE', binType: 'quarantine' }),
    ]);
    expect(result).toHaveLength(1);
  });

  it('filters mixed list: keeps only valid warehouse rows', () => {
    const rows = [
      loc({ id: 'good-1', code: 'WH-A' }),                                                          // keep
      loc({ id: 'good-2', code: 'WH-B', binType: null }),                                            // keep
      loc({ id: 'bad-1', code: 'FAULTY', binType: 'faulty' }),                                       // exclude
      loc({ id: 'bad-2', code: 'SITE-STORE', locationType: 'site_store' }),                          // exclude
      loc({ id: 'bad-3', code: 'INACTIVE', isActive: false }),                                        // exclude
      loc({ id: FIELD_DEFAULT_LOCATION_ID, code: 'FIELD-DEFAULT', locationType: 'transit' }),         // exclude
    ];
    const result = filterWarehouseLocations(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.code)).toEqual(['WH-A', 'WH-B']);
  });
});
