/**
 * Read-only health queries behind the retention alerts (migration 518 run
 * tables plus 510's incidents).
 *
 * Counts only. Nothing here returns an incident id, a staff id, or any other
 * identity: an alert about retention health must not itself become a list of
 * who is under investigation.
 */
import { query, queryOne } from '@/lib/db-pool';
import type { RunStatus } from '../analytics/types';

export interface AutomationRunHealth {
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
}

interface RunRow extends Record<string, unknown> {
  status: RunStatus; started_at: string | Date; finished_at: string | Date | null;
}

interface CountRow extends Record<string, unknown> { total: string | number }

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapRun(row: RunRow | null): AutomationRunHealth | null {
  if (!row) return null;
  return { status: row.status, startedAt: iso(row.started_at), finishedAt: row.finished_at === null ? null : iso(row.finished_at) };
}

export async function getLatestAggregationRun(): Promise<AutomationRunHealth | null> {
  return mapRun(await queryOne<RunRow>(
    `/* fleet-retention-health:aggregation-run */
     SELECT status, started_at, finished_at FROM fleet_operational_aggregation_runs
     ORDER BY started_at DESC LIMIT 1`,
  ));
}

export async function getLatestRetentionRun(): Promise<AutomationRunHealth | null> {
  return mapRun(await queryOne<RunRow>(
    `/* fleet-retention-health:retention-run */
     SELECT status, started_at, finished_at FROM fleet_operational_retention_runs
     ORDER BY started_at DESC LIMIT 1`,
  ));
}

/** Items stuck in `failed` after `minAttempts` tries — a durable problem, not a transient storage blip. */
export async function countRepeatedFailedRetentionItems(minAttempts: number): Promise<number> {
  const rows = await query<CountRow>(
    `/* fleet-retention-health:repeated-failures */
     SELECT COUNT(*) AS total FROM fleet_operational_retention_items
      WHERE stage = 'failed' AND attempts >= $1::int`,
    [minAttempts],
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Incidents past the retention period that are still not in a terminal state.
 *
 * They cannot be purged — the schema refuses — so they are a backlog someone
 * has to close out, and the count is the only safe thing to say about them.
 */
export async function countAgedNonTerminalIncidents(
  params: { at: string; retentionMonths: number },
): Promise<number> {
  const rows = await query<CountRow>(
    `/* fleet-retention-health:aged-non-terminal */
     SELECT COUNT(*) AS total FROM fleet_operational_incidents
      WHERE lifecycle_status NOT IN ('resolved', 'dismissed')
        AND COALESCE(work_date, (opened_at AT TIME ZONE 'Africa/Johannesburg')::date)
            < ($1::timestamptz AT TIME ZONE 'Africa/Johannesburg')::date - make_interval(months => $2::int)`,
    [params.at, params.retentionMonths],
  );
  return Number(rows[0]?.total ?? 0);
}
