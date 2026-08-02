import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { createPayrollExportService } from '../exportService';
import { daily, FakePayrollDb, FakeStorage } from './payrollFake';

const BASE_ARGS = {
  weekStartDate: '2026-08-03', format: 'csv' as const,
  actorUserId: 'admin-1', expectedLockVersion: 3,
};

function service(db = new FakePayrollDb(), storage = new FakeStorage()) {
  return { db, storage, prepare: createPayrollExportService({ transaction: db.transaction, storage }) };
}

describe('locked payroll export', () => {
  it('acquires the canonical guard before refusing an unlocked week', async () => {
    const { db, prepare } = service();
    db.active = false;

    await expect(prepare(BASE_ARGS)).rejects.toMatchObject({ code: 'period_locked' });
    expect(db.queryLog[0]).toMatch(/pg_advisory_xact_lock/i);
    expect(db.queryLog[1]).toContain('payroll:actor-role');
    expect(db.queryLog[2]).toContain('payroll:active-lock');
    expect(db.queryLog.some((sql) => sql.includes('payroll:claim-export'))).toBe(false);
  });

  it('maps only approved classifications into exact non-overlapping hour columns', async () => {
    const rows = [
      daily(),
      daily({ staff_id: 'staff-2', employee_id: 'EMP002', full_name: 'Comma, "Name"',
        work_date: '2026-08-04', approved_regular_hrs: '0', leave_hrs: '8',
        attendance_classification: 'approved_leave' }),
      daily({ staff_id: 'staff-3', employee_id: 'EMP003', full_name: 'Sick Worker',
        work_date: '2026-08-05', approved_regular_hrs: '0', leave_hrs: '8',
        attendance_classification: 'sick_leave' }),
      daily({ staff_id: 'staff-4', employee_id: 'EMP004', full_name: 'Holiday Worker',
        work_date: '2026-08-06', approved_regular_hrs: '0', approved_holiday_hrs: '8',
        attendance_classification: 'public_holiday' }),
      daily({ staff_id: 'staff-5', employee_id: 'EMP005', full_name: 'Absent Worker',
        work_date: '2026-08-07', approved_regular_hrs: '0', unpaid_hrs: '8',
        attendance_classification: 'unauthorised_absence' }),
    ];
    const { db, prepare } = service(new FakePayrollDb(rows));

    const result = await prepare(BASE_ARGS);

    expect(result.rows[1]).toMatchObject({ approved_leave_hours: '8.00', ordinary_hours: '0.00' });
    expect(result.rows[2]).toMatchObject({ sick_leave_hours: '8.00', approved_leave_hours: '0.00' });
    expect(result.rows[3]).toMatchObject({ public_holiday_hours: '8.00', ordinary_hours: '0.00' });
    expect(result.rows[4]).toMatchObject({ unpaid_hours: '8.00', ordinary_hours: '0.00' });
    expect(result.bytes.toString('utf8')).toContain('"Comma, ""Name"""');
    expect(result.bytes.toString('utf8')).not.toMatch(/wage|hourly_rate|proposed/i);
    expect(result.bytes.toString('utf8')).not.toContain('\r\n');
    expect(result.totals).toMatchObject({ ordinary_hours: '8.00', approved_leave_hours: '8.00', sick_leave_hours: '8.00', public_holiday_hours: '8.00', unpaid_hours: '8.00' });
    expect([...db.exports.values()][0]).toMatchObject({ status: 'ready', sha256: result.sha256, row_count: 5 });
    const guardIndex = db.queryLog.findIndex((sql) => /pg_advisory_xact_lock/i.test(sql));
    const snapshotIndex = db.queryLog.findIndex((sql) => sql.includes('payroll:locked-days'));
    const readbackIndex = db.queryLog.findIndex((sql) => sql.includes('payroll:readback'));
    expect(guardIndex).toBe(0);
    expect(snapshotIndex).toBeGreaterThan(guardIndex);
    expect(readbackIndex).toBeGreaterThan(snapshotIndex);
    expect(db.queryLog.join('\n')).not.toMatch(/(?:INSERT|UPDATE)\s+(?:INTO\s+)?attendance_weekly_locks/i);
  });

  it('returns byte-identical CSV, checksum and identity for repeat and concurrent calls', async () => {
    const { prepare, storage } = service();
    const [first, second] = await Promise.all([prepare(BASE_ARGS), prepare(BASE_ARGS)]);
    const third = await prepare(BASE_ARGS);

    expect(second.exportId).toBe(first.exportId);
    expect(third.exportId).toBe(first.exportId);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(third.bytes.equals(first.bytes)).toBe(true);
    expect(second.sha256).toBe(first.sha256);
    expect(storage.uploads).toBe(1);
    expect(storage.removals).toEqual([]);
  });

  it('keeps CSV and XLSX identities format-specific', async () => {
    const { prepare, storage } = service();
    const csv = await prepare(BASE_ARGS);
    const xlsx = await prepare({ ...BASE_ARGS, format: 'xlsx' });

    expect(xlsx.exportId).not.toBe(csv.exportId);
    expect(xlsx.sha256).not.toBe(csv.sha256);
    expect(storage.uploads).toBe(2);
  });

  it.each(['=2+3', '+cmd', '-cmd', '@cmd'])('neutralizes CSV formula prefix %s without changing XLSX text', async (fullName) => {
    const csvService = service(new FakePayrollDb([daily({ full_name: fullName })]));
    const xlsxService = service(new FakePayrollDb([daily({ full_name: fullName })]));

    const csv = await csvService.prepare(BASE_ARGS);
    const xlsx = await xlsxService.prepare({ ...BASE_ARGS, format: 'xlsx' });
    expect(csv.bytes.toString('utf8').split('\n')[1]).toContain(`,'${fullName},`);
    const workbook = XLSX.read(xlsx.bytes, { type: 'buffer' });
    const values = XLSX.utils.sheet_to_json(workbook.Sheets['Payroll Hours']!, { header: 1 }) as unknown[][];
    expect(values[1]?.[2]).toBe(fullName);
  });

  it('accepts PostgreSQL JSONB key reordering in persisted totals', async () => {
    const { db, prepare } = service();
    const first = await prepare(BASE_ARGS);
    const metadata = [...db.exports.values()][0]!;
    metadata.totals = Object.fromEntries(Object.entries(metadata.totals).reverse());

    await expect(prepare(BASE_ARGS)).resolves.toMatchObject({ exportId: first.exportId });
  });

  it('repeats frozen bytes after mutable identity and assignment sources change', async () => {
    const { db, prepare } = service();
    const first = await prepare(BASE_ARGS);
    Object.assign(db.dailyRows[0]!, {
      employee_id: 'CHANGED', full_name: 'Changed Name',
      project_id: 'project-new', site_id: 'site-new',
    });

    const second = await prepare(BASE_ARGS);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(second.sha256).toBe(first.sha256);
    const lockedRead = db.queryLog.find((sql) => sql.includes('payroll:locked-days')) ?? '';
    expect(lockedRead).not.toMatch(/JOIN\s+staff|vehicle_assignments|fleet_vehicle_project_assignments/i);
  });

  it('requires the active lock timestamp to exactly equal immutable history', async () => {
    const { db } = service();
    db.historySnapshot = structuredClone(db.historySnapshot);
    const original = db.transaction;
    db.transaction = async (work) => original(async (tx) => {
      const queryOne = tx.queryOne.bind(tx);
      tx.queryOne = async (text, params) => {
        const row = await queryOne(text, params);
        return text.includes('payroll:lock-history') && row
          ? { ...row, recorded_at: '2026-08-03T15:30:00.001Z' } as never : row;
      };
      return work(tx);
    });
    const run = createPayrollExportService({ transaction: db.transaction, storage: new FakeStorage() });

    await expect(run(BASE_ARGS)).rejects.toMatchObject({ code: 'export_version_conflict' });
  });

  it('keeps preview rows/totals equal to export and performs no dry-run writes', async () => {
    const { db, storage, prepare } = service();
    const preview = await prepare({ ...BASE_ARGS, dryRun: true });
    expect(db.exports.size).toBe(0);
    expect(storage.uploads).toBe(0);

    const exported = await prepare(BASE_ARGS);
    expect(preview.rows).toEqual(exported.rows);
    expect(preview.totals).toEqual(exported.totals);
  });

  it('produces byte-identical XLSX with fixed properties despite wall-clock changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-05T01:00:00Z');
    const { prepare, storage } = service();
    const first = await prepare({ ...BASE_ARGS, format: 'xlsx' });
    vi.setSystemTime('2031-01-01T00:00:00Z');
    const second = await prepare({ ...BASE_ARGS, format: 'xlsx' });
    vi.useRealTimers();

    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(storage.uploads).toBe(1);
    const workbook = XLSX.read(first.bytes, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['Payroll Hours']);
    const values = XLSX.utils.sheet_to_json(workbook.Sheets['Payroll Hours']!, { header: 1 });
    expect(values[0]).toEqual(Object.keys(first.rows[0]!));
  });
});
