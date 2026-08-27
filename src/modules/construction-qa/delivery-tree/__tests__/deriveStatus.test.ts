import { describe, expect, it } from 'vitest';
import { derivePonStatus, deriveZoneStatus, emptyCounts, sumCounts } from '../deriveStatus';

describe('deriveZoneStatus', () => {
  it('is Maintenance only when an active FAC and an active CAC both exist', () => {
    expect(deriveZoneStatus({ hasActiveFac: true, hasActiveCac: true })).toBe('Maintenance');
  });

  it('is WIP when only the FAC is active', () => {
    expect(deriveZoneStatus({ hasActiveFac: true, hasActiveCac: false })).toBe('WIP');
  });

  it('is WIP when only the CAC is active', () => {
    expect(deriveZoneStatus({ hasActiveFac: false, hasActiveCac: true })).toBe('WIP');
  });

  it('is WIP when both certificates have been superseded', () => {
    // Superseded documents are excluded upstream, so both flags arrive false.
    expect(deriveZoneStatus({ hasActiveFac: false, hasActiveCac: false })).toBe('WIP');
  });
});

describe('derivePonStatus', () => {
  it('is WIP when no port submission is recorded', () => {
    expect(derivePonStatus(null)).toBe('WIP');
  });

  it('is Optical Submitted when a port submission timestamp exists', () => {
    expect(derivePonStatus('2026-08-20T09:15:00.000Z')).toBe('Optical Submitted');
  });
});

describe('sumCounts', () => {
  it('returns zeroes for no PONs', () => {
    expect(sumCounts([])).toEqual(emptyCounts());
  });

  it('sums each count field independently', () => {
    expect(sumCounts([
      { poles_total: 10, poles_planted: 4, activation_total: 100, activation_complete: 7 },
      { poles_total: 3, poles_planted: 1, activation_total: 25, activation_complete: 0 },
    ])).toEqual({
      poles_total: 13,
      poles_planted: 5,
      activation_total: 125,
      activation_complete: 7,
    });
  });
});
