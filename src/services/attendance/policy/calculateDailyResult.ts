import { createHash } from 'crypto';

import type {
  CalculateDailyResultInput,
  CalculatedDailyResult,
  DayExceptionKind,
} from './types';

const MINUTE_MS = 60_000;

interface DaySchedule {
  paidHours: number;
  start: Date | null;
  end: Date | null;
  isSunday: boolean;
}

export function calculateDailyResult(input: CalculateDailyResultInput): CalculatedDailyResult {
  const approvedLeave = input.approvedLeave ?? null;
  const { evidence, isPublicHoliday, policy } = input;
  const schedule = getDaySchedule(evidence.workDate, policy);
  const base = createBaseResult(evidence.workDate, schedule.paidHours, input);

  if (hasInvalidTimestamp(evidence.clockInAt, evidence.clockOutAt)) {
    return finish(base, input, {
      status: 'awaiting_supervisor',
      exceptionKinds: ['evidence_unreliable'],
    });
  }

  // A system clock-out is an operational closure, not evidence that the worker
  // clocked out. The reconciler leaves clock_out_at NULL when it closes a
  // dangling entry, but pre-#2351 runs stamped clock-in + cap as if it were a
  // real departure. Treat both as absent so the day is flagged
  // missing_clock_out at the policy cap rather than scored — and silently
  // believed — against a manufactured time.
  const clockOutAt = evidence.clockOutSource === 'system' ? null : evidence.clockOutAt;

  if (!evidence.clockInAt && !clockOutAt) {
    if (approvedLeave) {
      return finish(base, input, {
        leaveHours: validateLeaveHours(approvedLeave.hours),
        attendanceClassification: approvedLeave.classification,
        status: 'approved',
      });
    }
    if (isPublicHoliday) {
      return finish(base, input, {
        attendanceClassification: 'public_holiday',
        status: 'approved',
      });
    }
    if (schedule.isSunday) return finish(base, input, { status: 'expected' });
    return finish(base, input, {
      status: 'absence_review',
      exceptionKinds: ['missing_clock_in'],
    });
  }

  if (!evidence.clockInAt) {
    return finish(base, input, {
      status: 'absence_review',
      exceptionKinds: ['missing_clock_in'],
    });
  }

  if (!clockOutAt) return missingClockOut(base, input, schedule);

  const elapsedMinutes = toMinutes(clockOutAt.getTime() - evidence.clockInAt.getTime());
  if (elapsedMinutes <= 0) {
    return finish(base, input, {
      status: 'awaiting_supervisor',
      exceptionKinds: ['evidence_unreliable'],
    });
  }

  if (isPublicHoliday) {
    return finish(base, input, {
      recordedElapsedHours: toHours(elapsedMinutes),
      proposedHolidayHours: toHours(elapsedMinutes),
      attendanceClassification: 'public_holiday',
      status: 'awaiting_supervisor',
      exceptionKinds: ['public_holiday_work'],
    });
  }

  if (schedule.isSunday) {
    return finish(base, input, {
      recordedElapsedHours: toHours(elapsedMinutes),
      proposedSundayHours: toHours(elapsedMinutes),
      status: 'awaiting_supervisor',
      exceptionKinds: ['sunday_work'],
    });
  }

  return completeScheduledDay(base, input, schedule, elapsedMinutes, clockOutAt);
}

function completeScheduledDay(
  base: CalculatedDailyResult,
  input: CalculateDailyResultInput,
  schedule: DaySchedule,
  elapsedMinutes: number,
  clockOutAt: Date | null,
): CalculatedDailyResult {
  const { clockInAt } = input.evidence;
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
