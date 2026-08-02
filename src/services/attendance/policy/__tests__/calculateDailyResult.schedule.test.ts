import { describe, expect, it } from 'vitest';

import { VELOCITY_FIXED_POLICY } from '../defaultPolicy';
import { calculateDailyResult } from '../calculateDailyResult';

const pair = (workDate: string, clockInAt: string, clockOutAt: string | null) => ({
  workDate,
  clockInAt: new Date(clockInAt),
  clockOutAt: clockOutAt ? new Date(clockOutAt) : null,
  clockOutSource: clockOutAt ? ('device' as const) : null,
});

describe('calculateDailyResult schedule rules', () => {
  it('approves the five paid Saturday hours', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-01', '2026-08-01T06:00:00Z', '2026-08-01T11:00:00Z'),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      scheduledPaidHours: 5,
      recordedElapsedHours: 5,
      proposedRegularHours: 5,
      status: 'approved',
      exceptionKinds: [],
    });
  });

  it('uses the five-hour provisional cap for missing Saturday clock-out', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-01', '2026-08-01T06:00:00Z', null),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      proposedRegularHours: 5,
      status: 'awaiting_worker',
      exceptionKinds: ['missing_clock_out'],
    });
  });

  it('does not create a Sunday absence and sends Sunday work to approval', () => {
    const noWork = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: { workDate: '2026-08-02', clockInAt: null, clockOutAt: null, clockOutSource: null },
      isPublicHoliday: false,
    });
    const worked = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-02', '2026-08-02T06:00:00Z', '2026-08-02T11:00:00Z'),
      isPublicHoliday: false,
    });

    expect(noWork).toMatchObject({ scheduledPaidHours: 0, status: 'expected', exceptionKinds: [] });
    expect(worked).toMatchObject({
      status: 'awaiting_supervisor',
      proposedSundayHours: 5,
      exceptionKinds: ['sunday_work'],
    });
  });

  it('uses the five-hour provisional cap for missing Sunday clock-out', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-02', '2026-08-02T06:00:00Z', null),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      proposedSundayHours: 5,
      status: 'awaiting_worker',
      exceptionKinds: ['missing_clock_out', 'sunday_work'],
    });
  });

  it('routes early clock-in time to provisional overtime', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T05:30:00Z', '2026-08-03T15:00:00Z'),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      proposedRegularHours: 8,
      proposedOvertimeHours: 0.5,
      status: 'awaiting_supervisor',
      exceptionKinds: ['outside_schedule'],
    });
  });

  it('routes late clock-out time to provisional overtime', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', '2026-08-03T15:30:00Z'),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      proposedRegularHours: 8,
      proposedOvertimeHours: 0.5,
      status: 'awaiting_supervisor',
      exceptionKinds: ['outside_schedule'],
    });
  });

  it('does not deduct ordinary hours for a late arrival', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:16:00Z', '2026-08-03T15:00:00Z'),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      proposedRegularHours: null,
      status: 'awaiting_supervisor',
      exceptionKinds: ['late_arrival'],
    });
  });

  it('flags a one-minute late arrival but not the exact schedule boundary', () => {
    const exact = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', '2026-08-03T15:00:00Z'),
      isPublicHoliday: false,
    });
    const oneMinuteLate = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:01:00Z', '2026-08-03T15:00:00Z'),
      isPublicHoliday: false,
    });

    expect(exact).toMatchObject({ status: 'approved', exceptionKinds: [] });
    expect(oneMinuteLate).toMatchObject({
      proposedRegularHours: null,
      status: 'awaiting_supervisor',
      exceptionKinds: ['late_arrival'],
    });
  });

  it('does not deduct ordinary hours for an early departure', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', '2026-08-03T14:44:00Z'),
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      proposedRegularHours: null,
      status: 'awaiting_supervisor',
      exceptionKinds: ['early_departure'],
    });
  });

  it('flags a one-minute early departure but not the exact schedule boundary', () => {
    const exact = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', '2026-08-03T15:00:00Z'),
      isPublicHoliday: false,
    });
    const oneMinuteEarly = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: pair('2026-08-03', '2026-08-03T06:00:00Z', '2026-08-03T14:59:00Z'),
      isPublicHoliday: false,
    });

    expect(exact).toMatchObject({ status: 'approved', exceptionKinds: [] });
    expect(oneMinuteEarly).toMatchObject({
      proposedRegularHours: null,
      status: 'awaiting_supervisor',
      exceptionKinds: ['early_departure'],
    });
  });
});
