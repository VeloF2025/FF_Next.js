import { describe, expect, it } from 'vitest';
import { calculateFreshness } from '../freshness';

describe('calculateFreshness', () => {
  // Catches counting a 23-hour SAST weekday interval as stale.
  it('is fresh before 24 weekday hours', () => {
    const value = calculateFreshness('2026-07-29T08:00:00Z', new Date('2026-07-30T07:00:00Z'));
    expect(value.weekdayAgeHours).toBe(23);
    expect(value.state).toBe('fresh');
  });

  // Catches accumulating Saturday and Sunday as elapsed weekday hours.
  it('excludes Saturday and Sunday from Friday-to-Monday age', () => {
    const value = calculateFreshness('2026-07-31T10:00:00Z', new Date('2026-08-03T11:00:00Z'));
    expect(value.weekdayAgeHours).toBe(25);
    expect(value.state).toBe('stale');
  });

  // Catches showing a stale warning when the current SAST day is a weekend.
  it('suppresses a stale warning during the weekend', () => {
    const value = calculateFreshness('2026-07-30T08:00:00Z', new Date('2026-08-01T10:00:00Z'));
    expect(value.state).toBe('stale');
    expect(value.warningSuppressed).toBe(true);
  });

  // Catches treating absent or unparsable update times as a known freshness state.
  it('returns unknown for a missing or invalid timestamp', () => {
    expect(calculateFreshness(null).state).toBe('unknown');
    expect(calculateFreshness('not-a-date').state).toBe('unknown');
  });

  // Catches an invalid current time being treated as a zero-hour fresh interval.
  it('returns unknown for an invalid current time', () => {
    expect(calculateFreshness('2026-07-30T08:00:00Z', new Date('invalid')).state).toBe('unknown');
  });
});
