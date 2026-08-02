/** Locked, deterministic, hours-only attendance payroll export. */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import {
  withAuth, withPermission, type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { preparePayrollExport } from '@/services/attendance/payroll/exportService';
import {
  AttendancePayrollExportError, PAYROLL_EXPORT_COLUMNS,
  type PayrollExportFormat,
} from '@/services/attendance/payroll/types';

export const EXPORT_COLUMNS = PAYROLL_EXPORT_COLUMNS;

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
    return;
  }
  const weekStart = stringQuery(req.query.week_start);
  const format = stringQuery(req.query.format) || 'csv';
  const lockVersion = Number(stringQuery(req.query.lock_version));
  if (!isMondayYmd(weekStart)) {
    apiResponse.badRequest(res, 'week_start must be a Monday YYYY-MM-DD');
    return;
  }
  if (format !== 'csv' && format !== 'xlsx') {
    apiResponse.badRequest(res, "format must be 'csv' or 'xlsx'");
    return;
  }
  if (!Number.isInteger(lockVersion) || lockVersion < 1) {
    apiResponse.badRequest(res, 'lock_version must be a positive integer');
    return;
  }
  const authed = req as AuthenticatedNextApiRequest;
  if (!authed.user?.id) {
    apiResponse.unauthorized(res);
    return;
  }
  if (authed.user.role !== 'admin' && authed.user.role !== 'super_admin') {
    apiResponse.forbidden(res, 'Payroll export authority is restricted to HR administrators');
    return;
  }
  const dryRun = ['true', '1', 'yes'].includes(stringQuery(req.query.dry_run).toLowerCase());
  try {
    const result = await preparePayrollExport({
      weekStartDate: weekStart, format: format as PayrollExportFormat,
      actorUserId: authed.user.id, expectedLockVersion: lockVersion, dryRun,
    });
    if (result.dryRun) {
      apiResponse.success(res, result);
      return;
    }
    res.setHeader('Content-Type', contentType(result.format));
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Attendance-Export-Id', result.exportId);
    res.setHeader('X-Attendance-Export-Sha256', result.sha256);
    res.status(200).send(result.bytes);
  } catch (error) {
    if (error instanceof AttendancePayrollExportError) {
      if (error.code === 'forbidden') {
        apiResponse.forbidden(res, error.message);
        return;
      }
      if (['period_locked', 'export_version_conflict', 'empty_period',
        'invalid_locked_results', 'invalid_staff_identity'].includes(error.code)) {
        apiResponse.conflict(res, error.message, { reason: error.code });
        return;
      }
      if (error.code === 'invalid_week' || error.code === 'invalid_format') {
        apiResponse.badRequest(res, error.message);
        return;
      }
    }
    log.error('[staff-attendance-export] locked export failed', {
      weekStart, format, error: error instanceof Error ? error.message : String(error),
    });
    apiResponse.internalError(res, error);
  }
}

function stringQuery(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function isMondayYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1;
}

function contentType(format: PayrollExportFormat): string {
  return format === 'csv' ? 'text/csv; charset=utf-8'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

export default withAuth(withPermission('people.staff.attendance.manage', 'view')(handler));
