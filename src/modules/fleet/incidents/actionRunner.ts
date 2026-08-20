/**
 * Acknowledgement escalation and status-monitor health checks for Fleet
 * operational incidents (design §9); the 08:15 SAST morning-summary phase
 * lives in `incidentSummaryPhase.ts` and shared per-phase bookkeeping lives
 * in `incidentActionShared.ts` — both orchestrated from here. Invoked by
 * `pages/api/cron/fleet-incident-actions.ts` under the
 * `fleet-incident-actions` advisory lock, at least every five minutes.
 *
 * Three independent phases share one tick — escalation always runs,
 * morning-summary runs at most once per SAST work date (only at/after
 * 08:15), and the health check always runs — each isolated so one phase's
 * failure never blocks or hides another's, folding errors into the
 * returned counters instead of aborting the tick.
 */
import { query, transaction, type TxnClient } from '@/lib/db-pool';
import { insertIncidentAction } from './incidentRepository';
import { sendEscalationNotification, sendMonitorFailedNotification } from './incidentNotifications';
import {
  findLatestMonitorRun, findStaleRunningRuns, finalizeMonitorRun, startMonitorRun,
} from './runRepository';
import { sastDateString } from '../parking/sastDate';
import { addMinutesIso, applyDelivery, boundedErrorSummary, recordPhaseError } from './incidentActionShared';
import type { EscalationTotals, SummaryTotals } from './incidentActionShared';
import { runMorningSummaryPhase } from './incidentSummaryPhase';
import type {
  IncidentActionRunnerRequest, IncidentActionRunnerResult, IncidentProducerKind, IncidentSeverity, IncidentType,
} from './types';

const STALE_STATUS_MONITOR_MINUTES = 15; // 3x the 5-min cadence: absorbs one missed tick, still catches a real outage promptly
// -- Escalation ---------------------------------------------------------

interface DueEscalationRow extends Record<string, unknown> {
  id: string; incident_reference: string; incident_type: IncidentType; severity: IncidentSeverity;
  project_id: string | null; staff_name_snapshot: string | null; project_name_snapshot: string | null;
  operational_site_name_snapshot: string | null; escalation_level: number;
  opened_at: string; next_escalation_at: string | null; source_event_id: string | null;
  acknowledgement_target_minutes: number; reminder_interval_minutes: number; maximum_escalation_level: number;
}

// The table has no producer_kind column: a non-null source_event_id is how a
// source-event-produced incident is distinguished from a scheduled-detection
// one (see incidentRepository.ts / migration 506's fleet_operational_incidents).
function producerKindOf(row: DueEscalationRow): IncidentProducerKind {
  return row.source_event_id !== null ? 'source_event' : 'scheduled_detection';
}

// Every open incident whose configured ack target (first check) or reminder
// interval (later checks) has elapsed as of `effectiveAt`, below its rule's max level.
async function findDueEscalations(effectiveAt: string): Promise<DueEscalationRow[]> {
  return query<DueEscalationRow>(
    `/* fleet-incident-actions:due-escalations */
     SELECT i.id, i.incident_reference, i.incident_type, i.severity, i.project_id,
       i.staff_name_snapshot, i.project_name_snapshot, i.operational_site_name_snapshot,
       i.escalation_level, i.opened_at, i.next_escalation_at, i.source_event_id,
       r.acknowledgement_target_minutes, r.reminder_interval_minutes, r.maximum_escalation_level
     FROM fleet_operational_incidents i
     JOIN fleet_operational_incident_rules r ON r.id = i.incident_rule_id
     WHERE i.lifecycle_status = 'open' AND i.escalation_level < r.maximum_escalation_level
       AND ((i.next_escalation_at IS NULL AND i.opened_at + (r.acknowledgement_target_minutes || ' minutes')::interval <= $1::timestamptz)
         OR (i.next_escalation_at IS NOT NULL AND i.next_escalation_at <= $1::timestamptz))
     ORDER BY i.opened_at ASC`,
    [effectiveAt],
  );
}

// Atomic level increment, row-locked. Null (no-op, not an error) when a concurrent
// transition already moved the incident past `open` or to its max level —
// acknowledgement stops reminders by construction, not a special case here.
async function escalateIncidentAtomically(
  row: DueEscalationRow, effectiveAt: string, requestCorrelationId: string | null,
): Promise<{ newLevel: number } | null> {
  return transaction(async (txn: TxnClient) => {
    const locked = await txn.queryOne<{ lifecycle_status: string; escalation_level: number }>(
      `SELECT lifecycle_status, escalation_level FROM fleet_operational_incidents WHERE id = $1::uuid FOR UPDATE`,
      [row.id],
    );
    if (!locked || locked.lifecycle_status !== 'open' || locked.escalation_level >= row.maximum_escalation_level) return null;
    const newLevel = locked.escalation_level + 1;
    const nextEscalationAt = newLevel >= row.maximum_escalation_level ? null : addMinutesIso(effectiveAt, row.reminder_interval_minutes);
    await txn.query(
      `UPDATE fleet_operational_incidents
       SET escalation_level = $2, last_escalated_at = $3::timestamptz, next_escalation_at = $4::timestamptz, updated_at = now()
       WHERE id = $1::uuid`,
      [row.id, newLevel, effectiveAt, nextEscalationAt],
    );
    await insertIncidentAction({
      incidentId: row.id, actionType: 'escalated', actorUserId: null, isSystemActor: true, note: null,
      beforeLifecycleStatus: 'open', afterLifecycleStatus: 'open',
      beforeEscalationLevel: locked.escalation_level, afterEscalationLevel: newLevel,
      metadata: {}, requestCorrelationId,
    }, txn);
    return { newLevel };
  });
}

async function runEscalationPhase(request: IncidentActionRunnerRequest, runId: string, totals: EscalationTotals): Promise<void> {
  let due: DueEscalationRow[];
  try {
    due = await findDueEscalations(request.effectiveAt);
  } catch (error) {
    recordPhaseError(totals, '[fleet-incident-actions] systemic due-escalation load failure', { runId }, error);
    return;
  }

  for (const row of due) {
    try {
      const outcome = await escalateIncidentAtomically(row, request.effectiveAt, request.requestCorrelationId ?? runId);
      if (!outcome) continue;
      totals.escalated += 1;
      applyDelivery(totals, await sendEscalationNotification({
        incidentId: row.id, incidentReference: row.incident_reference, incidentType: row.incident_type,
        severity: row.severity, producerKind: producerKindOf(row), projectId: row.project_id, staffName: row.staff_name_snapshot,
        projectName: row.project_name_snapshot, operationalSiteName: row.operational_site_name_snapshot,
        escalationLevel: outcome.newLevel,
      }));
    } catch (error) {
      recordPhaseError(totals, '[fleet-incident-actions] escalation failed for one incident', { incidentId: row.id }, error);
    }
  }
}
// -- Status-monitor health --------------------------------------------------

// Detects a status-monitor run that started but never finished ("stale
// running", converted to failed) and, only when nothing was already stale,
// one that has not started at all recently ("missing"). This tick can see
// the OTHER cron's run history because it is itself executing — but if the
// entire scheduler/host has stopped and NEITHER endpoint runs, nothing
// inside either can observe that; design §9.3 requires external
// host/scheduler monitoring for that boundary, which this cannot cover.
async function runStatusMonitorHealthCheck(effectiveAt: string, totals: EscalationTotals): Promise<void> {
  const staleBefore = addMinutesIso(effectiveAt, -STALE_STATUS_MONITOR_MINUTES);
  let staleRuns: Awaited<ReturnType<typeof findStaleRunningRuns>>;
  try {
    staleRuns = await findStaleRunningRuns('status_monitor', staleBefore);
  } catch (error) {
    recordPhaseError(totals, '[fleet-incident-actions] status-monitor health query failed', {}, error);
    return;
  }

  for (const staleRun of staleRuns) {
    try {
      await finalizeMonitorRun(staleRun.id, {
        status: 'failed', errorCount: 1, errorSummary: 'Status-monitor run started but never finalized (stale running record).',
      });
      applyDelivery(totals, await sendMonitorFailedNotification({
        runId: staleRun.id, runKind: 'status_monitor',
        reason: 'The five-minute Fleet status monitor started a run that never finished; it has been marked failed. Investigate whether the process is stuck or crashed.',
      }));
    } catch (error) {
      recordPhaseError(totals, '[fleet-incident-actions] failed to convert a stale status-monitor run', { runId: staleRun.id }, error);
    }
  }
  if (staleRuns.length > 0) return; // already alerted for this specific problem this tick

  try {
    const latest = await findLatestMonitorRun('status_monitor');
    const latestStartMs = latest ? new Date(latest.startedAt).getTime() : null;
    if (latestStartMs !== null && latestStartMs >= new Date(staleBefore).getTime()) return; // ran recently — healthy
    applyDelivery(totals, await sendMonitorFailedNotification({
      runId: `missing:${sastDateString(new Date(effectiveAt))}`, runKind: 'status_monitor',
      reason: 'No Fleet status-monitor run has started recently. If the external cron scheduler has stopped entirely, this application-level check cannot detect that — external host/scheduler monitoring is required.',
    }));
  } catch (error) {
    recordPhaseError(totals, '[fleet-incident-actions] status-monitor missing-run check failed', {}, error);
  }
}
// -- Orchestration ------------------------------------------------------------

export async function runIncidentActions(request: IncidentActionRunnerRequest): Promise<IncidentActionRunnerResult> {
  const run = await startMonitorRun('escalation', request.requestedAt, request.effectiveAt);
  const totals: EscalationTotals = { escalated: 0, notifAccepted: 0, notifFailed: 0, errorCount: 0, errorMessages: [] };
  const summaryTotals: SummaryTotals = { sent: 0, notifAccepted: 0, notifFailed: 0, errorCount: 0, errorMessages: [] };

  await runEscalationPhase(request, run.id, totals);
  await runMorningSummaryPhase(request, summaryTotals);
  await runStatusMonitorHealthCheck(request.effectiveAt, totals);

  const status = (totals.errorCount + summaryTotals.errorCount) > 0 || (totals.notifFailed + summaryTotals.notifFailed) > 0
    ? 'partial_failure' as const : 'succeeded' as const;
  const finalized = await finalizeMonitorRun(run.id, {
    status, incidentsUpdatedCount: totals.escalated, notificationsAcceptedCount: totals.notifAccepted,
    notificationsFailedCount: totals.notifFailed, summariesSentCount: summaryTotals.sent,
    errorCount: totals.errorCount, errorSummary: boundedErrorSummary(totals.errorMessages),
  });

  return {
    monitorRunId: run.id, status: finalized.status, escalatedCount: totals.escalated, summariesSentCount: summaryTotals.sent,
    notifications: {
      delivered: totals.notifAccepted + summaryTotals.notifAccepted, suppressed: 0,
      failed: totals.notifFailed + summaryTotals.notifFailed,
    },
  };
}
