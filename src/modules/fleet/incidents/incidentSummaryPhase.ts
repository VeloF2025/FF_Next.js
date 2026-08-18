/**
 * Morning-summary phase (08:15 SAST) of the Fleet incident action runner —
 * see `actionRunner.ts` for the module-level design reference and the
 * escalation/status-monitor phases it orchestrates alongside this one.
 */
import { log } from '@/lib/logger';
import { sendMorningSummaryNotification } from './incidentNotifications';
import { resolveIncidentRecipients } from './recipientService';
import { loadEffectiveIncidentRule } from './settingsRepository';
import { loadMonitoredRoster } from './monitorService';
import { resolveScheduledIncidentType } from './incidentProducer';
import { findLatestMonitorRun, finalizeMonitorRun, startMonitorRun } from './runRepository';
import { sastDateString } from '../parking/sastDate';
import {
  MODULE, applyDelivery, boundedErrorSummary, recordPhaseError, sastMinutesOfDay,
} from './incidentActionShared';
import type { SummaryTotals } from './incidentActionShared';
import type { OperationalFlag, OperationalStatus, OperationalStatusSummary } from '../operations/types';
import type { IncidentActionRunnerRequest, IncidentRule, IncidentType } from './types';

const MORNING_SUMMARY_MINUTE_OF_DAY = 8 * 60 + 15; // 08:15 SAST
const SUMMARY_TYPES: readonly IncidentType[] = ['unassigned', 'unverifiable', 'vehicle_on_site_driver_unconfirmed', 'evidence_gap'];
const DIRECT_SUMMARY_STATUS_TYPES: Partial<Record<OperationalStatus, IncidentType>> = {
  unassigned: 'unassigned', unverifiable: 'unverifiable', vehicle_on_site_driver_unconfirmed: 'vehicle_on_site_driver_unconfirmed',
};
// Signal for design §3.2's "stale/missing expected evidence" — PR4 has no
// dedicated status for it, but these flags are exactly what its evaluator
// sets when required evidence is stale/absent, regardless of status.
const EVIDENCE_GAP_FLAGS: readonly OperationalFlag[] = ['gps_stale', 'gps_missing', 'attendance_missing'];

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

export async function runMorningSummaryPhase(request: IncidentActionRunnerRequest, totals: SummaryTotals): Promise<void> {
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
