import { sql } from '@/lib/db-pool';
import { deriveParkingRunHealth, expectedParkingCheckDate, type ParkingRunHealth, type ParkingRunRecord, type ParkingRunStatus } from './runHealth';

interface RunRow {
  id: string; check_date: string | Date; started_at: string | Date; completed_at: string | Date | null;
  status: ParkingRunStatus; evaluated_count: number; violation_count: number; record_error_count: number;
  notification_warning_count: number; error_summary: string | null;
}

const mapRun = (row: RunRow): ParkingRunRecord => ({
  id: row.id, checkDate: typeof row.check_date === 'string' ? row.check_date.slice(0, 10) : row.check_date.toISOString().slice(0, 10),
  startedAt: new Date(row.started_at).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  status: row.status, evaluatedCount: row.evaluated_count, violationCount: row.violation_count,
  recordErrorCount: row.record_error_count, notificationWarningCount: row.notification_warning_count, errorSummary: row.error_summary,
});

export async function startParkingRun(checkDate: string, startedAt: Date): Promise<string> {
  const rows = await sql<{ id: string }>`INSERT INTO fleet_parking_check_runs (check_date,started_at,status) VALUES (${checkDate}::date,${startedAt},'running') RETURNING id`;
  if (!rows[0]) throw new Error('Parking run insert returned no id');
  return rows[0].id;
}

export async function finalizeParkingRun(runId: string, update: {
  status: Exclude<ParkingRunStatus, 'running'>; evaluatedCount: number; violationCount: number;
  recordErrorCount: number; notificationWarningCount: number; errorSummary?: string | null;
}): Promise<void> {
  await sql`UPDATE fleet_parking_check_runs SET completed_at=now(),status=${update.status},evaluated_count=${update.evaluatedCount},violation_count=${update.violationCount},record_error_count=${update.recordErrorCount},notification_warning_count=${update.notificationWarningCount},error_summary=${update.errorSummary ?? null} WHERE id=${runId}::uuid`;
}

export async function loadParkingRunHealth(now: Date): Promise<ParkingRunHealth> {
  const expectedDate = expectedParkingCheckDate(now);
  const today = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const latest = await sql<RunRow>`SELECT * FROM fleet_parking_check_runs WHERE check_date IN (${today}::date,${expectedDate}::date) ORDER BY CASE WHEN check_date=${today}::date THEN 0 ELSE 1 END,started_at DESC LIMIT 1`;
  const success = await sql<RunRow>`SELECT * FROM fleet_parking_check_runs WHERE check_date=${expectedDate}::date AND status IN ('succeeded','partial_failure') ORDER BY started_at DESC LIMIT 1`;
  return deriveParkingRunHealth(latest[0] ? mapRun(latest[0]) : null, success[0] ? mapRun(success[0]) : null, now);
}
