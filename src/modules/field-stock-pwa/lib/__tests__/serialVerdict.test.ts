/**
 * Tests for verdictForSerial — the single source of truth for whether a scanned
 * serial may be issued. Shared by the single-serial scan path and the batch
 * endpoint so the two cannot drift apart.
 *
 * Rule order matters and is asserted: missing → status → wrong item → wrong
 * location. A serial that is both the wrong item AND at the wrong warehouse
 * reports the item, because that is the more fundamental mistake.
 */
import { describe, it, expect } from 'vitest';
import { verdictForSerial } from '../serialVerdict';
import type { SerialRecord, VerdictContext } from '../serialVerdict';

const CTX: VerdictContext = {
  expectedItemId: 'item-ont',
  expectedItemName: 'FT-ONT',
  sourceLocation: { id: 'loc-garst', name: 'Garstfontein DC' },
};

function record(over: Partial<SerialRecord> = {}): SerialRecord {
  return {
    serialNumber: 'ALCLB49486FF',
    stockItemId: 'item-ont',
    stockItemName: 'FT-ONT',
    status: 'in_stock',
    currentLocationId: 'loc-garst',
    currentLocationName: 'Garstfontein DC',
    ...over,
  };
}

describe('verdictForSerial', () => {
  it('accepts an in_stock serial of the right item at the source warehouse', () => {
    expect(verdictForSerial(record(), CTX)).toEqual({
      valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT',
    });
  });

  it('accepts status "available" as well as "in_stock"', () => {
    expect(verdictForSerial(record({ status: 'available' }), CTX).valid).toBe(true);
  });

  it('rejects a serial the system does not have', () => {
    expect(verdictForSerial(null, CTX)).toEqual({
      valid: false, errorMessage: 'Serial number not found',
    });
  });

  it('rejects a serial that is already issued, naming the status', () => {
    const verdict = verdictForSerial(record({ status: 'issued' }), CTX);
    expect(verdict.valid).toBe(false);
    expect(verdict.valid === false && verdict.errorMessage).toBe(
      'Serial is not available (status: issued)',
    );
  });

  it('rejects a serial belonging to another stock item, naming both', () => {
    const verdict = verdictForSerial(
      record({ stockItemId: 'item-gizzu', stockItemName: 'FT-GIZZU' }), CTX,
    );
    expect(verdict.valid === false && verdict.errorMessage).toBe(
      'Wrong stock item — scanned FT-GIZZU, expected FT-ONT',
    );
  });

  it('rejects a serial registered at another warehouse, naming both', () => {
    const verdict = verdictForSerial(
      record({ currentLocationId: 'loc-lawley', currentLocationName: 'Lawley' }), CTX,
    );
    expect(verdict.valid === false && verdict.errorMessage).toBe(
      'Serial is at Lawley, not Garstfontein DC',
    );
  });

  it('allows a serial with no recorded location — missing data is not a contradiction', () => {
    expect(verdictForSerial(
      record({ currentLocationId: null, currentLocationName: null }), CTX,
    ).valid).toBe(true);
  });

  it('skips the location check when no source warehouse is selected', () => {
    expect(verdictForSerial(
      record({ currentLocationId: 'loc-lawley', currentLocationName: 'Lawley' }),
      { ...CTX, sourceLocation: null },
    ).valid).toBe(true);
  });

  it('reports the wrong item first when the serial is both wrong item and wrong place', () => {
    const verdict = verdictForSerial(
      record({
        stockItemId: 'item-gizzu',
        stockItemName: 'FT-GIZZU',
        currentLocationId: 'loc-lawley',
        currentLocationName: 'Lawley',
      }),
      CTX,
    );
    expect(verdict.valid === false && verdict.errorMessage).toContain('Wrong stock item');
  });

  it('falls back to a generic warehouse phrase when the location has no name', () => {
    const verdict = verdictForSerial(
      record({ currentLocationId: 'loc-lawley', currentLocationName: null }), CTX,
    );
    expect(verdict.valid === false && verdict.errorMessage).toBe(
      'Serial is at another warehouse, not Garstfontein DC',
    );
  });
});
