import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth, withPermission, type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import {
  DayExceptionWorkflowError, decideDayException,
} from '@/modules/attendance/workflow/dayExceptionQueries';
import {
  ATTENDANCE_CLASSIFICATIONS, type ApprovedHours, type AttendanceClassification,
} from '@/modules/attendance/workflow/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['approve', 'return', 'classify']);
const CLASSIFICATIONS = new Set<string>(ATTENDANCE_CLASSIFICATIONS);
const HOUR_KEYS = ['regular', 'overtime', 'sunday', 'holiday', 'leave', 'unpaid'] as const;

function approvedHours(value: unknown): ApprovedHours | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!HOUR_KEYS.every((key) => typeof record[key] === 'number' && Number.isFinite(record[key]))) return undefined;
  return Object.fromEntries(HOUR_KEYS.map((key) => [key, record[key]])) as unknown as ApprovedHours;
}

function workflowCode(error: unknown): string | null {
  if (error instanceof DayExceptionWorkflowError) return error.code;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return null;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const exceptionId = typeof body.exception_id === 'string' ? body.exception_id.trim() : '';
  const expectedResultVersion = body.expected_result_version;
  const action = typeof body.action === 'string' ? body.action : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const classification = typeof body.classification === 'string' ? body.classification : undefined;
  const hours = approvedHours(body.approved_hours);

  if (!UUID.test(exceptionId)) return apiResponse.badRequest(res, 'exception_id must be a UUID');
  if (!Number.isInteger(expectedResultVersion) || Number(expectedResultVersion) < 1) {
    return apiResponse.badRequest(res, 'expected_result_version must be a positive integer');
  }
  if (!ACTIONS.has(action)) return apiResponse.badRequest(res, "action must be 'approve', 'return' or 'classify'");
  if (!reason || reason.length > 1000) return apiResponse.badRequest(res, 'reason is required and must be at most 1000 characters');
  if (body.approved_hours != null && !hours) return apiResponse.badRequest(res, 'approved_hours must contain six finite numbers');
  if (action === 'approve' && !hours) return apiResponse.badRequest(res, 'approved_hours is required for approve');
  if (action === 'classify' && (!classification || !CLASSIFICATIONS.has(classification))) {
    return apiResponse.badRequest(res, 'classification must be one of the five attendance classifications');
  }
  if (action !== 'classify' && classification !== undefined) {
    return apiResponse.badRequest(res, 'classification is only valid for classify');
  }

  const user = (req as AuthenticatedNextApiRequest).user;
  try {
    const result = await decideDayException({
      exceptionId, expectedResultVersion: Number(expectedResultVersion),
      action: action as 'approve' | 'return' | 'classify',
      approvedHours: hours, classification: classification as AttendanceClassification | undefined,
      reason, actor: user,
    });
    apiResponse.success(res, result);
  } catch (error) {
    const code = workflowCode(error);
    if (code === 'not_found') return apiResponse.notFound(res, 'AttendanceException', exceptionId);
    if (code === 'forbidden') return apiResponse.forbidden(res, 'Attendance decision permission denied');
    if (code === 'period_locked' || code === 'result_stale' || code === 'already_decided') {
      return apiResponse.conflict(res, error instanceof Error ? error.message : 'Attendance decision conflict', { reason: code });
    }
    if (code?.startsWith('invalid_')) {
      return apiResponse.badRequest(res, error instanceof Error ? error.message : 'Invalid attendance decision', { reason: code });
    }
    log.error('[staff-attendance-day-exceptions-review] decision failed', {
      exceptionId, action, userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    apiResponse.internalError(res, error);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.corrections', 'edit')(handler)
);
