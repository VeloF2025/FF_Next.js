/**
 * The nightly aggregation pass: pick the months, rebuild each one, record what
 * happened.
 *
 * Months are independent by design. One month failing must not cost the others,
 * because the alternative is a single bad day of source data freezing the whole
 * aggregate - and retention's coverage gate then blocks purging every month,
 * not just the broken one. So each month is caught on its own, its previous
 * complete answer is left active, and the RUN is marked partial.
 *
 * Health alerting is deliberately not here. `notifyRetentionHealth` already
 * watches `fleet_operational_aggregation_runs` for staleness and pages hold
 * authority, so this module's job is to record an honest run row and let the
 * existing watcher do the noticing. A second alerting path would double every
 * page.
 */
import { log } from '@/lib/logger';
import { query, queryOne } from '@/lib/db-pool';
import { replaceMonth } from './aggregateRepository';
import type { OperationsFact } from './facts';
import { loadIncidentFacts, loadNotificationFacts } from './incidentFactQueries';
import { calculateMonthlyMetrics } from './metricCalculator';
import { loadMonitorRunFacts } from './monitorFactQueries';
import { loadPresenceFacts, loadProjectsWithOperationalSites } from './presenceFactQueries';
import { getEffectiveAnalyticsRetentionSettings } from './settingsRepository';
import { releaseAnonymousGroups } from './suppression';
import { sastMonthStart, shiftMonth } from './sastDates';

const MODULE = 'FleetOperationalAggregation';

export interface AggregationResult {
  runId: string;
  status: 'succeeded' | 'partial' | 'failed';
  metricVersion: number;
  monthsRequested: number;
  monthsSucceeded: number;
  monthsFailed: number;
  monthsUnchanged: number;
  rowsWritten: number;
}


/**
 * The months this run rebuilds: the current SAST month and the `window - 1`
 * before it, newest first.
 *
 * Older months are recalculated as well as the current one because source
 * detail keeps moving after the month ends - an incident reviewed in August
 * changes July's outcome metrics - and the window is how long that is still
 * expected to happen.
 */
export function targetMonths(requestedAt: string, recalculationWindowMonths: number): string[] {
  const current = sastMonthStart(requestedAt);
  return Array.from({ length: Math.max(1, recalculationWindowMonths) }, (_, i) => shiftMonth(current, -i));
}

interface RunIdRow extends Record<string, unknown> { id: string }

async function startRun(metricVersion: number, monthsRequested: number): Promise<string> {
  const row = await queryOne<RunIdRow>(
    `/* fleet-analytics-runs:start */
     INSERT INTO fleet_operational_aggregation_runs
       (status, trigger_source, metric_version, started_at, months_requested)
     VALUES ('running', 'cron', $1, now(), $2)
     RETURNING id`,
    [metricVersion, monthsRequested],
  );
  if (!row) throw new Error('Could not open a Fleet aggregation run');
  return row.id;
}

async function finishRun(runId: string, result: Omit<AggregationResult, 'runId' | 'metricVersion'>, errorCode: string | null): Promise<void> {
  await query(
    `/* fleet-analytics-runs:finish */
     UPDATE fleet_operational_aggregation_runs
        SET status = $2, finished_at = now(), months_succeeded = $3,
            months_failed = $4, rows_written = $5, error_code = $6
      WHERE id = $1`,
    [runId, result.status, result.monthsSucceeded, result.monthsFailed, result.rowsWritten, errorCode],
  );
}

/** Loads every fact for one month. The presence half reports its own gaps. */
async function loadMonthFacts(
  monthStart: string,
  projectIds: readonly string[],
): Promise<{ facts: OperationsFact[]; skippedDays: number }> {
  const nextMonthStart = shiftMonth(monthStart, 1);
  const [incidents, notifications, monitorRuns, presence] = await Promise.all([
    loadIncidentFacts(monthStart, nextMonthStart),
    loadNotificationFacts(monthStart, nextMonthStart),
    loadMonitorRunFacts(monthStart, nextMonthStart),
    loadPresenceFacts(monthStart, projectIds),
  ]);
  return {
    facts: [...presence.facts, ...incidents, ...notifications, ...monitorRuns],
    skippedDays: presence.skippedDays,
  };
}

/**
 * Rebuilds every month in the recalculation window.
 *
 * A month whose presence evaluation skipped days is NOT written: a partial
 * month stored as complete would satisfy retention's coverage gate and let
 * incidents be purged against numbers that never included them.
 */
export async function aggregateOperationsMonths(requestedAt: string): Promise<AggregationResult> {
  const policy = await getEffectiveAnalyticsRetentionSettings(requestedAt);
  const months = targetMonths(requestedAt, policy.recalculationWindowMonths);
  const runId = await startRun(policy.metricVersion, months.length);

  let monthsSucceeded = 0;
  let monthsFailed = 0;
  let monthsUnchanged = 0;
  let rowsWritten = 0;

  const projectIds = await loadProjectsWithOperationalSites();

  for (const monthStart of months) {
    try {
      const { facts, skippedDays } = await loadMonthFacts(monthStart, projectIds);
      if (skippedDays > 0) {
        throw new Error(`${skippedDays} project-day(s) could not be evaluated`);
      }
      const groups = calculateMonthlyMetrics(facts, policy.metricVersion);
      const released = releaseAnonymousGroups(groups, policy.anonymityMinContributors);
      const outcome = await replaceMonth(monthStart, policy.metricVersion, released, runId);
      monthsSucceeded += 1;
      rowsWritten += outcome.rowsWritten;
      if (!outcome.changed) monthsUnchanged += 1;
    } catch (error) {
      monthsFailed += 1;
      log.error(
        '[fleet-analytics] month aggregation failed; its previous version stays active',
        { monthStart, error: error instanceof Error ? error.message : String(error) },
        MODULE,
      );
    }
  }

  const status = monthsFailed === 0 ? 'succeeded' : monthsSucceeded === 0 ? 'failed' : 'partial';
  const result = { status, monthsRequested: months.length, monthsSucceeded, monthsFailed, monthsUnchanged, rowsWritten } as const;
  await finishRun(runId, result, monthsFailed > 0 ? 'month_aggregation_failed' : null);

  return { runId, metricVersion: policy.metricVersion, ...result };
}
// Re-exported so callers of the aggregation pipeline get its month arithmetic
// from one place; the implementations live in ./sastDates with their tests.
export { sastMonthStart, shiftMonth };
