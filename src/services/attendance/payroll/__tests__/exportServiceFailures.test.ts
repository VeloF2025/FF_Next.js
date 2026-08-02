import { describe, expect, it } from 'vitest';

import { createPayrollExportService } from '../exportService';
import { daily, FakePayrollDb, FakeStorage } from './payrollFake';

const ARGS = { weekStartDate: '2026-08-03', format: 'csv' as const,
  actorUserId: 'admin-1', expectedLockVersion: 3 };

function prepare(db: FakePayrollDb, storage = new FakeStorage()) {
  return { storage, run: createPayrollExportService({ transaction: db.transaction, storage }) };
}

describe('payroll export fail-closed paths', () => {
  it.each([
    ['empty locked week', []],
    ['mixed lock version', [daily(), daily({ staff_id: 'staff-2', locked_period_version: 2 })]],
    ['missing lock version', [daily({ locked_period_version: null })]],
    ['missing employee identity', [daily({ employee_id: null })]],
  ])('rejects %s before claiming export metadata', async (_label, rows) => {
    const db = new FakePayrollDb(rows);
    const { run } = prepare(db);
    await expect(run(ARGS)).rejects.toMatchObject({ code: expect.any(String) });
    expect(db.exports.size).toBe(0);
  });

  it('rejects stale requested version and inconsistent active/history state', async () => {
    const db = new FakePayrollDb();
    const { run } = prepare(db);
    await expect(run({ ...ARGS, expectedLockVersion: 2 })).rejects.toMatchObject({ code: 'export_version_conflict' });

    db.historyAction = 'unlock';
    await expect(run(ARGS)).rejects.toMatchObject({ code: 'export_version_conflict' });
  });

  it('rejects a legacy history snapshot without immutable payroll rows', async () => {
    const db = new FakePayrollDb();
    db.historySnapshot = { dailyResults: [{ staff_id: 'staff-1', work_date: '2026-08-03' }] };
    await expect(prepare(db).run(ARGS)).rejects.toMatchObject({ code: 'export_version_conflict' });
    expect(db.exports.size).toBe(0);
  });

  it.each([
    ['approved hours', { approved_regular_hrs: '7.50' }],
    ['classification', { attendance_classification: 'public_holiday' }],
    ['result version', { result_version: 9 }],
  ])('rejects locked-row drift in %s from the frozen snapshot', async (_label, mutation) => {
    const db = new FakePayrollDb();
    Object.assign(db.dailyRows[0]!, mutation);
    await expect(prepare(db).run(ARGS)).rejects.toMatchObject({ code: 'export_version_conflict' });
    expect(db.exports.size).toBe(0);
  });

  it('persists failed state and publishes no bytes when upload fails', async () => {
    const db = new FakePayrollDb();
    const storage = new FakeStorage();
    storage.failUpload = true;
    const { run } = prepare(db, storage);

    await expect(run(ARGS)).rejects.toMatchObject({ code: 'storage_failed' });
    expect([...db.exports.values()][0]).toMatchObject({ status: 'failed', error_message: 'storage unavailable' });
    expect(storage.files.size).toBe(0);
  });

  it('retries a persisted failed generation with the same identity', async () => {
    const db = new FakePayrollDb();
    const storage = new FakeStorage();
    storage.failUpload = true;
    const { run } = prepare(db, storage);
    await expect(run(ARGS)).rejects.toMatchObject({ code: 'storage_failed' });
    const failedId = [...db.exports.values()][0]?.id;

    storage.failUpload = false;
    const recovered = await run(ARGS);
    expect(recovered).toMatchObject({ dryRun: false, exportId: failedId });
    expect([...db.exports.values()][0]).toMatchObject({ status: 'ready', id: failedId });
  });

  it('deletes the orphan upload when ready metadata persistence rolls back', async () => {
    const db = new FakePayrollDb();
    db.failReadyWrite = true;
    const { run, storage } = prepare(db);

    await expect(run(ARGS)).rejects.toMatchObject({ code: 'persistence_failed' });
    expect(storage.removals).toEqual(['attendance-week-2026-08-03-v3.csv']);
    expect(storage.files.size).toBe(0);
    expect(db.exports.size).toBe(0);
  });

  it('reports an observable cleanup failure when orphan removal returns false', async () => {
    const db = new FakePayrollDb();
    db.failReadyWrite = true;
    const storage = new FakeStorage();
    storage.failRemove = true;

    await expect(prepare(db, storage).run(ARGS)).rejects.toMatchObject({
      code: 'cleanup_failed',
      message: expect.stringContaining('attendance-week-2026-08-03-v3.csv'),
    });
    expect(storage.files.has('attendance-week-2026-08-03-v3.csv')).toBe(true);
  });

  it('allows only active admin and super_admin actors', async () => {
    for (const role of ['manager', 'site_supervisor', 'viewer']) {
      const db = new FakePayrollDb();
      db.role = role;
      await expect(prepare(db).run(ARGS)).rejects.toMatchObject({ code: 'forbidden' });
    }
    for (const role of ['admin', 'super_admin']) {
      const db = new FakePayrollDb();
      db.role = role;
      await expect(prepare(db).run({ ...ARGS, dryRun: true })).resolves.toMatchObject({ dryRun: true });
    }
  });
});
