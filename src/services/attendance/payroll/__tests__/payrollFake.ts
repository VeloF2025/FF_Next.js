import type { TxnClient } from '@/lib/db-pool';
import type {
  PayrollExportStorage,
  PayrollTransactionRunner,
} from '../types';

export interface FakeDailyRow extends Record<string, unknown> {
  staff_id: string;
  employee_id: string | null;
  full_name: string;
  work_date: string;
  result_status: string;
  locked_period_version: number | string | null;
  result_version: number | string;
  approved_regular_hrs: string;
  approved_overtime_hrs: string;
  approved_sunday_hrs: string;
  approved_holiday_hrs: string;
  leave_hrs: string;
  unpaid_hrs: string;
  attendance_classification: string | null;
  project_id: string | null;
  site_id: string | null;
}

interface FakeExportRow extends Record<string, unknown> {
  id: string;
  week_start_date: string;
  lock_version: number;
  format: string;
  status: string;
  generated_by: string;
  generated_at: string;
  row_count: number;
  totals: Record<string, string>;
  sha256: string | null;
  storage_path: string | null;
  error_message: string | null;
}

export const LOCKED_AT = '2026-08-03T15:30:00.000Z';

export function daily(overrides: Partial<FakeDailyRow> = {}): FakeDailyRow {
  return {
    staff_id: 'staff-1', employee_id: 'EMP001', full_name: 'Alice Example',
    work_date: '2026-08-03', result_status: 'locked', locked_period_version: 3,
    result_version: 8, approved_regular_hrs: '8.00', approved_overtime_hrs: '0.00',
    approved_sunday_hrs: '0.00', approved_holiday_hrs: '0.00', leave_hrs: '0.00',
    unpaid_hrs: '0.00', attendance_classification: null,
    project_id: 'project-1', site_id: 'site-1', ...overrides,
  };
}

export class FakePayrollDb {
  role = 'admin';
  active = true;
  historyAction = 'lock';
  historyVersion: number | string | null = 3;
  historySnapshot: unknown;
  dailyRows: FakeDailyRow[];
  exports = new Map<string, FakeExportRow>();
  queryLog: string[] = [];
  failReadyWrite = false;
  removeFails = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(rows: FakeDailyRow[] = [daily()]) {
    this.dailyRows = rows;
    const snapshotRows = rows.map((row) => ({
      staff_id: row.staff_id, employee_id: row.employee_id, full_name: row.full_name,
      work_date: row.work_date, approved_regular_hrs: row.approved_regular_hrs,
      approved_overtime_hrs: row.approved_overtime_hrs,
      approved_sunday_hrs: row.approved_sunday_hrs,
      approved_holiday_hrs: row.approved_holiday_hrs, leave_hrs: row.leave_hrs,
      unpaid_hrs: row.unpaid_hrs, attendance_classification: row.attendance_classification,
      project_id: row.project_id, site_id: row.site_id, result_version: row.result_version,
      locked_period_version: row.locked_period_version,
    }));
    this.historySnapshot = {
      dailyResults: rows.map((row) => ({ staff_id: row.staff_id, work_date: row.work_date })),
      payrollSnapshot: { version: 1, rows: snapshotRows },
    };
  }

  transaction: PayrollTransactionRunner = async <T>(work: (tx: TxnClient) => Promise<T>) => {
    let release = () => undefined;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = turn;
    await previous;
    const before = new Map([...this.exports].map(([key, value]) => [key, { ...value }]));
    try {
      return await work(this.tx());
    } catch (error) {
      this.exports = before;
      throw error;
    } finally {
      release();
    }
  };

  private tx(): TxnClient {
    const query = async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) => {
      this.queryLog.push(text);
      if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }] as T[];
      if (text.includes('payroll:actor-role')) return [{ role: this.role }] as T[];
      if (text.includes('payroll:active-lock')) return (this.active ? [{
        week_start_date: params[0], locked_at: LOCKED_AT, locked_by: 'hr-1',
        lock_reason: 'Approved payroll week', unlocked_at: null,
      }] : []) as T[];
      if (text.includes('payroll:lock-history')) return [{
        lock_version: this.historyVersion, action: this.historyAction,
        actor_user_id: 'hr-1', reason: 'Approved payroll week',
        recorded_at: LOCKED_AT, result_snapshot: this.historySnapshot,
      }] as T[];
      if (text.includes('payroll:locked-days')) return this.dailyRows as T[];
      if (text.includes('payroll:existing-export')) {
        const row = this.exports.get(`${params[0]}:${params[1]}:${params[2]}`);
        return (row ? [row] : []) as T[];
      }
      if (text.includes('payroll:claim-export')) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        const existing = this.exports.get(key);
        if (existing) {
          existing.status = 'generating'; existing.generated_by = String(params[3]);
          existing.error_message = null;
          return [existing] as T[];
        }
        const row: FakeExportRow = {
          id: `export-${this.exports.size + 1}`, week_start_date: String(params[0]),
          lock_version: Number(params[1]), format: String(params[2]), status: 'generating',
          generated_by: String(params[3]), generated_at: LOCKED_AT, row_count: 0,
          totals: {}, sha256: null, storage_path: null, error_message: null,
        };
        this.exports.set(key, row);
        return [row] as T[];
      }
      if (text.includes('payroll:mark-ready')) {
        if (this.failReadyWrite) throw new Error('metadata write failed');
        const row = this.findById(String(params[0]));
        Object.assign(row, { status: 'ready', row_count: params[1], totals: params[2],
          sha256: params[3], storage_path: params[4], error_message: null });
        return [row] as T[];
      }
      if (text.includes('payroll:mark-failed')) {
        const row = this.findById(String(params[0]));
        Object.assign(row, { status: 'failed', error_message: params[1] });
        return [row] as T[];
      }
      if (text.includes('payroll:ready-event')) return [{ id: 'event-1' }] as T[];
      if (text.includes('payroll:readback')) {
        const row = this.findById(String(params[0]));
        return (row ? [row] : []) as T[];
      }
      throw new Error(`Unhandled payroll SQL: ${text}`);
    };
    return {
      query,
      queryOne: async <T extends Record<string, unknown>>(text: string, params?: unknown[]) =>
        (await query<T>(text, params))[0] ?? null,
      client: {} as TxnClient['client'],
    };
  }

  private findById(id: string): FakeExportRow {
    const row = [...this.exports.values()].find((value) => value.id === id);
    if (!row) throw new Error(`Missing fake export ${id}`);
    return row;
  }
}

export class FakeStorage implements PayrollExportStorage {
  files = new Map<string, Buffer>();
  uploads = 0;
  removals: string[] = [];
  failUpload = false;
  failRemove = false;

  async upload(bytes: Buffer, filename: string): Promise<{ path: string; filename: string }> {
    this.uploads += 1;
    if (this.failUpload) throw new Error('storage unavailable');
    this.files.set(filename, Buffer.from(bytes));
    return { path: `attendance/payroll-exports/${filename}`, filename };
  }

  async remove(filename: string): Promise<boolean> {
    this.removals.push(filename);
    if (this.failRemove) return false;
    return this.files.delete(filename);
  }
}
