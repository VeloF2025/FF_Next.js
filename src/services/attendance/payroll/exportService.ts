import { transaction } from '@/lib/db-pool';
import { acquireAttendanceWeekLock } from '@/modules/attendance/corrections/lockQueries';

import {
  claimExport, markFailed, markReady, readActiveLock, readActorRole, readExistingExport,
  readExport, readLatestHistory, readLockedDays, writeReadyEvent,
  type PayrollExportRecord,
} from './query';
import { mapLockedPayrollRows, payrollTotals, serializePayrollExport } from './serialize';
import { readPayrollSnapshot, validateActivePayrollLock, validateLockedRows } from './snapshot';
import { payrollExportStorage } from './storage';
import {
  AttendancePayrollExportError, type PayrollExportPreview, type PayrollExportStorage,
  type PayrollTransactionRunner, type PreparePayrollExportArgs, type PreparedPayrollExport,
} from './types';

type Result = PayrollExportPreview | PreparedPayrollExport;
interface Dependencies { transaction: PayrollTransactionRunner; storage: PayrollExportStorage }
interface Failure { failure: AttendancePayrollExportError }

export function createPayrollExportService(deps: Dependencies) {
  return async function preparePayrollExport(args: PreparePayrollExportArgs): Promise<Result> {
    const weekEnd = validateArgs(args);
    let uploadedFilename: string | null = null;
    try {
      const result = await deps.transaction<Result | Failure>(async (tx) => {
        await acquireAttendanceWeekLock(tx, args.weekStartDate);
        const role = await readActorRole(tx, args.actorUserId);
        if (role !== 'admin' && role !== 'super_admin') fail('forbidden', 'Payroll export authority is restricted to HR administrators');
        const active = await readActiveLock(tx, args.weekStartDate);
        if (!active) fail('period_locked', `Attendance period ${args.weekStartDate} must be locked before export`);
        const history = await readLatestHistory(tx, args.weekStartDate);
        const lockVersion = validateActivePayrollLock(active, history, args.expectedLockVersion);
        const lockedDays = await readLockedDays(tx, args.weekStartDate, weekEnd);
        const frozenDays = readPayrollSnapshot(history!.result_snapshot, lockVersion);
        validateLockedRows(frozenDays, lockedDays, lockVersion);
        const rows = mapLockedPayrollRows(frozenDays, lockVersion);
        const totals = payrollTotals(rows);
        if (args.dryRun === true) {
          return { dryRun: true, format: args.format, lockVersion, rowCount: rows.length, rows, totals };
        }
        const artifact = serializePayrollExport({ format: args.format, rows, lockedAt: history!.recorded_at });
        const filename = `attendance-week-${args.weekStartDate}-v${lockVersion}.${args.format}`;
        const existing = await readExistingExport(tx, args.weekStartDate, lockVersion, args.format);
        if (existing?.status === 'ready') {
          validateReadyRecord(existing, rows.length, totals, artifact.sha256);
          return prepared(existing, args.format, lockVersion, rows, totals, artifact.bytes, filename);
        }
        const claimed = await claimExport(tx, args.weekStartDate, lockVersion, args.format, args.actorUserId);
        if (!claimed?.id) fail('persistence_failed', 'Payroll export identity claim returned no row');
        let uploaded: { path: string; filename: string };
        try {
          uploaded = await deps.storage.upload(artifact.bytes, filename);
          uploadedFilename = uploaded.filename;
        } catch (error) {
          const message = errorMessage(error);
          const failed = await markFailed(tx, claimed.id, message);
          if (!failed || failed.status !== 'failed') fail('persistence_failed', 'Payroll export failure state did not persist');
          return { failure: new AttendancePayrollExportError('storage_failed', message) };
        }
        if (!uploaded.path || !uploaded.filename) fail('persistence_failed', 'Payroll storage returned incomplete metadata');
        const ready = await markReady(tx, claimed.id, rows.length, totals, artifact.sha256, uploaded.path);
        if (!ready) fail('persistence_failed', 'Payroll export ready metadata did not persist');
        await writeReadyEvent(tx, claimed.id, args.actorUserId, lockVersion, artifact.sha256);
        const readback = await readExport(tx, claimed.id);
        validateReadyRecord(readback, rows.length, totals, artifact.sha256);
        return prepared(readback!, args.format, lockVersion, rows, totals, artifact.bytes, filename);
      });
      if ('failure' in result) throw result.failure;
      return result;
    } catch (error) {
      if (uploadedFilename) {
        let removed = false;
        try { removed = await deps.storage.remove(uploadedFilename); } catch { removed = false; }
        if (!removed) {
          throw new AttendancePayrollExportError('cleanup_failed',
            `Failed to remove orphan payroll export ${uploadedFilename}; original error: ${errorMessage(error)}`);
        }
      }
      if (error instanceof AttendancePayrollExportError) throw error;
      throw new AttendancePayrollExportError('persistence_failed', errorMessage(error));
    }
  };
}

export const preparePayrollExport = createPayrollExportService({ transaction, storage: payrollExportStorage });

function validateArgs(args: PreparePayrollExportArgs): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.weekStartDate)) fail('invalid_week', 'week_start must be a Monday YYYY-MM-DD');
  const date = new Date(`${args.weekStartDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== args.weekStartDate || date.getUTCDay() !== 1) {
    fail('invalid_week', 'week_start must be a Monday YYYY-MM-DD');
  }
  if (args.format !== 'csv' && args.format !== 'xlsx') fail('invalid_format', "format must be 'csv' or 'xlsx'");
  if (args.expectedLockVersion !== undefined &&
      (!Number.isInteger(args.expectedLockVersion) || args.expectedLockVersion < 1)) {
    fail('export_version_conflict', 'lock_version must be a positive integer');
  }
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

function validateReadyRecord(record: PayrollExportRecord | null, rowCount: number,
  totals: Record<string, string>, sha256: string): void {
  if (!record || record.status !== 'ready' || Number(record.row_count) !== rowCount ||
      record.sha256 !== sha256 || !record.storage_path ||
      !sameTotals(record.totals, totals)) {
    fail('export_version_conflict', 'Persisted payroll export does not match the locked artifact');
  }
}

function sameTotals(value: unknown, expected: Record<string, string>): boolean {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const actual = parsed as Record<string, unknown>;
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) &&
      expectedKeys.every((key) => actual[key] === expected[key]);
  } catch { return false; }
}

function prepared(record: PayrollExportRecord, format: 'csv' | 'xlsx', lockVersion: number,
  rows: PreparedPayrollExport['rows'], totals: PreparedPayrollExport['totals'],
  bytes: Buffer, filename: string): PreparedPayrollExport {
  return { dryRun: false, exportId: record.id, format, lockVersion, rowCount: rows.length,
    rows, totals, sha256: record.sha256!, bytes, filename, storagePath: record.storage_path! };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}
function fail(code: ConstructorParameters<typeof AttendancePayrollExportError>[0], message: string): never {
  throw new AttendancePayrollExportError(code, message);
}
