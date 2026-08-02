import type { DailyResultStatus } from '@/services/attendance/policy/types';

import { ApiError, getHubSummary } from './api';
import type { HubSummaryResponse } from './api';

export type { DailyResultStatus };

export interface RequiredAttendanceAction {
  exceptionId: string;
  entryId: string;
  workDate: string;
  kind: 'missing_clock_out';
  provisionalPaidHours: number;
  clockInAt: string;
}

export interface CurrentAttendanceResponse {
  workDate: string;
  open: {
    entryId: string;
    workDate: string;
    clockInAt: string;
    siteGeofenceId: string | null;
    vehicleAssignmentId: string | null;
    selfieInUrl: string | null;
  } | null;
  schedule: {
    policyId: string;
    timezone: string;
    start: string | null;
    end: string | null;
    unpaidBreakMinutes: number;
    scheduledPaidHours: number;
  };
  result: {
    status: DailyResultStatus;
    recordedElapsedHours: number | null;
    scheduledPaidHours: number;
  };
  requiredAttendanceAction: RequiredAttendanceAction | null;
}

export interface CorrectionTarget {
  exceptionId: string;
  entryId: string;
}

export type AttendanceHubSummaryResponse = HubSummaryResponse & {
  requiredAttendanceAction: RequiredAttendanceAction | null;
};

const DAILY_RESULT_STATUSES: readonly DailyResultStatus[] = [
  'expected',
  'open',
  'complete',
  'provisional',
  'awaiting_worker',
  'awaiting_supervisor',
  'approved',
  'locked',
  'absence_review',
];

export function isDailyResultStatus(value: unknown): value is DailyResultStatus {
  return typeof value === 'string' && DAILY_RESULT_STATUSES.includes(value as DailyResultStatus);
}

export async function getAttendanceHubSummary(): Promise<AttendanceHubSummaryResponse> {
  return getHubSummary() as Promise<AttendanceHubSummaryResponse>;
}

export async function getCurrentAttendance(): Promise<CurrentAttendanceResponse> {
  const value = await attendanceRequest<unknown>('/api/my/attendance/current', { method: 'GET' });
  if (!isCurrentAttendanceResponse(value)) {
    throw new ApiError(500, 'INVALID_ATTENDANCE_STATE', 'Attendance status unavailable.');
  }
  return value;
}

export async function getCorrectionTarget(exceptionId: string): Promise<CorrectionTarget> {
  const value = await attendanceRequest<{ correctionTarget: CorrectionTarget }>(
    `/api/my/attendance-corrections?exception_id=${encodeURIComponent(exceptionId)}`,
    { method: 'GET' },
  );
  const target = value.correctionTarget;
  if (!target || target.exceptionId !== exceptionId || typeof target.entryId !== 'string' || !target.entryId) {
    throw new ApiError(500, 'INVALID_CORRECTION_TARGET', 'Attendance correction target unavailable.');
  }
  return target;
}

export function submitRequiredAttendanceCorrection(args: {
  entryId: string;
  exceptionId: string;
  adjustedClockOutAt: string;
  reason: string;
}): Promise<{
  adjustmentId: string;
  exceptionId: string;
  decisionEventId: string;
  exceptionStatus: 'awaiting_supervisor';
}> {
  return attendanceRequest('/api/my/attendance-corrections', {
    method: 'POST',
    body: JSON.stringify({
      entry_id: args.entryId,
      exception_id: args.exceptionId,
      adjustment_kind: 'forgot_clock_out',
      adjusted_clock_in_at: null,
      adjusted_clock_out_at: args.adjustedClockOutAt,
      adjusted_site_geofence_id: null,
      reason: args.reason,
    }),
  });
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

async function attendanceRequest<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch (error) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new ApiError(response.status, 'PARSE_ERROR', `Server returned non-JSON (HTTP ${response.status})`);
  }
  if (!response.ok || !envelope.success || envelope.data === undefined) {
    const error = envelope.error ?? { code: 'UNKNOWN', message: `HTTP ${response.status}` };
    throw new ApiError(response.status, error.code, error.message, error.details);
  }
  return envelope.data;
}

export function isCurrentAttendanceResponse(value: unknown): value is CurrentAttendanceResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.workDate !== 'string') return false;
  if (!isOpenEntry(record.open) || !isRequiredAction(record.requiredAttendanceAction)) return false;
  if (!record.schedule || typeof record.schedule !== 'object') return false;
  if (!record.result || typeof record.result !== 'object') return false;
  const schedule = record.schedule as Record<string, unknown>;
  const result = record.result as Record<string, unknown>;
  return typeof schedule.policyId === 'string'
    && typeof schedule.timezone === 'string'
    && isNullableString(schedule.start)
    && isNullableString(schedule.end)
    && isFiniteNumber(schedule.unpaidBreakMinutes)
    && isFiniteNumber(schedule.scheduledPaidHours)
    && isDailyResultStatus(result.status)
    && (result.recordedElapsedHours === null || isFiniteNumber(result.recordedElapsedHours))
    && isFiniteNumber(result.scheduledPaidHours);
}

function isOpenEntry(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.entryId === 'string'
    && typeof entry.workDate === 'string'
    && typeof entry.clockInAt === 'string';
}

function isRequiredAction(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  return typeof action.exceptionId === 'string'
    && typeof action.entryId === 'string'
    && typeof action.workDate === 'string'
    && action.kind === 'missing_clock_out'
    && isFiniteNumber(action.provisionalPaidHours)
    && typeof action.clockInAt === 'string';
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
