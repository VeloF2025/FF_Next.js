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
    const delivery = await sendMorningSummaryNotification({
      recipientUserId, projectId: bucket.projectId, projectName: bucket.projectName, workDate, items,
    });
    applyDelivery(totals, delivery);
    // Count deliveries, not attempts. The phase is retryable within the day, and a retry
    // re-walks every bucket including the ones that already succeeded — notify() suppresses
    // those by idempotency key, so incrementing unconditionally would report a summary as
    // freshly sent on every tick for the rest of the day. summaries_sent_count is stored as
    // a delivery count, so it has to be one.
    if (delivery.delivered > 0) totals.sent += 1;
  }
}

// True only once a `morning_summary` run for this SAST work date delivered everything it set
// out to. Nothing short of `succeeded` blocks a retry:
//
//   `failed`          — the phase threw; nothing was sent.
//   `running`         — can only be a crashed run, since the cron's advisory lock already
//                       excludes a concurrent second invocation.
//   `partial_failure` — set whenever any bucket threw or any notify() came back failed. Those
//                       are precisely the recipients still owed a summary, so skipping the
//                       rest of the day is the bug this gate exists to prevent, not the
//                       behaviour it wants.
//
// Retrying is safe because every summary carries the idempotency key
// `fleet-morning-summary:{user}:{project}:{date}`, so claimNotification suppresses a recipient
// already reached rather than messaging them twice.
//
// The cost is deliberate: a bucket that can never resolve a recipient — a project with no
// manager assigned — keeps the day in `partial_failure` and re-runs the phase every tick,
// logging each time. That is a configuration fault that should keep complaining. Silence for
// the rest of the day is the worse failure, especially as runStatusMonitorHealthCheck only
// ever inspects `status_monitor` runs and would never surface it.
async function morningSummaryAlreadySentFor(workDate: string): Promise<boolean> {
  const latest = await findLatestMonitorRun('morning_summary');
  if (latest === null || sastDateString(new Date(latest.effectiveAt)) !== workDate) return false;
  return latest.status === 'succeeded';
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
    for (const bucket of buckets.values()) {
      // Per-bucket isolation, matching runEscalationPhase: one project's failure must not
      // cost every later bucket its summary. Without this the loop aborts mid-way and the
      // run finalizes `failed`, so the buckets that were never reached get nothing.
      try {
        await sendSummaryForBucket(bucket, workDate, totals);
      } catch (bucketError) {
        recordPhaseError(totals, '[fleet-incident-actions] morning-summary bucket failed',
          { runId: summaryRun.id, projectId: bucket.projectId }, bucketError);
      }
    }
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
