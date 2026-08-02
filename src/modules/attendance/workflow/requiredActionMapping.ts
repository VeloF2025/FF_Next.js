import type { RequiredAttendanceAction } from './requiredActionQueries';

export interface RequiredActionRow extends Record<string, unknown> {
  exception_id: string;
  entry_id: string;
  work_date: string;
  kind: 'missing_clock_out';
  proposed_regular_hours: string | null;
  proposed_overtime_hours: string | null;
  proposed_sunday_hours: string | null;
  proposed_holiday_hours: string | null;
  clock_in_at: string;
}

export function toRequiredAction(row: RequiredActionRow): RequiredAttendanceAction {
  const raw = [
    row.proposed_regular_hours,
    row.proposed_overtime_hours,
    row.proposed_sunday_hours,
    row.proposed_holiday_hours,
  ];
  const values = raw.map((value) => value == null ? 0 : Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Attendance exception ${row.exception_id} has invalid provisional hours`);
  }
  return {
    exceptionId: row.exception_id,
    entryId: row.entry_id,
    workDate: row.work_date,
    kind: 'missing_clock_out',
    provisionalPaidHours: values.reduce((total, value) => total + value, 0),
    clockInAt: new Date(row.clock_in_at).toISOString(),
  };
}
