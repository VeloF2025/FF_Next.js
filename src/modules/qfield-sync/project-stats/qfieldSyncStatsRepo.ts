import { query } from '@/lib/db-pool';
import type { SyncStats } from './types';

export type QueryRunner = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

const defaultRun: QueryRunner = query;

type CurrentJobRow = Record<string, unknown> & {
  id: string;
  type: string;
  status: string;
  started_at: string;
};

type CompletedStatsRow = Record<string, unknown> & {
  last_completed_at: string | null;
  successful: string | number;
  failed: string | number;
  records_processed: string | number;
  records_created: string | number;
  records_updated: string | number;
  records_failed: string | number;
};

type CountRow = Record<string, unknown> & {
  count: string | number;
};

function count(value: string | number | undefined): number {
  return Number(value ?? 0);
}

export async function getSystemSyncStats(
  run: QueryRunner = defaultRun,
): Promise<SyncStats> {
  const [currentRows, completedRows, conflictRows] = await Promise.all([
    run<CurrentJobRow>(
      `SELECT id::text AS id,
              type,
              status,
              to_char(started_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at
       FROM qfield_sync_jobs
       WHERE status = 'syncing'
       ORDER BY started_at DESC
       LIMIT 1`,
    ),
    run<CompletedStatsRow>(
      `SELECT
         to_char(
           MAX(completed_at) FILTER (WHERE status = 'completed') AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS"Z"'
         ) AS last_completed_at,
         (COUNT(*) FILTER (WHERE status = 'completed'))::int AS successful,
         (COUNT(*) FILTER (WHERE status = 'error'))::int AS failed,
         COALESCE(SUM(records_processed), 0) AS records_processed,
         COALESCE(SUM(records_created), 0) AS records_created,
         COALESCE(SUM(records_updated), 0) AS records_updated,
         COALESCE(SUM(records_failed), 0) AS records_failed
       FROM qfield_sync_jobs
       WHERE status IN ('completed', 'error')`,
    ),
    run<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM qfield_sync_conflicts
       WHERE resolution IS NULL`,
    ),
  ]);

  const current = currentRows[0];
  const completed = completedRows[0];
  return {
    scope: 'system',
    currentJob: current
      ? {
          id: current.id,
          type: current.type,
          status: current.status,
          startedAt: current.started_at,
        }
      : null,
    lastCompletedAt: completed?.last_completed_at ?? null,
    successful: count(completed?.successful),
    failed: count(completed?.failed),
    recordsProcessed: count(completed?.records_processed),
    recordsCreated: count(completed?.records_created),
    recordsUpdated: count(completed?.records_updated),
    recordsFailed: count(completed?.records_failed),
    unresolvedConflicts: count(conflictRows[0]?.count),
  };
}
