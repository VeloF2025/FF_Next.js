import { describe, expect, it } from 'vitest';

import { VELOCITY_FIXED_POLICY } from '../defaultPolicy';
import { calculateDailyResult } from '../calculateDailyResult';

const pair = (workDate: string, clockInAt: string, clockOutAt: string | null) => ({
  workDate,
  clockInAt: new Date(clockInAt),
  clockOutAt: clockOutAt ? new Date(clockOutAt) : null,
  clockOutSource: clockOutAt ? ('device' as const) : null,
});

describe('calculateDailyResult', () => {
  it('approves a clean eight-hour weekday', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', '2026-08-03T15:00:00Z'),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      scheduledPaidHours: 8,
      recordedElapsedHours: 9,
      proposedRegularHours: 8,
      status: 'approved',
      exceptionKinds: [],
    });
  });

  it('caps a missing weekday clock-out and awaits the worker', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', null),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      recordedElapsedHours: null,
      proposedRegularHours: 8,
      status: 'awaiting_worker',
      exceptionKinds: ['missing_clock_out'],
    });
  });

  it('requires supervisor approval for public-holiday work without ordinary hours', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', '2026-08-03T15:00:00Z'),
      isPublicHoliday: true,
    });

    expect(result).toMatchObject({
      proposedRegularHours: null,
      proposedOvertimeHours: 0,
      proposedSundayHours: 0,
      proposedHolidayHours: 9,
      attendanceClassification: 'public_holiday',
      status: 'awaiting_supervisor',
      exceptionKinds: ['public_holiday_work'],
    });
  });

  it('marks a negative clock duration as unreliable evidence', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T15:00:00Z', '2026-08-03T06:00:00Z'),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      recordedElapsedHours: null,
      proposedRegularHours: null,
      status: 'awaiting_supervisor',
      exceptionKinds: ['evidence_unreliable'],
    });
  });

  it('marks an invalid clock timestamp as unreliable evidence', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: {
        workDate: '2026-08-03',
        clockInAt: new Date('invalid'),
        clockOutAt: new Date('2026-08-03T15:00:00Z'),
        clockOutSource: 'device',
      },
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      status: 'awaiting_supervisor',
      exceptionKinds: ['evidence_unreliable'],
    });
  });

  it('interprets schedule boundaries in SAST rather than the host timezone', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T05:59:00Z', '2026-08-03T15:00:00Z'),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      proposedOvertimeHours: 0.02,
      exceptionKinds: ['outside_schedule'],
    });
  });

  it('auto-approves supplied approved leave when there are no punches', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: { workDate: '2026-08-03', clockInAt: null, clockOutAt: null, clockOutSource: null },
      approvedLeave: { classification: 'sick_leave', hours: 8 },
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      leaveHours: 8,
      attendanceClassification: 'sick_leave',
      status: 'approved',
      exceptionKinds: [],
    });
  });

  it('sends a missing weekday clock-in to absence review', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: { workDate: '2026-08-03', clockInAt: null, clockOutAt: null, clockOutSource: null },
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      status: 'absence_review',
      exceptionKinds: ['missing_clock_in'],
    });
  });

  it('produces stable fingerprints for identical policy inputs', () => {
    const input = {
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', '2026-08-03T15:00:00Z'),
      isPublicHoliday: false,
    };

    const same = calculateDailyResult({ ...input, evidence: { ...input.evidence } });
    const changed = calculateDailyResult({ ...input, isPublicHoliday: true });

    expect(calculateDailyResult(input).calculationFingerprint).toBe(same.calculationFingerprint);
    expect(changed.calculationFingerprint).not.toBe(same.calculationFingerprint);
  });

  it('canonicalises policy values before fingerprinting', () => {
    const reorderedPolicy = {
      lateAlertMinutes: 15,
      sundayMissingOutCapHours: 5,
      sundayScheduled: false,
      saturdayPaidCapHours: 5,
      saturdayEnd: '13:00',
      saturdayStart: '08:00',
      weekdayPaidCapHours: 8,
      weekdayUnpaidBreakMinutes: 60,
      weekdayEnd: '17:00',
      weekdayStart: '08:00',
      timezone: 'Africa/Johannesburg',
      id: 'velocity-fixed-schedule-v1',
    } as const;
    const evidence = pair('2026-08-03', '2026-08-03T06:00:00Z', '2026-08-03T15:00:00Z');

    const original = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence,
      isPublicHoliday: false,
    });
    const reordered = calculateDailyResult({
      policy: reorderedPolicy,
      evidence,
      isPublicHoliday: false,
    });

    expect(reordered.calculationFingerprint).toBe(original.calculationFingerprint);
  });
});
