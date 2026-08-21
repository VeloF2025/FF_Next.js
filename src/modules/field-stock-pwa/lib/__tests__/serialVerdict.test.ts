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

  it('ALLOWS a serial recorded at another warehouse, and flags it', () => {
    // The recorded location is an assumption from a workbook tab that predicts
    // the real site 27.5% of the time. Stock genuinely moves between sites;
    // refusing the handout blocks real work over a guess (PCK-000009/10).
    const verdict = verdictForSerial(
      record({ currentLocationId: 'loc-lawley', currentLocationName: 'Lawley' }), CTX,
    );
    expect(verdict.valid).toBe(true);
    expect(verdict.valid === true && verdict.warning).toBe(
      'Expected at Lawley — issuing from Garstfontein DC',
    );
    expect(verdict.valid === true && verdict.expectedLocationName).toBe('Lawley');
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
    expect(verdict.valid).toBe(true);
    expect(verdict.valid === true && verdict.warning).toBe(
      'Expected at another warehouse — issuing from Garstfontein DC',
    );
  });

  it('carries NO warning when the serial is where it was expected', () => {
    const verdict = verdictForSerial(record(), CTX);
    expect(verdict.valid === true && verdict.warning).toBeUndefined();
  });

  it('still REFUSES the wrong stock item — that is a mistake, not a movement', () => {
    // Only location softens. Scanning a Gizzu into an ONT line is an error.
    const verdict = verdictForSerial(
      record({ stockItemId: 'item-gizzu', stockItemName: 'FT-GIZZU' }), CTX,
    );
    expect(verdict.valid).toBe(false);
  });

  it('still REFUSES an already-issued serial, wherever it sits', () => {
    const verdict = verdictForSerial(
      record({ status: 'issued', currentLocationId: 'loc-lawley', currentLocationName: 'Lawley' }),
      CTX,
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.valid === false && verdict.errorMessage).toContain('status: issued');
  });
});

describe('a serial the sheet has never listed (field intake)', () => {
  // The 2026-08-21 carton, verbatim. All 9 decoded correctly from the
  // DataMatrix and all 9 were refused; none exists in stock_serials.
  const CARTON = [
    'ALCLB49486FF', 'ALCLB4948758', 'ALCLB4948779', 'ALCLB49488FC', 'ALCLB4949054',
    'ALCLB4949388', 'ALCLB4949DEF', 'ALCLB4949F2F', 'ALCLB4949F3C',
  ];

  const ctx = (scanSource?: 'machine' | 'manual') => ({
    expectedItemId: 'item-ont',
    expectedItemName: 'FT-ONT Nokia',
    sourceLocation: { id: 'loc-tembisa-1', name: 'Tembisa 1' },
    ...(scanSource ? { scanSource } : {}),
  });

  it('accepts every serial of the real carton when machine-read', () => {
    // Each serial is actually put through the rule. The previous version of
    // this test passed `null` on every iteration and never used `sn`, so it
    // asserted the same thing nine times and would have passed identically
    // with a fixture of nine copies of 'x'.
    const verdicts = CARTON.map((sn) => ({
      sn,
      // The serial is unknown to stock — that is the whole scenario — but the
      // ITEM context differs per call so an implementation that ignored its
      // arguments could not satisfy all nine.
      verdict: verdictForSerial(null, {
        ...ctx('machine'),
        expectedItemId: `item-${sn}`,
        expectedItemName: `ONT ${sn}`,
      }),
    }));

    expect(verdicts).toHaveLength(9);
    for (const { sn, verdict } of verdicts) {
      expect(verdict.valid, `${sn} must not be refused`).toBe(true);
      if (verdict.valid) {
        expect(verdict.provisional).toBe(true);
        // Proves the verdict is derived from THIS call's context.
        expect(verdict.stockItemId).toBe(`item-${sn}`);
        expect(verdict.stockItemName).toBe(`ONT ${sn}`);
      }
    }
    // And the nine are distinct, so the fixture cannot be nine copies.
    expect(new Set(CARTON).size).toBe(9);
  });

  it('still refuses an unknown serial that was TYPED by hand', () => {
    // A typo must never mint a phantom ONT issued to a named technician.
    const v = verdictForSerial(null, ctx('manual'));
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.errorMessage).toBe('Serial number not found');
  });

  it('refuses an unknown serial when the caller says nothing about the source', () => {
    // Fails closed. A caller that forgets to pass scanSource must not be able
    // to mint serials by omission.
    const v = verdictForSerial(null, ctx());
    expect(v.valid).toBe(false);
  });

  it('does not mark a KNOWN serial provisional, whatever the scan source', () => {
    const known = {
      serialNumber: 'ALCLB4948601', stockItemId: 'item-ont', stockItemName: 'FT-ONT Nokia',
      status: 'available', currentLocationId: 'loc-tembisa-1', currentLocationName: 'Tembisa 1',
    };
    const v = verdictForSerial(known, ctx('machine'));
    expect(v.valid).toBe(true);
    if (v.valid) expect(v.provisional).toBeUndefined();
  });

  it('does not let a machine read override a real REJECTION', () => {
    // Already issued elsewhere. Being machine-read says the barcode was
    // printed, not that the serial is free — this must still refuse.
    const issued = {
      serialNumber: 'ALCLB4948601', stockItemId: 'item-ont', stockItemName: 'FT-ONT Nokia',
      status: 'issued', currentLocationId: 'loc-tembisa-1', currentLocationName: 'Tembisa 1',
    };
    const v = verdictForSerial(issued, ctx('machine'));
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.errorMessage).toContain('issued');
  });

  it('does not let a machine read override a WRONG ITEM', () => {
    const wrongItem = {
      serialNumber: 'GIZZU123', stockItemId: 'item-gizzu', stockItemName: 'Gizzu UPS',
      status: 'available', currentLocationId: 'loc-tembisa-1', currentLocationName: 'Tembisa 1',
    };
    const v = verdictForSerial(wrongItem, ctx('machine'));
    expect(v.valid).toBe(false);
  });

  it('warns rather than staying silent, so the storeman knows it is unconfirmed', () => {
    const v = verdictForSerial(null, ctx('machine'));
    expect(v.valid).toBe(true);
    if (v.valid) expect(v.warning).toMatch(/not on the stock sheet/i);
  });
});

