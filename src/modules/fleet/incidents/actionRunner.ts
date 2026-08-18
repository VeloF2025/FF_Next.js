/**
 * Acknowledgement escalation, the 08:15 SAST morning summary, and
 * status-monitor health checks for Fleet operational incidents (design §9).
 * Invoked by `pages/api/cron/fleet-incident-actions.ts` under the
 * `fleet-incident-actions` advisory lock, at least every five minutes.
 *
 * Three independent phases share one tick — escalation always runs,
 * morning-summary runs at most once per SAST work date (only at/after
 * 08:15), and the health check always runs — each isolated so one phase's
 * failure never blocks or hides another's, folding errors into the
 * returned counters instead of aborting the tick.
 */
import { log } from '@/lib/logger';
import { query, transaction, type TxnClient } from '@/lib/db-pool';
import { insertIncidentAction } from './incidentRepository';
import {
  sendEscalationNotification, sendMonitorFailedNotification, sendMorningSummaryNotification,
} from './incidentNotifications';
import { resolveIncidentRecipients } from './recipientService';
import { loadEffectiveIncidentRule } from './settingsRepository';
import { loadMonitoredRoster } from './monitorService';
import { resolveScheduledIncidentType } from './incidentProducer';
import {
  findLatestMonitorRun, findStaleRunningRuns, finalizeMonitorRun, startMonitorRun,
} from './runRepository';
import { sastDateString } from '../parking/sastDate';
import type { OperationalFlag, OperationalStatus, OperationalStatusSummary } from '../operations/types';
import type { NotifyResult } from '@/modules/notifications/types';
import type {
  IncidentActionRunnerRequest, IncidentActionRunnerResult, IncidentRule, IncidentSeverity, IncidentType,
} from './types';

const MODULE = 'FleetIncidentActionRunner';
const MORNING_SUMMARY_MINUTE_OF_DAY = 8 * 60 + 15; // 08:15 SAST
const STALE_STATUS_MONITOR_MINUTES = 15; // 3x the 5-min cadence: absorbs one missed tick, still catches a real outage promptly
const MAX_ERROR_ENTRIES = 20;
const MAX_ERROR_SUMMARY_LENGTH = 2000;
const SUMMARY_TYPES: readonly IncidentType[] = ['unassigned', 'unverifiable', 'vehicle_on_site_driver_unconfirmed', 'evidence_gap'];
const DIRECT_SUMMARY_STATUS_TYPES: Partial<Record<OperationalStatus, IncidentType>> = {
  unassigned: 'unassigned', unverifiable: 'unverifiable', vehicle_on_site_driver_unconfirmed: 'vehicle_on_site_driver_unconfirmed',
};
// Signal for design §3.2's "stale/missing expected evidence" — PR4 has no
// dedicated status for it, but these flags are exactly what its evaluator
// sets when required evidence is stale/absent, regardless of status.
const EVIDENCE_GAP_FLAGS: readonly OperationalFlag[] = ['gps_stale', 'gps_missing', 'attendance_missing'];

interface Totals { notifAccepted: number; notifFailed: number; errorCount: number; errorMessages: string[] }
interface EscalationTotals extends Totals { escalated: number }
interface SummaryTotals extends Totals { sent: number }

function sanitizedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}
function boundedErrorSummary(entries: string[]): string | null {
  if (entries.length === 0) return null;
  const bounded = entries.slice(0, MAX_ERROR_ENTRIES).join('; ');
  return bounded.length > MAX_ERROR_SUMMARY_LENGTH ? `${bounded.slice(0, MAX_ERROR_SUMMARY_LENGTH)}…` : bounded;
}
function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
function sastMinutesOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0') * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
}
/** Shared per-phase failure bookkeeping: count it, keep a bounded message, and log with context — never throws, never aborts the phase's loop. */
function recordPhaseError(totals: Totals, logLabel: string, context: { incidentId?: string; runId?: string }, error: unknown): void {
  const message = sanitizedMessage(error);
  const subject = context.incidentId ?? context.runId ?? null;
  totals.errorCount += 1;
  totals.errorMessages.push(subject ? `${subject}: ${message}` : message);
  log.error(logLabel, { ...context, error: message }, MODULE);
}
function applyDelivery(totals: Totals, delivery: NotifyResult): void {
  totals.notifAccepted += delivery.delivered; totals.notifFailed += delivery.failed;
}
// -- Escalation ---------------------------------------------------------

interface DueEscalationRow extends Record<string, unknown> {
  id: string; incident_reference: string; incident_type: IncidentType; severity: IncidentSeverity;
  project_id: string | null; staff_name_snapshot: string | null; project_name_snapshot: string | null;
  operational_site_name_snapshot: string | null; escalation_level: number;
  opened_at: string; next_escalation_at: string | null;
  acknowledgement_target_minutes: number; reminder_interval_minutes: number; maximum_escalation_level: number;
}

// Every open incident whose configured ack target (first check) or reminder
// interval (later checks) has elapsed as of `effectiveAt`, below its rule's max level.
async function findDueEscalations(effectiveAt: string): Promise<DueEscalationRow[]> {
  return query<DueEscalationRow>(
    `/* fleet-incident-actions:due-escalations */
     SELECT i.id, i.incident_reference, i.incident_type, i.severity, i.project_id,
       i.staff_name_snapshot, i.project_name_snapshot, i.operational_site_name_snapshot,
       i.escalation_level, i.opened_at, i.next_escalation_at,
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
        severity: row.severity, projectId: row.project_id, staffName: row.staff_name_snapshot,
        projectName: row.project_name_snapshot, operationalSiteName: row.operational_site_name_snapshot,
        escalationLevel: outcome.newLevel,
      }));
    } catch (error) {
      recordPhaseError(totals, '[fleet-incident-actions] escalation failed for one incident', { incidentId: row.id }, error);
    }
  }
}
// -- Morning summary ------------------------------------------------------

function summaryIncidentType(item: OperationalStatusSummary): IncidentType | null {
  if (resolveScheduledIncidentType(item.status)) return null; // already becomes an incident, not a summary condition
  const direct = DIRECT_SUMMARY_STATUS_TYPES[item.status];
  if (direct) return direct;
  return item.flags.some((flag) => EVIDENCE_GAP_FLAGS.includes(flag)) ? 'evidence_gap' : null;
}

async function loadSummaryRules(effectiveAt: string): Promise<Partial<Record<IncidentType, IncidentRule>>> {
  const entries = await Promise.all(
    SUMMARY_TYPES.map(async (type) => [type, await loadEffectiveIncidentRule(type, effectiveAt)] as const),
  );
  const rules: Partial<Record<IncidentType, IncidentRule>> = {};
  for (const [type, rule] of entries) if (rule) rules[type] = rule;
  return rules;
}

interface SummaryBucket { projectId: string | null; projectName: string | null; counts: Map<IncidentType, number> }

function buildSummaryBuckets(
  roster: readonly OperationalStatusSummary[], rules: Partial<Record<IncidentType, IncidentRule>>,
): Map<string, SummaryBucket> {
  const buckets = new Map<string, SummaryBucket>();
  for (const item of roster) {
    const type = summaryIncidentType(item);
    const rule = type ? rules[type] : undefined;
    if (!rule || !rule.enabled || !rule.includeInMorningSummary) continue;
    const key = item.projectId ?? 'unassigned';
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { projectId: item.projectId, projectName: item.projectName, counts: new Map() }; buckets.set(key, bucket); }
    bucket.counts.set(type as IncidentType, (bucket.counts.get(type as IncidentType) ?? 0) + 1);
  }
  return buckets;
}

async function sendSummaryForBucket(bucket: SummaryBucket, workDate: string, totals: SummaryTotals): Promise<void> {
  const recipients = await resolveIncidentRecipients(bucket.projectId);
  if (recipients.failed) {
    totals.errorCount += 1;
    log.error('[fleet-incident-actions] no recipient resolved for a morning-summary bucket', { projectId: bucket.projectId }, MODULE);
    return;
  }
  const items = [...bucket.counts.entries()].map(([incidentType, count]) => ({ incidentType, count }));
  for (const recipientUserId of recipients.userIds) {
    applyDelivery(totals, await sendMorningSummaryNotification({
      recipientUserId, projectId: bucket.projectId, projectName: bucket.projectName, workDate, items,
    }));
    totals.sent += 1;
  }
}

// True once a `morning_summary` run already exists for this SAST work date, whatever its
// outcome — makes "once per due work date" hold without reloading the PR4 roster every tick.
async function morningSummaryAlreadySentFor(workDate: string): Promise<boolean> {
  const latest = await findLatestMonitorRun('morning_summary');
  return latest !== null && sastDateString(new Date(latest.effectiveAt)) === workDate;
}

async function runMorningSummaryPhase(request: IncidentActionRunnerRequest, totals: SummaryTotals): Promise<void> {
  if (sastMinutesOfDay(request.effectiveAt) < MORNING_SUMMARY_MINUTE_OF_DAY) return; // before 08:15 SAST — skip entirely
  const workDate = sastDateString(new Date(request.effectiveAt));
  if (await morningSummaryAlreadySentFor(workDate)) return;

  const summaryRun = await startMonitorRun('morning_summary', request.requestedAt, request.effectiveAt);
  let status: 'succeeded' | 'partial_failure' | 'failed' = 'succeeded';
  try {
    const rules = await loadSummaryRules(request.effectiveAt);
    const roster = await loadMonitoredRoster(workDate, request.effectiveAt);
    const buckets = buildSummaryBuckets(roster, rules);
    for (const bucket of buckets.values()) await sendSummaryForBucket(bucket, workDate, totals);
    status = totals.errorCount > 0 || totals.notifFailed > 0 ? 'partial_failure' : 'succeeded';
  } catch (error) {
    status = 'failed';
    recordPhaseError(totals, '[fleet-incident-actions] systemic morning-summary load failure', { runId: summaryRun.id }, error);
  }
  await finalizeMonitorRun(summaryRun.id, {
    status, summariesSentCount: totals.sent, notificationsAcceptedCount: totals.notifAccepted,
    notificationsFailedCount: totals.notifFailed, errorCount: totals.errorCount, errorSummary: boundedErrorSummary(totals.errorMessages),
  });
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
