import { pool, query, queryOne, type SqlRow } from '@/lib/db-pool';
import type { RunSummaryCounts } from './types';

export interface VelocityReviewControl {
  automationEnabled: boolean;
  goLiveDate: string | null;
  pilotEnabled: boolean;
  pilotTargetDate: string | null;
  pilotLimit: number | null;
}

export type VelocityReviewRunStatus = 'pending' | 'running' | 'partial' | 'complete' | 'blocked';
export type VelocityReviewSummaryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface VelocityReviewRun {
  id: string;
  targetDate: string;
  status: VelocityReviewRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  counts: RunSummaryCounts;
  summaryStatus: VelocityReviewSummaryStatus;
}

export type DueDateSelection =
  | { status: 'disabled'; dates: [] }
  | { status: 'blocked'; reason: 'invalid_control' | 'gap_older_than_7_days' }
  | { status: 'ready'; dates: string[] }
  | { status: 'pilot'; dates: [string]; limit: number };

interface ControlRow extends SqlRow {
  automation_enabled: boolean;
  go_live_date: Date | string | null;
  pilot_enabled: boolean;
  pilot_target_date: Date | string | null;
  pilot_limit: number | null;
}

interface RunRow extends SqlRow {
  id: string;
  target_date: Date | string;
  status: VelocityReviewRunStatus;
  started_at: Date | null;
  completed_at: Date | null;
  counts: RunSummaryCounts;
  summary_status: VelocityReviewSummaryStatus;
}

const DAY_MS = 86_400_000;

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function dbDate(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function mapRun(row: RunRow): VelocityReviewRun {
  return {
    id: row.id,
    targetDate: dbDate(row.target_date) as string,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    counts: row.counts,
    summaryStatus: row.summary_status,
  };
}

export async function withVelocityReviewLock<T>(
  work: () => Promise<T>,
): Promise<{ acquired: boolean; value?: T }> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('velocity-review-export')) AS acquired",
    );
    if (result.rows[0]?.acquired !== true) return { acquired: false };
    return { acquired: true, value: await work() };
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('velocity-review-export'))");
    } finally {
      client.release();
    }
  }
}

export async function loadVelocityReviewControl(): Promise<VelocityReviewControl> {
  const row = await queryOne<ControlRow>(`
    SELECT automation_enabled, go_live_date, pilot_enabled, pilot_target_date, pilot_limit
    FROM velocity_review_control WHERE singleton = TRUE
  `);
  if (!row) {
    return {
      automationEnabled: false,
      goLiveDate: null,
      pilotEnabled: false,
      pilotTargetDate: null,
      pilotLimit: null,
    };
  }
  return {
    automationEnabled: row.automation_enabled,
    goLiveDate: dbDate(row.go_live_date),
    pilotEnabled: row.pilot_enabled,
    pilotTargetDate: dbDate(row.pilot_target_date),
    pilotLimit: row.pilot_limit,
  };
}

export function selectDueDates(
  control: VelocityReviewControl,
  completedDates: ReadonlySet<string>,
  sastYesterday: string,
): DueDateSelection {
  const yesterday = parseDate(sastYesterday);
  if (!yesterday || (control.automationEnabled && control.pilotEnabled)) {
    return { status: 'blocked', reason: 'invalid_control' };
  }

  if (control.pilotEnabled) {
    const target = control.pilotTargetDate && parseDate(control.pilotTargetDate);
    const limit = control.pilotLimit;
    if (control.automationEnabled || !target || !Number.isInteger(limit) || limit === null || limit < 1 || limit > 50) {
      return { status: 'blocked', reason: 'invalid_control' };
    }
    return { status: 'pilot', dates: [control.pilotTargetDate as string], limit };
  }

  if (!control.automationEnabled) return { status: 'disabled', dates: [] };
  const goLive = control.goLiveDate && parseDate(control.goLiveDate);
  if (!goLive) return { status: 'blocked', reason: 'invalid_control' };

  const dates: string[] = [];
  for (let time = goLive.getTime(); time <= yesterday.getTime(); time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (!completedDates.has(date)) dates.push(date);
  }
  const oldest = dates[0] ? parseDate(dates[0]) : null;
  if (oldest && (yesterday.getTime() - oldest.getTime()) / DAY_MS > 7) {
    return { status: 'blocked', reason: 'gap_older_than_7_days' };
  }
  return { status: 'ready', dates };
}

export async function createOrResumeRun(targetDate: string): Promise<VelocityReviewRun> {
  const row = await queryOne<RunRow>(`
    INSERT INTO velocity_review_runs (target_date, status)
    VALUES ($1, 'pending')
    ON CONFLICT (target_date) DO UPDATE
      SET target_date = EXCLUDED.target_date
    RETURNING id, target_date, status, started_at, completed_at, counts, summary_status
  `, [targetDate]);
  if (!row) throw new Error('Velocity review run could not be persisted');
  return mapRun(row);
}

export async function listCompletedRunDates(): Promise<Set<string>> {
  const rows = await query<{ target_date: Date | string } & SqlRow>(
    "SELECT target_date FROM velocity_review_runs WHERE status = 'complete' ORDER BY target_date",
  );
  return new Set(rows.map((row) => dbDate(row.target_date) as string));
}

export async function transitionRunStatus(
  id: string,
  expectedStatus: VelocityReviewRunStatus,
  nextStatus: VelocityReviewRunStatus,
  counts: RunSummaryCounts,
): Promise<VelocityReviewRun | null> {
  const row = await queryOne<RunRow>(`
    UPDATE velocity_review_runs SET
      status = $3, counts = $4, updated_at = NOW(),
      started_at = CASE WHEN $3 = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
      completed_at = CASE WHEN $3 IN ('complete','partial','blocked') THEN NOW() ELSE completed_at END
    WHERE id = $1 AND status = $2
    RETURNING id, target_date, status, started_at, completed_at, counts, summary_status
  `, [id, expectedStatus, nextStatus, counts]);
  return row ? mapRun(row) : null;
}
