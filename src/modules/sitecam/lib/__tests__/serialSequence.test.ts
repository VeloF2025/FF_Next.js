import { describe, it, expect } from 'vitest';
import { isLastSerial, nextSerialPatch } from '../serialSequence';

const ont = { device: 'ont' as const, label: 'ONT Serial' };
const ups = { device: 'ups' as const, label: 'Gizzu UPS Serial' };

describe('isLastSerial', () => {
  it('is false on the first of two serials, true on the second', () => {
    expect(isLastSerial({ serialIndex: 0, serials: [ont, ups] })).toBe(false);
    expect(isLastSerial({ serialIndex: 1, serials: [ont, ups] })).toBe(true);
  });

  it('treats a single (or empty) serial list as already the last', () => {
    expect(isLastSerial({ serialIndex: 0, serials: [ont] })).toBe(true);
    expect(isLastSerial({ serialIndex: 0, serials: [] })).toBe(true);
  });
});

describe('nextSerialPatch', () => {
  it('advances to the next serial, resetting attempts and mirroring its device/label', () => {
    expect(nextSerialPatch({ serialIndex: 0, serials: [ont, ups] })).toEqual({
      serialIndex: 1,
      serialLabel: 'Gizzu UPS Serial',
      serialDevice: 'ups',
      serialAttempts: 0,
      serialScanned: null,
    });
  });
});
