/**
 * Guards the aggregation behaviour the step-6 photo + drops sources rely on:
 * adding another agreeing source strengthens the verdict, and a single
 * dissenting source (e.g. a VLM misread) drops it to mismatch rather than
 * silently "verifying" the wrong device.
 */
import { describe, it, expect } from 'vitest';
import { calculateVerification } from '../serialVerificationService';

describe('calculateVerification with the extra step-6 / drops sources', () => {
  it('two agreeing sources → partial (needs a third to reach verified)', () => {
    expect(calculateVerification(['ALCLB48D0001', 'ALCLB48D0001']).status).toBe('partial');
  });

  it('three agreeing sources (e.g. scan + step-6 photo + OES) → verified', () => {
    expect(
      calculateVerification(['ALCLB48D0001', 'ALCLB48D0001', 'ALCLB48D0001']).status,
    ).toBe('verified');
  });

  it('one dissenting source → mismatch, not verified', () => {
    expect(
      calculateVerification(['ALCLB48D0001', 'ALCLB48D0001', 'ALCLB48DXXXX']).status,
    ).toBe('mismatch');
  });

  it('normalises case/whitespace before comparing', () => {
    expect(
      calculateVerification(['alclb48d0001', '  ALCLB48D0001 ', 'ALCLB48D0001']).status,
    ).toBe('verified');
  });

  it('nulls are ignored (UPS OES/offline slots) — two real agreeing values stay partial', () => {
    expect(
      calculateVerification([null, null, 'GU18W12V1112223334', 'GU18W12V1112223334']).status,
    ).toBe('partial');
  });
});
