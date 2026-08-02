import type { AuthUser } from '@/lib/auth/types';
import type { ScopeNote } from '@/services/attendance/search/types';
import type {
  AttendanceClassification,
  DayExceptionKind,
  DailyResultStatus,
} from '@/services/attendance/policy/types';

export type { AttendanceClassification, DayExceptionKind } from '@/services/attendance/policy/types';

export const ATTENDANCE_CLASSIFICATIONS = [
  'approved_leave', 'sick_leave', 'site_shutdown_weather',
  'public_holiday', 'unauthorised_absence',
] as const satisfies readonly AttendanceClassification[];

export const DAY_EXCEPTION_KINDS = [
  'missing_clock_in', 'missing_clock_out', 'late_arrival', 'early_departure',
  'outside_schedule', 'sunday_work', 'public_holiday_work', 'evidence_unreliable',
] as const satisfies readonly DayExceptionKind[];

export const DAY_EXCEPTION_STATUSES = [
  'open', 'awaiting_worker', 'awaiting_supervisor', 'resolved', 'cancelled',
] as const;

export type DayExceptionStatus = typeof DAY_EXCEPTION_STATUSES[number];
export type DayExceptionStatusFilter = DayExceptionStatus | 'unresolved' | 'all';
export type DayExceptionDecisionAction = 'approve' | 'return' | 'classify';

export interface ApprovedHours {
  regular: number;
  overtime: number;
  sunday: number;
  holiday: number;
  leave: number;
  unpaid: number;
}

export interface SelfieAuditIdentifier {
  entryId: string;
  kind: 'in' | 'out';
}

export interface DayExceptionItem {
  id: string;
  staffId: string;
  staffName: string;
  workDate: string;
  kind: DayExceptionKind;
  status: DayExceptionStatus;
  permittedActions: DayExceptionDecisionAction[];
  resultVersion: number;
  queueOwnerUserId: string | null;
  createdAt: string;
  crewName: string | null;
  site: { id: string | null; name: string | null };
  evidence: {
    entryId: string | null;
    clockInAt: string | null;
    clockOutAt: string | null;
    clockInGpsAvailable: boolean;
    clockOutGpsAvailable: boolean;
    selfies: SelfieAuditIdentifier[];
  };
  adjustment: null | {
    id: string;
    kind: string;
    adjustedClockInAt: string | null;
    adjustedClockOutAt: string | null;
    reason: string;
    status: string;
  };
  proposedHours: Record<string, number | null>;
  dailyResult: {
    status: DailyResultStatus;
    scheduledPaidHours: number;
    recordedElapsedHours: number | null;
    proposedHours: ApprovedHours;
    approvedHours: ApprovedHours | null;
    attendanceClassification: AttendanceClassification | null;
    blockingReasons: string[];
  };
}

export interface DayExceptionListArgs {
  user: AuthUser;
  status: DayExceptionStatusFilter;
  kind?: DayExceptionKind;
  limit: number;
}

export interface DayExceptionListResult {
  items: DayExceptionItem[];
  limit: number;
  status: DayExceptionStatusFilter;
  scope: ScopeNote;
}

export interface DayExceptionDecisionInput {
  exceptionId: string;
  expectedResultVersion: number;
  action: DayExceptionDecisionAction;
  classification?: AttendanceClassification;
  approvedHours?: ApprovedHours;
  reason: string;
  actor: AuthUser;
}

export interface DayExceptionDecisionResult {
  exception: {
    id: string;
    status: DayExceptionStatus;
    resultVersion: number;
    classification: AttendanceClassification | null;
    resolutionReason: string | null;
  };
  dailyResult: {
    staffId: string;
    workDate: string;
    status: DailyResultStatus;
    resultVersion: number;
    approvedHours: ApprovedHours | null;
    attendanceClassification: AttendanceClassification | null;
  };
  decisionEventId: string;
}
