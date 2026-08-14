import { createHash } from 'crypto';

import type {
  CalculateDailyResultInput,
  CalculatedDailyResult,
  DayExceptionKind,
} from './types';

const MINUTE_MS = 60_000;

/**
 * Longest span a single work date can represent. A clock-in and clock-out more
 * than 24h apart is not a long shift — it is a worker who forgot to clock out
 * and clocked out the following day, which is the same class of defect as a
 * negative span.
 *
 * This bound is also what keeps every projected column inside its CHECK
 * constraint, so it must not be raised without revisiting them:
 *
 *   recorded_elapsed_hrs  <= 24   — set directly from the span
 *   proposed_sunday_hrs   <= 24   — set directly from the span
 *   proposed_holiday_hrs  <= 24   — set directly from the span
 *   proposed_overtime_hrs <= 15   — early + late, which is bounded by the span
 *
 * The overtime bound follows from the other three. With a weekday schedule of
 * start..end, overtime is max(0, start - in) + max(0, out - end); when both
 * terms are positive that sums to (out - in) - (end - start), so a span of at
 * most 24h over a 9h schedule can never exceed 15h of overtime. A 25h span can
 * (and did — see #2479), which is why the guard belongs here on the span
 * rather than as a clamp on each column.
 */
const MAX_ELAPSED_MINUTES = 24 * 60;

interface DaySchedule {
  paidHours: number;
  start: Date | null;
  end: Date | null;
  isSunday: boolean;
}

export function calculateDailyResult(input: CalculateDailyResultInput): CalculatedDailyResult {
  const approvedLeave = input.approvedLeave ?? null;
  const { isPublicHoliday, policy } = input;
  // Normalise before ANYTHING reads the evidence — including the fingerprint.
  // The fingerprint hashes the evidence it was given, and upsertDailyProjection
  // only rewrites a projection when the fingerprint changes. Normalising after
  // the hash would leave a replay of an already-projected legacy day matching
  // its stored fingerprint, so it would refresh computed_at and never correct
  // result_status, blocking_reasons or the proposed hours.
  const evidence = effectiveEvidence(input.evidence);
  const effective: CalculateDailyResultInput = { ...input, evidence };
  const schedule = getDaySchedule(evidence.workDate, policy);
  const base = createBaseResult(evidence.workDate, schedule.paidHours, effective);

  if (hasInvalidTimestamp(evidence.clockInAt, evidence.clockOutAt)) {
    return finish(base, effective, {
      status: 'awaiting_supervisor',
      exceptionKinds: ['evidence_unreliable'],
    });
  }

  if (!evidence.clockInAt && !evidence.clockOutAt) {
    if (approvedLeave) {
      return finish(base, effective, {
        leaveHours: validateLeaveHours(approvedLeave.hours),
        attendanceClassification: approvedLeave.classification,
        status: 'approved',
      });
    }
    if (isPublicHoliday) {
      return finish(base, effective, {
        attendanceClassification: 'public_holiday',
        status: 'approved',
      });
    }
    if (schedule.isSunday) return finish(base, effective, { status: 'expected' });
    return finish(base, effective, {
      status: 'absence_review',
      exceptionKinds: ['missing_clock_in'],
    });
  }

  if (!evidence.clockInAt) {
    return finish(base, effective, {
      status: 'absence_review',
      exceptionKinds: ['missing_clock_in'],
    });
  }

  if (!evidence.clockOutAt) return missingClockOut(base, effective, schedule);

  const elapsedMinutes = toMinutes(evidence.clockOutAt.getTime() - evidence.clockInAt.getTime());
  // Both directions are unreliable evidence, so both park the day for a
  // supervisor without proposing hours. Projecting nothing is deliberate: the
  // raw timestamps stay on the entry for the supervisor to read, and inventing
  // a clamped figure here would put a number nobody measured in front of them.
  // The alternative — letting the projection throw — is what dropped these days
  // out of payroll entirely (#2479).
  if (elapsedMinutes <= 0 || elapsedMinutes > MAX_ELAPSED_MINUTES) {
    return finish(base, effective, {
      status: 'awaiting_supervisor',
      exceptionKinds: ['evidence_unreliable'],
    });
  }

  if (isPublicHoliday) {
    return finish(base, effective, {
      recordedElapsedHours: toHours(elapsedMinutes),
      proposedHolidayHours: toHours(elapsedMinutes),
      attendanceClassification: 'public_holiday',
      status: 'awaiting_supervisor',
      exceptionKinds: ['public_holiday_work'],
    });
  }

  if (schedule.isSunday) {
    return finish(base, effective, {
      recordedElapsedHours: toHours(elapsedMinutes),
      proposedSundayHours: toHours(elapsedMinutes),
      status: 'awaiting_supervisor',
      exceptionKinds: ['sunday_work'],
    });
  }

  return completeScheduledDay(base, effective, schedule, elapsedMinutes);
}

/**
 * A system clock-out is an operational closure, not evidence that the worker
 * clocked out. The reconciler leaves clock_out_at NULL when it closes a
 * dangling entry, but pre-#2351 runs stamped clock-in + a 9h cap as if it were
 * a real departure. Treating that as evidence turns a missing clock-out into a
 * believable early_departure a supervisor would approve.
 *
 * Returns the original object when nothing needs normalising, so the common
 * path hashes byte-identically to before.
 */
function effectiveEvidence(
  evidence: CalculateDailyResultInput['evidence'],
): CalculateDailyResultInput['evidence'] {
  if (evidence.clockOutSource !== 'system' || evidence.clockOutAt === null) return evidence;
  return { ...evidence, clockOutAt: null };
}

function completeScheduledDay(
  base: CalculatedDailyResult,
  input: CalculateDailyResultInput,
  schedule: DaySchedule,
  elapsedMinutes: number,
): CalculatedDailyResult {
  const { clockInAt, clockOutAt } = input.evidence;
  if (!clockInAt || !clockOutAt || !schedule.start || !schedule.end) {
    throw new Error('Scheduled calculation requires complete clock evidence and a schedule');
  }
  const exceptions: DayExceptionKind[] = [];
  const overtimeMinutes = Math.max(0, toMinutes(schedule.start.getTime() - clockInAt.getTime())) +
    Math.max(0, toMinutes(clockOutAt.getTime() - schedule.end.getTime()));
  const late = clockInAt.getTime() > schedule.start.getTime();
  const early = clockOutAt.getTime() < schedule.end.getTime();

  if (late) exceptions.push('late_arrival');
  if (early) exceptions.push('early_departure');
  if (overtimeMinutes > 0) exceptions.push('outside_schedule');

  return finish(base, input, {
    recordedElapsedHours: toHours(elapsedMinutes),
    proposedRegularHours: late || early ? null : schedule.paidHours,
    proposedOvertimeHours: toHours(overtimeMinutes),
    status: exceptions.length === 0 ? 'approved' : 'awaiting_supervisor',
    exceptionKinds: exceptions,
  });
}

function missingClockOut(
  base: CalculatedDailyResult,
  input: CalculateDailyResultInput,
  schedule: DaySchedule,
): CalculatedDailyResult {
  if (input.isPublicHoliday) {
    return finish(base, input, {
      proposedHolidayHours: schedule.isSunday ? input.policy.sundayMissingOutCapHours : schedule.paidHours,
      attendanceClassification: 'public_holiday',
      status: 'awaiting_worker',
      exceptionKinds: ['missing_clock_out', 'public_holiday_work'],
    });
  }
  if (schedule.isSunday) {
    return finish(base, input, {
      proposedSundayHours: input.policy.sundayMissingOutCapHours,
      status: 'awaiting_worker',
      exceptionKinds: ['missing_clock_out', 'sunday_work'],
    });
  }
  return finish(base, input, {
    proposedRegularHours: schedule.paidHours,
    status: 'awaiting_worker',
    exceptionKinds: ['missing_clock_out'],
  });
}

function createBaseResult(
  workDate: string,
  scheduledPaidHours: number,
  input: CalculateDailyResultInput,
): CalculatedDailyResult {
  return {
    workDate,
    scheduledPaidHours,
    recordedElapsedHours: null,
    proposedRegularHours: null,
    proposedOvertimeHours: 0,
    proposedSundayHours: 0,
    proposedHolidayHours: 0,
    leaveHours: 0,
    unpaidHours: 0,
    attendanceClassification: null,
    status: 'expected',
    exceptionKinds: [],
    calculationFingerprint: fingerprint(input),
  };
}

function finish(
  base: CalculatedDailyResult,
  input: CalculateDailyResultInput,
  changes: Partial<Omit<CalculatedDailyResult, 'workDate' | 'scheduledPaidHours' | 'calculationFingerprint'>>,
): CalculatedDailyResult {
  return { ...base, ...changes, calculationFingerprint: fingerprint(input) };
}

function getDaySchedule(workDate: string, policy: CalculateDailyResultInput['policy']): DaySchedule {
  const weekday = weekdayFor(workDate);
  if (weekday === 0) return { paidHours: 0, start: null, end: null, isSunday: true };
  const saturday = weekday === 6;
  const start = scheduleInstant(workDate, saturday ? policy.saturdayStart : policy.weekdayStart);
  const end = scheduleInstant(workDate, saturday ? policy.saturdayEnd : policy.weekdayEnd);
  return { paidHours: saturday ? policy.saturdayPaidCapHours : policy.weekdayPaidCapHours, start, end, isSunday: false };
}

function weekdayFor(workDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(workDate);
  if (!match) throw new Error(`workDate must be YYYY-MM-DD; got ${workDate}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== workDate) throw new Error(`workDate is not a calendar date: ${workDate}`);
  return date.getUTCDay();
}

function scheduleInstant(workDate: string, time: string): Date {
  return new Date(`${workDate}T${time}:00+02:00`);
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function hasInvalidTimestamp(clockInAt: Date | null, clockOutAt: Date | null): boolean {
  return (clockInAt !== null && !isValidDate(clockInAt)) ||
    (clockOutAt !== null && !isValidDate(clockOutAt));
}

function toMinutes(milliseconds: number): number {
  return Math.round(milliseconds / MINUTE_MS);
}

function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function validateLeaveHours(hours: number): number {
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
    throw new Error(`approvedLeave.hours must be a finite number from 0 to 24; got ${String(hours)}`);
  }
  return hours;
}

function fingerprint(input: CalculateDailyResultInput): string {
  const { policy, evidence } = input;
  const serialised = JSON.stringify({
    policy: {
      id: policy.id,
      timezone: policy.timezone,
      weekdayStart: policy.weekdayStart,
      weekdayEnd: policy.weekdayEnd,
      weekdayUnpaidBreakMinutes: policy.weekdayUnpaidBreakMinutes,
      weekdayPaidCapHours: policy.weekdayPaidCapHours,
      saturdayStart: policy.saturdayStart,
      saturdayEnd: policy.saturdayEnd,
      saturdayPaidCapHours: policy.saturdayPaidCapHours,
      sundayScheduled: policy.sundayScheduled,
      sundayMissingOutCapHours: policy.sundayMissingOutCapHours,
      lateAlertMinutes: policy.lateAlertMinutes,
    },
    evidence: {
      workDate: evidence.workDate,
      clockInAt: fingerprintDate(evidence.clockInAt),
      clockOutAt: fingerprintDate(evidence.clockOutAt),
      clockOutSource: evidence.clockOutSource,
    },
    isPublicHoliday: input.isPublicHoliday,
    approvedLeave: input.approvedLeave
      ? { classification: input.approvedLeave.classification, hours: input.approvedLeave.hours }
      : null,
  });
  return createHash('sha256').update(serialised).digest('hex');
}

function fingerprintDate(value: Date | null): string | null {
  if (!value) return null;
  return isValidDate(value) ? value.toISOString() : 'invalid';
}
