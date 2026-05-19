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

  it('extracts current-week=0 and outstanding=236 for Lawley', () => {
    expect(parsePreProvisionLine(lawley)).toEqual({
      count: 0,
      outstanding: 236,
      isNegativeRaw: false,
      isOutstandingPositive: false,
    });
  });

  it('extracts current-week=0 and outstanding=57 for Mamelodi', () => {
    expect(parsePreProvisionLine(mamelodi)).toEqual({
      count: 0,
      outstanding: 57,
      isNegativeRaw: false,
      isOutstandingPositive: false,
    });
  });

  it('extracts current-week=0 and outstanding=651 for Mohadin', () => {
    expect(parsePreProvisionLine(mohadin)).toEqual({
      count: 0,
      outstanding: 651,
      isNegativeRaw: false,
      isOutstandingPositive: false,
    });
  });

  it('returns both zeros when neither column has data (Tembisa POP01)', () => {
    expect(parsePreProvisionLine(tembisaPop01)).toEqual({
      count: 0,
      outstanding: 0,
      isNegativeRaw: false,
      isOutstandingPositive: false,
    });
  });

  it('extracts a non-zero positive current-week count alongside outstanding', () => {
    const line =
      'Pre-Provisioned 20% of Pre-provisioned withheld \t5 \t-100 OES Report, as at 17 May 2026';
    expect(parsePreProvisionLine(line)).toEqual({
      count: 5,
      outstanding: 100,
      isNegativeRaw: false,
      isOutstandingPositive: false,
    });
  });

  it('flags a negative current-week count via isNegativeRaw', () => {
    const line =
      'Pre-Provisioned 20% of Pre-provisioned withheld \t-3 \t-100 OES Report, as at 17 May 2026';
    expect(parsePreProvisionLine(line)).toEqual({
      count: 3,
      outstanding: 100,
      isNegativeRaw: true,
      isOutstandingPositive: false,
    });
  });

  it('flags a positive OES cumulative via isOutstandingPositive', () => {
    // FT prints OES negative in every observed PDF; a positive would indicate
    // a net credit or format change and must surface a warning.
    const line =
      'Pre-Provisioned 20% of Pre-provisioned withheld \t0 \t50 OES Report, as at 17 May 2026';
    expect(parsePreProvisionLine(line)).toEqual({
      count: 0,
      outstanding: 50,
      isNegativeRaw: false,
      isOutstandingPositive: true,
    });
  });

  it('combines negative count and positive outstanding (double sign-flip)', () => {
    const line =
      'Pre-Provisioned 20% of Pre-provisioned withheld \t-2 \t50 OES Report, as at 17 May 2026';
    expect(parsePreProvisionLine(line)).toEqual({
      count: 2,
      outstanding: 50,
      isNegativeRaw: true,
      isOutstandingPositive: true,
    });
  });

  it('ignores the "as at <date>" suffix so year digits do not leak in', () => {
    const line =
      'Pre-Provisioned 20% of Pre-provisioned withheld \t0 \t0 OES Report, as at 31 December 2099';
    expect(parsePreProvisionLine(line)).toEqual({
      count: 0,
      outstanding: 0,
      isNegativeRaw: false,
      isOutstandingPositive: false,
    });
  });

  it('returns all zeros when the "withheld" anchor is missing', () => {
    expect(parsePreProvisionLine('Pre-Provisioned 20% of Pre-provisioned')).toEqual({
      count: 0,
      outstanding: 0,
      isNegativeRaw: false,
      isOutstandingPositive: false,
    });
  });

  it('returns count only when the OES column is absent', () => {
    const line = 'Pre-Provisioned 20% of Pre-provisioned withheld \t7';
    expect(parsePreProvisionLine(line)).toEqual({
      count: 7,
      outstanding: 0,
      isNegativeRaw: false,
      isOutstandingPositive: false,
    });
  });
});
