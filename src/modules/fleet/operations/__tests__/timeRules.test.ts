import { describe, expect, it } from 'vitest';
import { operationalWindow, timePhase } from '../timeRules';
import type { OperationalRule, OperationalSchedule } from '../types';

const rule: OperationalRule = {
  id: 'rule-1', version: 1, timezone: 'Africa/Johannesburg', effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  monitoringBeforeMinutes: 60, monitoringAfterMinutes: 60, arrivalDwellMinutes: 5,
  wrongSiteConfirmationMinutes: 5, earlyDepartureConfirmationMinutes: 10,
  approachingDistanceMeters: 10_000, approachingMinReadings: 2, minimumMovingSpeedKmh: 5,
  evidenceMismatchToleranceMeters: 250,
};
const schedule: OperationalSchedule = {
  policyId: 'policy-1', workDate: '2026-08-14', timezone: 'Africa/Johannesburg', scheduled: true,
  explicitWork: false, startTime: '08:00:00', endTime: '17:00:00', graceMinutes: 15,
};

/**
 * Sunday, or a driver who is not `attendance_tracked`: the policy gives the day
 * no shift window, so startTime/endTime are NULL. These two tests pin the only
 * safe readings of that state — there is no window to compute, and there is no
 * shift to be late for. Defaulting either to 08:00-17:00 would manufacture a
 * `late` finding against a named person.
 */
const noWindow: OperationalSchedule = { ...schedule, scheduled: false, startTime: null, endTime: null };

describe('a schedule with no shift window', () => {
  it('refuses to compute a window, naming the missing window specifically', () => {
    expect(() => operationalWindow(noWindow, rule))
      .toThrow('Attendance schedule has no shift window for this day');
  });

  /**
   * Explicit work keeps evaluation alive past the not-scheduled check, so this
   * is the path that would otherwise reach parseTime(null).
   */
  it('reports off duty rather than throwing when the driver is explicitly rostered', () => {
    expect(timePhase('2026-08-14T09:00:00.000Z', { ...noWindow, explicitWork: true }, rule)).toBe('off_duty');
  });
});

describe('operational time boundaries', () => {
  it('returns the exact SAST window instants for an 08:00-17:00 shift', () => {
    expect(operationalWindow(schedule, rule)).toEqual({
      monitoringStart: '2026-08-14T05:00:00.000Z', scheduledStart: '2026-08-14T06:00:00.000Z',
      graceEnd: '2026-08-14T06:15:00.000Z', scheduledEnd: '2026-08-14T15:00:00.000Z',
      monitoringEnd: '2026-08-14T16:00:00.000Z',
    });
  });

  it.each([
    ['2026-08-14T06:59:59+02:00', 'off_duty'], ['2026-08-14T07:00:00+02:00', 'before_start'],
    ['2026-08-14T08:15:00+02:00', 'grace'], ['2026-08-14T17:00:00+02:00', 'after_shift'],
    ['2026-08-14T18:00:00+02:00', 'after_shift'], ['2026-08-14T18:00:01+02:00', 'off_duty'],
  ] as const)('classifies %s at the inclusive boundary as %s', (asOf, expected) => {
    expect(timePhase(asOf, schedule, rule)).toBe(expected);
  });

  it('uses resolved Saturday hours and monitors explicit unscheduled work', () => {
    const saturday = { ...schedule, workDate: '2026-08-15', startTime: '08:00', endTime: '13:00' };
    expect(operationalWindow(saturday, rule)?.scheduledEnd).toBe('2026-08-15T11:00:00.000Z');
    expect(timePhase('2026-08-15T08:30:00+02:00', { ...saturday, scheduled: false, explicitWork: true }, rule)).toBe('active_shift');
  });

  it('returns off duty for unscheduled days and rejects missing policy', () => {
    expect(timePhase('2026-08-16T06:00:00.000Z', { ...schedule, scheduled: false, explicitWork: false }, rule)).toBe('off_duty');
    expect(() => operationalWindow(null, rule)).toThrow('Attendance schedule policy is required');
  });

  it.each([
    [{ ...schedule, startTime: '8am' }, 'time'], [{ ...schedule, workDate: '2026-02-30' }, 'date'],
    [{ ...schedule, timezone: 'UTC' }, 'timezone'], [{ ...schedule, graceMinutes: -1 }, 'grace'],
  ])('rejects malformed or unsupported persisted schedule values', (persisted, message) => {
    expect(() => operationalWindow(persisted, rule)).toThrow(message);
  });

  it.each([
    '2026-02-30T08:00:00Z',
    '2026-04-31T08:00:00+02:00',
    '2026-08-14T24:00:00Z',
    '2026-08-14T08:60:00+02:00',
    '2026-08-14T08:00:00+24:00',
  ])('rejects the impossible ISO instant %s', (asOf) => {
    expect(() => timePhase(asOf, schedule, rule)).toThrow('Evaluation instant is malformed');
  });

  it.each(['2026-08-14T05:00:00Z', '2026-08-14T07:00:00+02:00', '2026-08-14T00:00:00-05:00'])(
    'accepts the valid ISO instant %s', (asOf) => {
      expect(() => timePhase(asOf, schedule, rule)).not.toThrow();
    },
  );
});
