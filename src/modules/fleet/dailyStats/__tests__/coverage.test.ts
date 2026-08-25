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

describe('coverageIgnition', () => {
  it('holds for the four live feeds, including ituran at 94.5%', () => {
    expect(coverageIgnition(1_000, 1_000)).toBe(true);
    expect(coverageIgnition(945, 1_000)).toBe(true);
  });

  it('fails below the ratio, and on a day with nothing to assert it', () => {
    expect(coverageIgnition(899, 1_000)).toBe(false);
    expect(coverageIgnition(0, 0)).toBe(false);
  });

  it('is true for a SNAPSHOT feed that does assert ignition on every fix', () => {
    // netstar/europcar is snapshot AND asserts ignition on 100% of fixes, because the live path is
    // tree.ts's IgnitionOn boolean rather than the backfill CSV's Status column. Granularity and
    // ignition coverage are independent facts; tying them together would zero six vehicles.
    const day = netstarDay(MORNING);
    expect(feedProfile('netstar', 'europcar').granularity).toBe('snapshot');
    expect(coverageIgnition(day.filter((p) => p.ignition !== null).length, day.length)).toBe(true);
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
