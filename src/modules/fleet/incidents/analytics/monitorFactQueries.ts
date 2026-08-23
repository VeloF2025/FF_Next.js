/**
 * Monitor-run facts: did the thing that watches the roster actually run?
 *
 * `fleet_operational_monitor_runs` has no project or site of its own - one run
 * sweeps the whole roster - so each run is attributed to every site that had an
 * active assignment on its SAST date, carrying that site's assigned staff as
 * its contributors.
 *
 * Those contributors are not decoration. `contributor_count >= 5` on the
 * aggregate table is unconditional, so a system-health metric with nobody
 * attached could never be stored at all. Inheriting the covered roster is the
 * honest reading of "who does this statistic describe", and it means monitor
 * health is suppressed on a three-person site exactly as that site's presence
 * metrics are.
 *
 * Only `status_monitor` runs count. `escalation` and `morning_summary` are
 * different jobs on their own schedules, and folding them in would inflate the
 * expected-run count with runs that were never meant to evaluate a roster.
 */
import { query } from '@/lib/db-pool';
import type { MonitorRunFact } from './facts';
import { toWorkDate } from './sastDates';

/** The run kind that evaluates the operational roster. */
export const ROSTER_MONITOR_RUN_KIND = 'status_monitor';

interface MonitorRunRow extends Record<string, unknown> {
  work_date: string | Date;
  project_id: string;
  operational_site_id: string;
  contributor_keys: string[];
  completed: boolean;
}

/**
 * `effective_at` is a timestamptz and the roster works in SAST calendar days,
 * so it is converted once, in SQL, and both the join and the month filter use
 * that same converted value. Comparing a UTC instant against a SAST date would
 * misfile every run in the two hours after midnight.
 */
const MONITOR_FACT_SQL = `/* fleet-analytics-facts:monitor-runs */
  WITH runs AS (
    SELECT
      r.id,
      (r.effective_at AT TIME ZONE 'Africa/Johannesburg')::date AS work_date,
      (r.status = 'succeeded') AS completed
    FROM fleet_operational_monitor_runs r
    WHERE r.run_kind = $3
      AND (r.effective_at AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date
      AND (r.effective_at AT TIME ZONE 'Africa/Johannesburg')::date < $2::date
  )
  SELECT
    runs.work_date,
    a.project_id,
    a.operational_site_id,
    array_agg(DISTINCT a.staff_id::text) AS contributor_keys,
    runs.completed
  FROM runs
  JOIN fleet_operational_assignments a
    ON a.status = 'active'
   AND runs.work_date BETWEEN a.start_date AND a.end_date
  WHERE a.project_id IS NOT NULL
    AND a.operational_site_id IS NOT NULL
  GROUP BY runs.id, runs.work_date, runs.completed, a.project_id, a.operational_site_id
  ORDER BY runs.work_date, a.project_id, a.operational_site_id`;

/** One fact per (run, site) pair for the month starting at `monthStart`. */
export async function loadMonitorRunFacts(
  monthStart: string,
  nextMonthStart: string,
): Promise<MonitorRunFact[]> {
  const rows = await query<MonitorRunRow>(MONITOR_FACT_SQL, [
    monthStart, nextMonthStart, ROSTER_MONITOR_RUN_KIND,
  ]);

  return rows.map((row) => ({
    kind: 'monitor_run' as const,
    workDate: toWorkDate(row.work_date),
    dimension: { projectId: row.project_id, operationalSiteId: row.operational_site_id },
    contributorKeys: row.contributor_keys,
    completed: row.completed,
  }));
}
