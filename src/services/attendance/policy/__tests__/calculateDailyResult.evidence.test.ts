import { describe, expect, it } from 'vitest';

import { VELOCITY_FIXED_POLICY } from '../defaultPolicy';
import { calculateDailyResult } from '../calculateDailyResult';

describe('calculateDailyResult evidence validation', () => {
  it('marks an invalid supplied clock-out unreliable before missing-clock-in routing', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: {
        workDate: '2026-08-03',
        clockInAt: null,
        clockOutAt: new Date('invalid'),
        clockOutSource: 'device',
      },
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      status: 'awaiting_supervisor',
      exceptionKinds: ['evidence_unreliable'],
    });
  });

  // Pre-#2351 reconcile runs stamped clock-in + a 9h cap onto auto-closed
  // entries as though the worker had really clocked out. Scoring that against
  // the schedule turns a missing clock-out into a believable "early departure"
  // a supervisor would approve, so a system-sourced clock-out must never be
  // treated as evidence.
  it('treats a system-sourced clock-out as missing evidence, not an early departure', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: {
        workDate: '2026-08-03',
        clockInAt: new Date('2026-08-03T05:00:00.000Z'), // 07:00 SAST
        clockOutAt: new Date('2026-08-03T14:00:00.000Z'), // 16:00 SAST — fabricated
        clockOutSource: 'system',
      },
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      status: 'awaiting_worker',
      exceptionKinds: ['missing_clock_out'],
      proposedRegularHours: 8,
      recordedElapsedHours: null,
    });
  });

  it('still scores a device clock-out at the same instants as a real early departure', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: {
        workDate: '2026-08-03',
        clockInAt: new Date('2026-08-03T05:00:00.000Z'),
        clockOutAt: new Date('2026-08-03T14:00:00.000Z'),
        clockOutSource: 'device',
      },
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      status: 'awaiting_supervisor',
      exceptionKinds: ['early_departure', 'outside_schedule'],
      recordedElapsedHours: 9,
    });
  });
});
