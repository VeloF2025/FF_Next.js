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
});
