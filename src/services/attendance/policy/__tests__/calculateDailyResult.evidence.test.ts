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

  // upsertDailyProjection only rewrites a projection when the fingerprint
  // changes; on a match it refreshes computed_at and leaves result_status,
  // blocking_reasons and the proposed hours alone. If the fingerprint were
  // taken before the system-clock-out normalisation, replaying a day already
  // projected from fabricated evidence would match its stored fingerprint and
  // silently keep the wrong projection — the fix would be inert exactly where
  // it is needed.
  it('fingerprints the normalised evidence so a fabricated clock-out replays as a change', () => {
    const fabricated = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: {
        workDate: '2026-08-03',
        clockInAt: new Date('2026-08-03T05:00:00.000Z'),
        clockOutAt: new Date('2026-08-03T14:00:00.000Z'),
        clockOutSource: 'system',
      },
      isPublicHoliday: false,
    });
    const cleared = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: {
        workDate: '2026-08-03',
        clockInAt: new Date('2026-08-03T05:00:00.000Z'),
        clockOutAt: null,
        clockOutSource: 'system',
      },
      isPublicHoliday: false,
    });
    const device = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: {
        workDate: '2026-08-03',
        clockInAt: new Date('2026-08-03T05:00:00.000Z'),
        clockOutAt: new Date('2026-08-03T14:00:00.000Z'),
        clockOutSource: 'device',
      },
      isPublicHoliday: false,
    });

    // Same outcome, same fingerprint: clearing the fabricated timestamp in the
    // database must not spuriously bump result_version.
    expect(fabricated.calculationFingerprint).toBe(cleared.calculationFingerprint);
    // A real device clock-out at the same instants is a different observation
    // and must not collide with the system-sourced one.
    expect(fabricated.calculationFingerprint).not.toBe(device.calculationFingerprint);
  });

  it('ignores an invalid timestamp on a system clock-out rather than flagging it unreliable', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: {
        workDate: '2026-08-03',
        clockInAt: new Date('2026-08-03T05:00:00.000Z'),
        clockOutAt: new Date('invalid'),
        clockOutSource: 'system',
      },
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      status: 'awaiting_worker',
      exceptionKinds: ['missing_clock_out'],
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
