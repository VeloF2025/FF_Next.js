/**
 * Monitor-run lifecycle and health queries.
 *
 * `fleet_operational_monitor_runs` records every status-monitor, escalation,
 * and morning-summary execution so a run is never silently reported as "all
 * clear" — a stale `running` row is surfaced as failed health by whichever
 * caller finds it via `findStaleRunningRuns`, rather than this module
 * guessing at a staleness threshold itself.
 */
import { query, queryOne } from '@/lib/db-pool';
import type { MonitorRunKind, MonitorRunStatus } from './types';

export class MonitorRunValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'MonitorRunValidationError'; }
}

const RUN_COLUMNS = `id, run_kind, requested_at, effective_at, status, roster_evaluated_count,
  incidents_opened_count, incidents_updated_count, incidents_cleared_count,
  notifications_accepted_count, notifications_failed_count, summaries_sent_count,
  error_count, error_summary, started_at, completed_at`;

interface RunRow extends Record<string, unknown> {
  id: string; run_kind: MonitorRunKind; requested_at: string | Date; effective_at: string | Date;
  status: MonitorRunStatus; roster_evaluated_count: number; incidents_opened_count: number;
  incidents_updated_count: number; incidents_cleared_count: number; notifications_accepted_count: number;
  notifications_failed_count: number; summaries_sent_count: number; error_count: number;
  error_summary: string | null; started_at: string | Date; completed_at: string | Date | null;
}

export interface MonitorRunRecord {
  id: string; runKind: MonitorRunKind; requestedAt: string; effectiveAt: string; status: MonitorRunStatus;
  rosterEvaluatedCount: number; incidentsOpenedCount: number; incidentsUpdatedCount: number;
  incidentsClearedCount: number; notificationsAcceptedCount: number; notificationsFailedCount: number;
  summariesSentCount: number; errorCount: number; errorSummary: string | null;
  startedAt: string; completedAt: string | null;
}

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }
function isoOrNull(value: string | Date | null): string | null { return value === null ? null : iso(value); }

function mapRun(row: RunRow): MonitorRunRecord {
  return {
    id: row.id, runKind: row.run_kind, requestedAt: iso(row.requested_at), effectiveAt: iso(row.effective_at),
    status: row.status, rosterEvaluatedCount: row.roster_evaluated_count, incidentsOpenedCount: row.incidents_opened_count,
    incidentsUpdatedCount: row.incidents_updated_count, incidentsClearedCount: row.incidents_cleared_count,
    notificationsAcceptedCount: row.notifications_accepted_count, notificationsFailedCount: row.notifications_failed_count,
    summariesSentCount: row.summaries_sent_count, errorCount: row.error_count, errorSummary: row.error_summary,
    startedAt: iso(row.started_at), completedAt: isoOrNull(row.completed_at),
  };
}

export async function startMonitorRun(runKind: MonitorRunKind, requestedAt: string, effectiveAt: string): Promise<MonitorRunRecord> {
  const created = await queryOne<RunRow>(
    `INSERT INTO fleet_operational_monitor_runs (run_kind, requested_at, effective_at, status)
     VALUES ($1, $2::timestamptz, $3::timestamptz, 'running')
     RETURNING ${RUN_COLUMNS}`,
    [runKind, requestedAt, effectiveAt],
  );
  if (!created) throw new Error('Monitor run insert returned no row');
  return mapRun(created);
}

export interface FinalizeMonitorRunInput {
  status: Exclude<MonitorRunStatus, 'running'>;
  rosterEvaluatedCount?: number; incidentsOpenedCount?: number; incidentsUpdatedCount?: number;
  incidentsClearedCount?: number; notificationsAcceptedCount?: number; notificationsFailedCount?: number;
  summariesSentCount?: number; errorCount?: number; errorSummary?: string | null;
}

/** Sets `completed_at = now()`; the check constraint requires that whenever `status <> 'running'`, so a caller cannot finalize back into `running`. */
export async function finalizeMonitorRun(id: string, input: FinalizeMonitorRunInput): Promise<MonitorRunRecord> {
  const updated = await queryOne<RunRow>(
    `UPDATE fleet_operational_monitor_runs
     SET status = $2, roster_evaluated_count = $3, incidents_opened_count = $4, incidents_updated_count = $5,
         incidents_cleared_count = $6, notifications_accepted_count = $7, notifications_failed_count = $8,
         summaries_sent_count = $9, error_count = $10, error_summary = $11, completed_at = now()
     WHERE id = $1::uuid
     RETURNING ${RUN_COLUMNS}`,
    [id, input.status, input.rosterEvaluatedCount ?? 0, input.incidentsOpenedCount ?? 0,
      input.incidentsUpdatedCount ?? 0, input.incidentsClearedCount ?? 0, input.notificationsAcceptedCount ?? 0,
      input.notificationsFailedCount ?? 0, input.summariesSentCount ?? 0, input.errorCount ?? 0,
      input.errorSummary ?? null],
  );
  if (!updated) throw new MonitorRunValidationError(`No monitor run found for id ${id}`);
  return mapRun(updated);
}

export async function findLatestMonitorRun(runKind: MonitorRunKind): Promise<MonitorRunRecord | null> {
  const row = await queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM fleet_operational_monitor_runs WHERE run_kind = $1 ORDER BY started_at DESC LIMIT 1`,
    [runKind],
  );
  return row ? mapRun(row) : null;
}

/** Runs still `running` that started before `staleBefore` — health-check input for detecting a monitor that never finalized. */
export async function findStaleRunningRuns(runKind: MonitorRunKind, staleBefore: string): Promise<MonitorRunRecord[]> {
  const rows = await query<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM fleet_operational_monitor_runs
     WHERE run_kind = $1 AND status = 'running' AND started_at < $2::timestamptz
     ORDER BY started_at ASC`,
    [runKind, staleBefore],
  );
  return rows.map(mapRun);
}
