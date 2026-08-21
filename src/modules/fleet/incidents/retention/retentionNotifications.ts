/**
 * Hold-review reminders and retention/aggregation health alerts.
 *
 * Three rules shape every payload here:
 *
 *   1. Recipients are hold authority ONLY. A project manager sees a hold badge
 *      on their own incident and cannot act on it; paging them about a
 *      retention decision is exactly what the permission split prevents. When
 *      nobody has authority, this sends NOTHING rather than widening.
 *   2. A payload carries an incident reference, a category, a date, and a
 *      scoped link. No staff name, no hold reason, no driver prose — a bell
 *      notification is read by more eyes than the incident is.
 *   3. An overdue review alerts. It never auto-releases and never deletes.
 *
 * Idempotency is per condition, per subject, per date, so a job that runs
 * every day does not re-page every day for the same unchanged fact.
 */
import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services/notificationBus';
import type { NotifyPayload } from '@/modules/notifications/types';
import { getEffectiveAnalyticsRetentionSettings } from '../analytics/settingsRepository';
import { resolveHoldAuthorityRecipients } from './holdAuthority';
import { listHoldsDueForReview, type DueRetentionHold } from './holdRepository';
import {
  countAgedNonTerminalIncidents, countRepeatedFailedRetentionItems,
  getLatestAggregationRun, getLatestRetentionRun, type AutomationRunHealth,
} from './retentionHealthRepository';

const MODULE = 'FleetRetentionNotifications';
const HOUR_MS = 60 * 60 * 1000;
/** An item that has failed this many times is not a transient storage blip. */
const REPEATED_FAILURE_ATTEMPTS = 3;

export interface RetentionHealthResult {
  notificationsSent: number;
  notificationsFailed: number;
  /** True when no authorised recipient exists: nothing was sent, and that is a condition to fix, not a success. */
  recipientsMissing: boolean;
}

function calendarDay(at: string): string {
  return at.slice(0, 10);
}

function incidentUrl(incidentId: string): string {
  return `/fleet/incidents?incidentId=${incidentId}`;
}

/** Stale means "the window passed with no COMPLETED run": a run still in flight has not failed yet. */
function isStale(run: AutomationRunHealth | null, at: string, warningHours: number): boolean {
  if (!run) return true;
  if (run.status === 'failed' || run.status === 'partial') return true;
  const reference = run.finishedAt ?? run.startedAt;
  return new Date(at).getTime() - new Date(reference).getTime() > warningHours * HOUR_MS;
}

async function dispatch(payload: NotifyPayload, result: RetentionHealthResult): Promise<void> {
  try {
    await notify(payload);
    result.notificationsSent += 1;
  } catch (error) {
    // One failed condition must not silence the rest of the run.
    result.notificationsFailed += 1;
    log.error('[fleet-retention-notifications] notify() threw', {
      event_type: payload.event_type, idempotency_key: payload.idempotency_key,
      error: error instanceof Error ? error.message : String(error),
    }, MODULE);
  }
}

function holdPayload(hold: DueRetentionHold, recipients: string[]): NotifyPayload {
  const condition = hold.overdue ? 'overdue' : 'approaching';
  const reviewDay = calendarDay(hold.nextReviewAt);
  return {
    event_type: 'fleet.retention_hold_review_due',
    title: hold.overdue
      ? `Retention hold review overdue — ${hold.incidentReference}`
      : `Retention hold review due — ${hold.incidentReference}`,
    body: `Category: ${hold.category.replaceAll('_', ' ')}. Review date: ${reviewDay}.`,
    action_url: incidentUrl(hold.incidentId),
    source_module: 'fleet-incidents',
    source_id: hold.incidentId,
    metadata: { incidentReference: hold.incidentReference, category: hold.category, reviewDate: reviewDay, condition },
    recipient_user_ids: recipients,
    idempotency_key: `fleet-retention-hold-review:${hold.holdId}:${reviewDay}:${condition}`,
  };
}

/**
 * Evaluates every retention health condition once and notifies hold authority
 * about the ones that hold. Called after a retention run finalises, and safe
 * to call on its own schedule — the idempotency keys carry the deduplication.
 */
export async function notifyRetentionHealth({ at }: { at: string }): Promise<RetentionHealthResult> {
  const result: RetentionHealthResult = { notificationsSent: 0, notificationsFailed: 0, recipientsMissing: false };
  const policy = await getEffectiveAnalyticsRetentionSettings(at);
  const recipients = await resolveHoldAuthorityRecipients();
  if (recipients.length === 0) {
    result.recipientsMissing = true;
    log.error(
      '[fleet-retention-notifications] no user holds fleet.retention-holds authority — retention health is unmonitored',
      { at }, MODULE,
    );
    return result;
  }

  const dueHolds = await listHoldsDueForReview({ asOf: at, leadDays: policy.holdReviewReminderLeadDays });
  for (const hold of dueHolds) {
    await dispatch(holdPayload(hold, recipients), result);
  }

  const aggregationRun = await getLatestAggregationRun();
  if (isStale(aggregationRun, at, policy.aggregateFreshnessWarningHours)) {
    await dispatch({
      event_type: 'fleet.operational_aggregation_failed',
      title: 'Fleet operational aggregation is not healthy',
      body: aggregationRun
        ? `Last run: ${aggregationRun.status}, ${calendarDay(aggregationRun.finishedAt ?? aggregationRun.startedAt)}. Retention cannot purge without complete aggregate coverage.`
        : 'No aggregation run has been recorded. Retention cannot purge without complete aggregate coverage.',
      action_url: '/fleet/analytics',
      source_module: 'fleet-incidents',
      metadata: { lastStatus: aggregationRun?.status ?? null, freshnessWarningHours: policy.aggregateFreshnessWarningHours },
      recipient_user_ids: recipients,
      idempotency_key: `fleet-operational-aggregation-health:${calendarDay(at)}`,
    }, result);
  }

  const retentionRun = await getLatestRetentionRun();
  const repeatedFailures = await countRepeatedFailedRetentionItems(REPEATED_FAILURE_ATTEMPTS);
  const agedNonTerminal = await countAgedNonTerminalIncidents({ at, retentionMonths: policy.retentionMonths });
  if (isStale(retentionRun, at, policy.retentionFreshnessWarningHours) || repeatedFailures > 0 || agedNonTerminal > 0) {
    await dispatch({
      event_type: 'fleet.operational_retention_failed',
      title: 'Fleet operational retention needs attention',
      body: [
        retentionRun ? `Last run: ${retentionRun.status}.` : 'No retention run has been recorded.',
        repeatedFailures > 0 ? `${repeatedFailures} item(s) have failed repeatedly.` : null,
        agedNonTerminal > 0 ? `${agedNonTerminal} incident(s) past the retention period are still not closed out.` : null,
      ].filter(Boolean).join(' '),
      action_url: '/fleet/incidents',
      source_module: 'fleet-incidents',
      metadata: { lastStatus: retentionRun?.status ?? null, repeatedFailures, agedNonTerminal },
      recipient_user_ids: recipients,
      idempotency_key: `fleet-operational-retention-health:${calendarDay(at)}`,
    }, result);
  }

  return result;
}
