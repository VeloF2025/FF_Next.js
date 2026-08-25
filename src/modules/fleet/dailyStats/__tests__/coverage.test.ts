/**
 * The coverage flags, which are what stop a two-hour snapshot feed's numbers from reading like a
 * seven-second one's.
 */
import { describe, expect, it } from 'vitest';
import {
  coverageComplete,
  coverageGforce,
  coverageIgnition,
  coverageProviderEvents,
  dayGranularity,
  feedProfile,
} from '../coverage';
import { fix, netstarDay, velocityRun } from './fixtures';

const MORNING = '2026-08-10T04:00:00.000Z';

describe('coverageGforce', () => {
  it('is false for a vehicle-day whose g columns are all zero', () => {
    // Six of the seven cartrack/velocity vehicles report constant zero across 22k-60k rows each.
    // A test written as "linear_g IS NOT NULL" passes here, and is wrong.
    expect(coverageGforce(velocityRun(MORNING, 50, [60]))).toBe(false);
  });

  it('is true as soon as one fix carries a non-zero reading, on either axis', () => {
    const withLinear = [...velocityRun(MORNING, 5, [60])];
    withLinear[2] = { ...withLinear[2]!, linearG: -0.31 };
    expect(coverageGforce(withLinear)).toBe(true);

    const withLateral = [...velocityRun(MORNING, 5, [60])];
    withLateral[4] = { ...withLateral[4]!, lateralG: 0.12 };
    expect(coverageGforce(withLateral)).toBe(true);
  });

  it('is false for a feed that leaves both columns null', () => {
    // netstar and ituran hardcode linearG: null, lateralG: null at parse time.
    expect(coverageGforce(netstarDay(MORNING))).toBe(false);
  });

  it('is false for a day with no fixes at all', () => {
    expect(coverageGforce([])).toBe(false);
  });
});

describe('coverageProviderEvents', () => {
  it('is true only when a fix carries the provider vocabulary', () => {
    expect(coverageProviderEvents(velocityRun(MORNING, 3, [60]))).toBe(true);
    expect(coverageProviderEvents(netstarDay(MORNING))).toBe(false);
    expect(coverageProviderEvents([])).toBe(false);
  });
});

describe('coverageIgnition — measurable, not merely asserted', () => {
  /** A day of `count` fixes at a fixed cadence, all asserting ignition. */
  const atCadence = (count: number, gapSeconds: number, ceiling = 300) => ({
    fixesWithIgnition: count,
    positionCount: count,
    gapCount: count - 1,
    gapsWithinCeiling: gapSeconds <= ceiling ? count - 1 : 0,
  });

  it('holds for cartrack/velocity, the one feed whose cadence can measure ignition time', () => {
    // 8 s median gap against a 300 s ceiling: every interval is attributable.
    expect(coverageIgnition(atCadence(1_169, 8))).toBe(true);
  });

  it('is FALSE for the three coarse feeds, however faithfully they assert ignition', () => {
    // This is the whole point of the flag. All three assert ignition on ~100% of fixes, and all
    // three measure zero ignition seconds because every interval exceeds the ceiling. Reporting
    // 0 / 0 / 0 beside coverage_ignition = true would read as "this vehicle did not run today"
    // when the truth is "this feed cannot see whether it ran".
    expect(coverageIgnition(atCadence(15, 1_797)), 'cartrack/urent').toBe(false);
    expect(coverageIgnition(atCadence(10, 637)), 'netstar/europcar').toBe(false);
    expect(coverageIgnition(atCadence(11, 2_095)), 'ituran/avis').toBe(false);
  });

  it('still fails a day whose fixes are dense but which does not assert ignition', () => {
    // The ratio condition survives independently: ituran leaves ignition null on 5.5% of fixes,
    // which passes, and a device fault dropping below 90% does not.
    expect(coverageIgnition({ ...atCadence(1_000, 8), fixesWithIgnition: 945 })).toBe(true);
    expect(coverageIgnition({ ...atCadence(1_000, 8), fixesWithIgnition: 899 })).toBe(false);
  });

  it('reads the MEDIAN gap, so a handful of long silences do not disqualify a dense day', () => {
    // 600 of 1,000 intervals within the ceiling: the median is inside it, and a vehicle that
    // parked underground for two hours still measured most of its day.
    expect(coverageIgnition({
      fixesWithIgnition: 1_001, positionCount: 1_001, gapCount: 1_000, gapsWithinCeiling: 600,
    })).toBe(true);
    // Exactly half is still a median at the ceiling, so it holds.
    expect(coverageIgnition({
      fixesWithIgnition: 1_001, positionCount: 1_001, gapCount: 1_000, gapsWithinCeiling: 500,
    })).toBe(true);
    // Below half, the typical interval is unattributable and the day cannot measure ignition.
    expect(coverageIgnition({
      fixesWithIgnition: 1_001, positionCount: 1_001, gapCount: 1_000, gapsWithinCeiling: 499,
    })).toBe(false);
  });

  it('is false for a day with nothing to measure across', () => {
    expect(coverageIgnition({ fixesWithIgnition: 0, positionCount: 0, gapCount: 0, gapsWithinCeiling: 0 })).toBe(false);
    // One fix bounds no interval, so it can assert ignition and still measure no seconds of it.
    expect(coverageIgnition({ fixesWithIgnition: 1, positionCount: 1, gapCount: 0, gapsWithinCeiling: 0 })).toBe(false);
  });

  it('is independent of granularity — the cadence decides, not the API shape', () => {
    // netstar/europcar is a SNAPSHOT feed that asserts ignition on 100% of fixes. Its ratio is
    // perfect and its cadence is not, and it is the cadence that disqualifies it. A snapshot feed
    // polled every 30 s would qualify; a history feed polled every 2 h would not.
    const day = netstarDay(MORNING);
    expect(feedProfile('netstar', 'europcar').granularity).toBe('snapshot');
    expect(day.every((p) => p.ignition !== null)).toBe(true);
    expect(coverageIgnition(atCadence(day.length, 637))).toBe(false);
    expect(coverageIgnition(atCadence(day.length, 30))).toBe(true);
  });
});

describe('feedProfile', () => {
  it('carries the measured thresholds for each live feed', () => {
    expect(feedProfile('cartrack', 'velocity')).toEqual({
      granularity: 'history', expectedMinFixes: 200, maxAllowedGapSeconds: 3_600,
    });
    expect(feedProfile('netstar', 'europcar').granularity).toBe('snapshot');
    expect(feedProfile('ituran', 'avis').granularity).toBe('snapshot');
  });

  it('gives an unmeasured account its provider API shape but not its cadence', () => {
    const unmeasured = feedProfile('cartrack', 'brand-new-account');
    expect(unmeasured.granularity).toBe('history');
    expect(unmeasured.expectedMinFixes).toBeLessThan(feedProfile('cartrack', 'velocity').expectedMinFixes);
  });

  it('does not pretend to know an unknown provider', () => {
    expect(feedProfile('some-new-vendor', 'x').granularity).toBe('snapshot');
    expect(feedProfile(null, null).granularity).toBe('snapshot');
  });
});

describe('dayGranularity', () => {
  it('is none with no feeds and mixed with two kinds', () => {
    expect(dayGranularity([])).toBe('none');
    expect(dayGranularity([feedProfile('cartrack', 'velocity')])).toBe('history');
    expect(dayGranularity([feedProfile('cartrack', 'velocity'), feedProfile('cartrack', 'urent')]))
      .toBe('history');
    expect(dayGranularity([feedProfile('cartrack', 'velocity'), feedProfile('netstar', 'europcar')]))
      .toBe('mixed');
  });
});

describe('coverageComplete', () => {
  it('needs BOTH the fix count and the silence to be within the feed profile', () => {
    const velocity = feedProfile('cartrack', 'velocity');
    expect(coverageComplete(1_169, 298, velocity)).toBe(true);
    expect(coverageComplete(12, 298, velocity)).toBe(false);
    expect(coverageComplete(1_169, 7_200, velocity)).toBe(false);
  });

  it('calls a quiet but healthy snapshot day complete', () => {
    // Ten fixes and a 90-minute gap is an ordinary netstar day, not a fault.
    expect(coverageComplete(10, 5_400, feedProfile('netstar', 'europcar'))).toBe(true);
  });

  it('is false for a day with no fixes at all', () => {
    expect(coverageComplete(0, 0, feedProfile('cartrack', 'velocity'))).toBe(false);
    expect(coverageComplete(0, 0, feedProfile('netstar', 'europcar'))).toBe(false);
  });
});

describe('a fix with no feed', () => {
  it('still resolves a profile rather than throwing', () => {
    const orphan = fix(MORNING, '', '', { offsetSeconds: 0 });
    expect(() => feedProfile(orphan.provider, orphan.accountRef)).not.toThrow();
  });
});
