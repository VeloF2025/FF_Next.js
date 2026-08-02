import type {
  ApprovedHours, AttendanceClassification, DayExceptionItem,
  DayExceptionKind, DayExceptionStatus,
} from './types';
import type { DailyResultStatus } from '@/services/attendance/policy/types';
import { permittedDecisionActions } from './dayExceptionDecisionValidation';

export interface DayExceptionRow extends Record<string, unknown> {
  exception_id: string;
  staff_id: string;
  staff_name: string;
  crew_name: string | null;
  work_date: string;
  entry_id: string | null;
  kind: DayExceptionKind;
  status: DayExceptionStatus;
  owner_user_id: string | null;
  proposed_hours: Record<string, unknown>;
  exception_classification: AttendanceClassification | null;
  result_version: string | number;
  created_at: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  clock_in_gps_available: boolean;
  clock_out_gps_available: boolean;
  selfie_in_available: boolean;
  selfie_out_available: boolean;
  site_id: string | null;
  site_name: string | null;
  adjustment_id: string | null;
  adjustment_kind: string | null;
  adjusted_clock_in_at: string | null;
  adjusted_clock_out_at: string | null;
  adjustment_reason: string | null;
  adjustment_status: string | null;
  result_status: DailyResultStatus;
  scheduled_paid_hrs: string | number;
  recorded_elapsed_hrs: string | number | null;
  proposed_regular_hrs: string | number | null;
  proposed_overtime_hrs: string | number | null;
  proposed_sunday_hrs: string | number | null;
  proposed_holiday_hrs: string | number | null;
  approved_regular_hrs: string | number | null;
  approved_overtime_hrs: string | number | null;
  approved_sunday_hrs: string | number | null;
  approved_holiday_hrs: string | number | null;
  leave_hrs: string | number;
  unpaid_hrs: string | number;
  attendance_classification: AttendanceClassification | null;
  blocking_reasons: unknown;
}

function number(value: unknown, field: string, nullable = false): number | null {
  if (value == null && nullable) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid attendance ${field}`);
  return parsed;
}

function hours(row: DayExceptionRow, approved: boolean): ApprovedHours {
  const prefix = approved ? 'approved' : 'proposed';
  return {
    regular: number(row[`${prefix}_regular_hrs`], `${prefix} regular hours`) ?? 0,
    overtime: number(row[`${prefix}_overtime_hrs`], `${prefix} overtime hours`) ?? 0,
    sunday: number(row[`${prefix}_sunday_hrs`], `${prefix} Sunday hours`) ?? 0,
    holiday: number(row[`${prefix}_holiday_hrs`], `${prefix} holiday hours`) ?? 0,
    leave: number(row.leave_hrs, 'leave hours') ?? 0,
    unpaid: number(row.unpaid_hrs, 'unpaid hours') ?? 0,
  };
}

export function mapDayException(row: DayExceptionRow): DayExceptionItem {
  const selfies = [];
  if (row.entry_id && row.selfie_in_available) selfies.push({ entryId: row.entry_id, kind: 'in' as const });
  if (row.entry_id && row.selfie_out_available) selfies.push({ entryId: row.entry_id, kind: 'out' as const });
  const approved = row.approved_regular_hrs == null && row.approved_overtime_hrs == null &&
    row.approved_sunday_hrs == null && row.approved_holiday_hrs == null ? null : hours(row, true);
  const proposedHours = Object.fromEntries(Object.entries(row.proposed_hours ?? {}).map(([key, value]) => [
    key, value == null ? null : number(value, `proposedHours.${key}`),
  ]));
  return {
    id: row.exception_id, staffId: row.staff_id, staffName: row.staff_name,
    workDate: row.work_date, kind: row.kind, status: row.status,
    permittedActions: permittedDecisionActions({
      kind: row.kind, status: row.status,
      adjustmentId: row.adjustment_id, adjustmentStatus: row.adjustment_status,
    }),
    resultVersion: number(row.result_version, 'result version')!,
    queueOwnerUserId: row.owner_user_id, createdAt: row.created_at,
    crewName: row.crew_name, site: { id: row.site_id, name: row.site_name },
    evidence: {
      entryId: row.entry_id, clockInAt: row.clock_in_at, clockOutAt: row.clock_out_at,
      clockInGpsAvailable: row.clock_in_gps_available,
      clockOutGpsAvailable: row.clock_out_gps_available, selfies,
    },
    adjustment: row.adjustment_id ? {
      id: row.adjustment_id, kind: row.adjustment_kind ?? 'unknown',
      adjustedClockInAt: row.adjusted_clock_in_at, adjustedClockOutAt: row.adjusted_clock_out_at,
      reason: row.adjustment_reason ?? '', status: row.adjustment_status ?? 'unknown',
    } : null,
    proposedHours,
    dailyResult: {
      status: row.result_status, scheduledPaidHours: number(row.scheduled_paid_hrs, 'scheduled hours')!,
      recordedElapsedHours: number(row.recorded_elapsed_hrs, 'recorded hours', true),
      proposedHours: hours(row, false), approvedHours: approved,
      attendanceClassification: row.attendance_classification,
      blockingReasons: Array.isArray(row.blocking_reasons)
        ? row.blocking_reasons.filter((item): item is string => typeof item === 'string') : [],
    },
  };
}
