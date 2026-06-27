import { describe, it, expect } from 'vitest';
import { confidenceLabel, gapLabel } from '@/lib/cortex/answerFormat';

describe('confidenceLabel', () => {
  it('maps bridge confidence levels to display labels', () => {
    expect(confidenceLabel('high')).toBe('High confidence');
    expect(confidenceLabel('medium')).toBe('Medium confidence');
    expect(confidenceLabel('low')).toBe('Low confidence');
  });

  it("falls back to 'Unverified' for unknown / empty levels", () => {
    expect(confidenceLabel('')).toBe('Unverified');
    expect(confidenceLabel('weird')).toBe('Unverified');
  });
});

describe('gapLabel', () => {
  it('maps bridge gap types to short banner labels', () => {
    expect(gapLabel('missing')).toBe('No evidence');
    expect(gapLabel('low_evidence')).toBe('Limited evidence');
    expect(gapLabel('stale')).toBe('Possibly outdated');
    expect(gapLabel('conflicting')).toBe('Conflicting sources');
  });

  it("falls back to 'Note' for unknown gap types", () => {
    expect(gapLabel('anything_else')).toBe('Note');
    expect(gapLabel('')).toBe('Note');
  });
});
