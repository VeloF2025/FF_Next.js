/**
 * Guards the GRN/transfer site-dropdown predicate.
 *
 * Fixtures mirror production rows read from stock_locations on 2026-08-21 —
 * including the Faulty Equipment Bin, which is the one row that is
 * locationType 'warehouse' AND is_virtual true.
 */
import { describe, it, expect } from 'vitest';
import { isReceivableLocation } from '../receivableLocations';

describe('isReceivableLocation', () => {
  it('accepts a real site warehouse', () => {
    expect(isReceivableLocation({ locationType: 'warehouse', isVirtual: false })).toBe(true);
  });

  it('accepts a site store — the arm the GRN screen used to drop', () => {
    expect(isReceivableLocation({ locationType: 'site_store', isVirtual: false })).toBe(true);
  });

  it('rejects the Faulty Equipment Bin: warehouse type, but virtual', () => {
    expect(isReceivableLocation({ locationType: 'warehouse', isVirtual: true })).toBe(false);
  });

  it.each(['transit', 'technician', 'customer', 'scrap', 'adjustment', 'vendor'])(
    'rejects the %s location type',
    (locationType) => {
      expect(isReceivableLocation({ locationType, isVirtual: true })).toBe(false);
    }
  );

  it('rejects a non-virtual technician location', () => {
    expect(isReceivableLocation({ locationType: 'technician', isVirtual: false })).toBe(false);
  });

  it("rejects 'internal' — never a real LocationType, the dead arm of the old filter", () => {
    expect(isReceivableLocation({ locationType: 'internal', isVirtual: false })).toBe(false);
  });

  it('treats a missing isVirtual as not virtual', () => {
    expect(isReceivableLocation({ locationType: 'warehouse' })).toBe(true);
  });
});
