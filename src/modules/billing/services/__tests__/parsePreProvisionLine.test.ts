import { describe, it, expect } from 'vitest';
import { parsePreProvisionLine } from '../parseFTPaymentSummary';

describe('parsePreProvisionLine', () => {
  // Real WE260517 PDF lines after pdf-parse extraction (tab-separated values).
  const lawley =
    'Pre-Provisioned 20% of Pre-provisioned withheld \t0 \t-236 OES Report, as at 17 May 2026';
  const mamelodi =
    'Pre-Provisioned 20% of Pre-provisioned withheld \t0 \t-57 OES Report, as at 17 May 2026';
  const mohadin =
    'Pre-Provisioned 20% of Pre-provisioned withheld \t0 \t-651 OES Report, as at 17 May 2026';
  const tembisaPop01 =
    'Pre-Provisioned 20% of Pre-provisioned withheld \t0 \t0 OES Report, as at 10 May 2026';

  it('returns 0 for Lawley (OES cumulative -236 must not leak through)', () => {
    expect(parsePreProvisionLine(lawley)).toEqual({ count: 0, isNegativeRaw: false });
  });

  it('returns 0 for Mamelodi (OES cumulative -57 must not leak through)', () => {
    expect(parsePreProvisionLine(mamelodi)).toEqual({ count: 0, isNegativeRaw: false });
  });

  it('returns 0 for Mohadin (OES cumulative -651 must not leak through)', () => {
    expect(parsePreProvisionLine(mohadin)).toEqual({ count: 0, isNegativeRaw: false });
  });

  it('returns 0 when both columns are 0 (Tembisa POP01)', () => {
    expect(parsePreProvisionLine(tembisaPop01)).toEqual({ count: 0, isNegativeRaw: false });
  });

  it('extracts a non-zero positive current-week count', () => {
    const line =
      'Pre-Provisioned 20% of Pre-provisioned withheld \t5 \t-100 OES Report, as at 17 May 2026';
    expect(parsePreProvisionLine(line)).toEqual({ count: 5, isNegativeRaw: false });
  });

  it('flags a negative current-week count via isNegativeRaw', () => {
    const line =
      'Pre-Provisioned 20% of Pre-provisioned withheld \t-3 \t-100 OES Report, as at 17 May 2026';
    expect(parsePreProvisionLine(line)).toEqual({ count: 3, isNegativeRaw: true });
  });

  it('ignores the "as at <date>" suffix so year digits do not leak in', () => {
    const line =
      'Pre-Provisioned 20% of Pre-provisioned withheld \t0 \t0 OES Report, as at 31 December 2099';
    expect(parsePreProvisionLine(line)).toEqual({ count: 0, isNegativeRaw: false });
  });

  it('returns 0 when the "withheld" anchor is missing (defensive)', () => {
    expect(parsePreProvisionLine('Pre-Provisioned 20% of Pre-provisioned')).toEqual({
      count: 0,
      isNegativeRaw: false,
    });
  });
});
