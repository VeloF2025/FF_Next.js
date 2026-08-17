import type { OperationalRule, OperationalSchedule, OperationalTimePhase, OperationalWindow } from './types';
import { parseStrictIsoInstant } from './instantValidation';

const SUPPORTED_TIMEZONE = 'Africa/Johannesburg';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

function nonnegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function parseDate(value: string): [number, number, number] {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error('Attendance work date is malformed');
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw new Error('Attendance work date is malformed');
  }
  return [year, month, day];
}

function parseTime(value: string): [number, number, number] {
  const match = TIME.exec(value);
  if (!match) throw new Error('Attendance schedule time is malformed');
  const hour = Number(match[1]); const minute = Number(match[2]); const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) throw new Error('Attendance schedule time is malformed');
  return [hour, minute, second];
}

function sastInstant(date: [number, number, number], time: [number, number, number]): Date {
  const [year, month, day] = date; const [hour, minute, second] = time;
  return new Date(Date.UTC(year, month - 1, day, hour - 2, minute, second));
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function validate(schedule: OperationalSchedule | null, rule: OperationalRule): OperationalSchedule {
  if (!schedule) throw new Error('Attendance schedule policy is required');
  if (schedule.timezone !== SUPPORTED_TIMEZONE || rule.timezone !== SUPPORTED_TIMEZONE) {
    throw new Error(`Unsupported operational timezone; expected ${SUPPORTED_TIMEZONE}`);
  }
  nonnegativeInteger(schedule.graceMinutes, 'Attendance grace minutes');
  nonnegativeInteger(rule.monitoringBeforeMinutes, 'Monitoring before minutes');
  nonnegativeInteger(rule.monitoringAfterMinutes, 'Monitoring after minutes');
  return schedule;
}

export function operationalWindow(schedule: OperationalSchedule | null, rule: OperationalRule): OperationalWindow {
  const resolved = validate(schedule, rule);
  const date = parseDate(resolved.workDate);
  const scheduledStart = sastInstant(date, parseTime(resolved.startTime));
  const scheduledEnd = sastInstant(date, parseTime(resolved.endTime));
  if (scheduledEnd.getTime() <= scheduledStart.getTime()) throw new Error('Attendance schedule end must be after start');
  return {
    monitoringStart: addMinutes(scheduledStart, -rule.monitoringBeforeMinutes).toISOString(),
    scheduledStart: scheduledStart.toISOString(),
    graceEnd: addMinutes(scheduledStart, resolved.graceMinutes).toISOString(),
    scheduledEnd: scheduledEnd.toISOString(),
    monitoringEnd: addMinutes(scheduledEnd, rule.monitoringAfterMinutes).toISOString(),
  };
}

export function timePhase(asOf: string, schedule: OperationalSchedule | null, rule: OperationalRule): OperationalTimePhase {
  const instant = parseStrictIsoInstant(asOf);
  if (instant === null) throw new Error('Evaluation instant is malformed');
  const resolved = validate(schedule, rule);
  if (!resolved.scheduled && !resolved.explicitWork) return 'off_duty';
  const window = operationalWindow(resolved, rule);
  if (instant < Date.parse(window.monitoringStart) || instant > Date.parse(window.monitoringEnd)) return 'off_duty';
  if (instant < Date.parse(window.scheduledStart)) return 'before_start';
  if (instant <= Date.parse(window.graceEnd)) return 'grace';
  if (instant < Date.parse(window.scheduledEnd)) return 'active_shift';
  return 'after_shift';
}
