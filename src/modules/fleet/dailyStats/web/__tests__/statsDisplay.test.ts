/**
 * The one rule this module exists for: an unmeasurable statistic is never a zero.
 *
 * Each case below is a measured production shape, not a convenient one — see `fixtures.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  MISSING_TEXT, NO_IGNITION_OBSERVED, UNMEASURABLE_TEXT, coverageState, datesInWindow,
  distanceValue, harshValue, ignitionTimeValue, ignitionWindowValue, maxSpeedValue,
  speedingSecondsValue, sumOverMeasurableDays, trackerSilenceValue,
} from '../statsDisplay';
import { cartrackDay, netstarDay } from './fixtures';

describe('ignition-derived time', () => {
  it('is an em dash, not 0, when the feed cannot measure it', () => {
    const value = ignitionTimeValue(netstarDay(), 'ignitionSeconds');
    expect(value.kind).toBe('unmeasurable');
    expect(value.text).toBe(UNMEASURABLE_TEXT);
    expect(value.text).not.toBe('0m');
  });

  it('is a duration when the feed can', () => {
    expect(ignitionTimeValue(cartrackDay(), 'ignitionSeconds')).toEqual({
      kind: 'value', text: '7h 30m',
    });
  });

  it('is "No data" for a day that has no row at all', () => {
    expect(ignitionTimeValue(null, 'movingSeconds').text).toBe(MISSING_TEXT);
  });

  it('renders a genuine 0 as 0 when the feed COULD measure it', () => {
    // The mirror image of the rule: a measurable day on which the vehicle truly did not run must
    // still read as zero, or the em dash stops meaning anything.
    const parked = cartrackDay({ ignitionSeconds: 0, movingSeconds: 0, idleSeconds: 0 });
    expect(ignitionTimeValue(parked, 'ignitionSeconds')).toEqual({ kind: 'value', text: '0m' });
  });
});

describe('the statistics that survive a coverage failure', () => {
  it('still reports distance and top speed on a snapshot feed', () => {
    expect(distanceValue(netstarDay()).text).toBe('61.4 km');
    expect(maxSpeedValue(netstarDay()).text).toBe('96 km/h');
  });

  it('reports a null top speed as unmeasurable rather than 0 km/h', () => {
    expect(maxSpeedValue(cartrackDay({ maxSpeedKph: null })).kind).toBe('unmeasurable');
  });
});

describe('speeding duration', () => {
  it('is unmeasurable when 0 seconds sits beside real events on a coarse feed', () => {
    expect(speedingSecondsValue(netstarDay()).kind).toBe('unmeasurable');
  });

  it('is unmeasurable for a NON-ZERO duration on a feed that fails coverage_ignition', () => {
    // Migration 528's own worked example: an ituran/avis-shaped day of ~35-minute gaps carrying
    // one 60 s pair whose closing fix was speeding stores 60 s beside coverage_ignition = false
    // and ignition_seconds = 0. Rendering "1m" asserts a measurement the feed cannot support —
    // the flag says "do not trust the duration", not "the duration is zero".
    const ituranDay = netstarDay({
      provider: 'ituran', accountRef: 'avis', speedingEvents: 1, speedingSeconds: 60,
    });
    const value = speedingSecondsValue(ituranDay);
    expect(value.kind).toBe('unmeasurable');
    expect(value.text).toBe(UNMEASURABLE_TEXT);
    expect(value.text).not.toBe('1m');
  });

  it('is a real zero when the feed could measure it and there were no events', () => {
    expect(speedingSecondsValue(cartrackDay({ speedingEvents: 0, speedingSeconds: 0 })).text)
      .toBe('0m');
  });

  it('reports seconds with no events — the second day of a midnight overspeed', () => {
    expect(speedingSecondsValue(cartrackDay({ speedingEvents: 0, speedingSeconds: 1_792 })).text)
      .toBe('29m');
  });
});

describe('harsh counts', () => {
  it('are unmeasurable when neither g-force nor provider events are present', () => {
    expect(harshValue(netstarDay(), 0).kind).toBe('unmeasurable');
  });

  it('are shown on the cartrack family whose g columns are structurally zero', () => {
    // coverageGforce false, coverageProviderEvents true: the events are real and the g columns
    // cannot see them.
    expect(harshValue(cartrackDay(), 3)).toEqual({ kind: 'value', text: '3' });
  });
});

describe('the observations that survive a coverage failure', () => {
  it('reports the largest unobserved stretch even on a feed that cannot measure ignition', () => {
    // This is the number that EXPLAINS the em dashes beside it, so suppressing it there would
    // hide the evidence exactly where it matters most.
    const value = trackerSilenceValue(netstarDay());
    expect(value.kind).toBe('value');
    expect(value.text).toBe('2h 0m');
    expect(value.title).toMatch(/LARGEST unobserved stretch/);
  });

  it('reports first and last ignition as SAST clock times, with the caveat', () => {
    const value = ignitionWindowValue(cartrackDay());
    // 04:10Z and 15:00Z are 06:10 and 17:00 in Johannesburg.
    expect(value.text).toBe('06:10–17:00');
    expect(value.title).toMatch(/Not a duration/);
  });

  it('says no ignition was observed rather than printing 00:00', () => {
    const value = ignitionWindowValue(netstarDay());
    expect(value.text).toBe(UNMEASURABLE_TEXT);
    expect(value.title).toBe(NO_IGNITION_OBSERVED);
  });

  it('is "No data" for a day with no row at all', () => {
    expect(trackerSilenceValue(null).text).toBe(MISSING_TEXT);
    expect(ignitionWindowValue(null).text).toBe(MISSING_TEXT);
  });
});

describe('coverage state', () => {
  it('has three states and never collapses partial into either neighbour', () => {
    expect(coverageState(null)).toBe('missing');
    expect(coverageState(cartrackDay({ coverageComplete: false }))).toBe('partial');
    expect(coverageState(cartrackDay())).toBe('complete');
  });
});

describe('partial totals', () => {
  it('sums only the days the feed could measure, and says how many that was', () => {
    const rows = [cartrackDay(), netstarDay(), cartrackDay({ workDate: '2026-08-22' })];
    expect(sumOverMeasurableDays(rows, 'ignitionSeconds')).toEqual({
      total: 54_000, daysCounted: 2, daysConsidered: 3,
    });
  });
});

describe('datesInWindow', () => {
  it('enumerates every SAST day inclusive of both ends', () => {
    expect(datesInWindow('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02',
    ]);
  });
});
