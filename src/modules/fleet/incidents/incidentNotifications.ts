/**
 * Opened/escalated/resolved/summary/monitor-health notification payloads and
 * idempotency keys for Fleet operational incidents (design §§8.2, 9, 10).
 *
 * Every function here resolves recipients through `recipientService` — the
 * one recipient-resolution path for PR6 — and never mutates incident state;
 * callers are responsible for calling these only after their own incident
 * transaction has committed (design §16: "Notifications only ever after
 * commit").
 *
 * Mandatory WhatsApp for critical explicit-source-event incidents (design
 * §10, and the locked product decision in this task's brief) cannot be
 * expressed through `notify()` alone: `notify()` resolves delivery channels
 * itself from `DEFAULT_CHANNEL_PREFERENCES[event_type]` plus any per-user
 * override and has no per-call channel override (see
 * `src/services/tracking/alerts.ts` and its "encode channel policy in event
 * type" commit for the established precedent) — and
 * `fleet.operational_incident_opened` and `fleet.operational_incident_escalated`
 * are both registered with `whatsapp: false` by default so that routine/high/
 * scheduled incidents never gain WhatsApp by accident — escalating a routine
 * incident must not turn it into a WhatsApp blast either. So for the one case
 * that must always get WhatsApp regardless of that default or a muted
 * per-user preference (a critical incident on an explicit source event, see
 * `requiresMandatoryIncidentWhatsApp` in `./types`), this module places a
 * direct, best-effort WhatsApp send IN ADDITION TO the normal `notify()` call,
 * exactly as the brief specifies ("in addition to configured in-app/email
 * delivery"). A failure there is counted in the returned `NotifyResult.failed`
 * and never thrown.
 *
 * Since PR5 that send goes to the Fleet Alerts WhatsApp group first
 * (`./incidentGroupDelivery`), with the per-user `deliverWhatsApp` fan-out
 * below as its fallback — one post to the group the fleet team already watches
 * beats N DMs, but an unset JID or a failed post must still reach a human.
 */
import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services/notificationBus';
import { claimNotification, releaseNotificationClaim } from '@/modules/notifications/services/notificationIdempotency';
import { deliverWhatsApp } from '@/modules/notifications/services/whatsappDelivery';
import type { NotifyPayload, NotifyResult } from '@/modules/notifications/types';
import { isValidUUID } from '../services/mileageUtils';
import { buildFleetAlertsMessage, postToFleetAlertsGroup } from './incidentGroupDelivery';
import type { FleetAlertsGroupIncident } from './incidentGroupDelivery';
import { resolveIncidentRecipients } from './recipientService';
import { requiresMandatoryIncidentWhatsApp, resolveIncidentOpenedNotification } from './types';
import type {
  IncidentOutcome, IncidentProducerKind, IncidentRule, IncidentSeverity, IncidentType, MonitorRunKind,
} from './types';

const MODULE = 'FleetIncidentNotifications';
const NO_RECIPIENT_RESULT: NotifyResult = { delivered: 0, suppressed: 0, failed: 1 };

// Shared by IncidentType, IncidentOutcome, and MonitorRunKind — all bounded
// snake_case literal unions that read fine with underscores swapped for spaces.
function humanizeCode(value: string): string {
  return value.replaceAll('_', ' ');
}

function reviewUrl(incidentId: string): string {
  return `/fleet/incidents?incidentId=${incidentId}`;
}

function sanitizedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

async function safeNotify(payload: NotifyPayload, logContext: Record<string, unknown>): Promise<NotifyResult> {
  try {
    return await notify(payload);
  } catch (error) {
    log.error('[fleet-incident-notifications] notify() threw', {
      ...logContext, event_type: payload.event_type, error: sanitizedMessage(error),
    }, MODULE);
    return { delivered: 0, suppressed: 0, failed: 1 };
  }
}

// -- Opened -------------------------------------------------------------

export function buildIncidentOpenedIdempotencyKey(incidentId: string): string {
  return `fleet-incident-opened:${incidentId}`;
}

export interface OpenedNotificationInput {
  incidentId: string; incidentType: IncidentType; severity: IncidentSeverity;
  producerKind: IncidentProducerKind; rule: IncidentRule; projectId: string | null;
  staffName: string | null; projectName: string | null; operationalSiteName: string | null;
  detectedAt: string; reasonCodes: readonly string[];
  /** Vehicle registration snapshot for the Fleet Alerts group message (PR5). Scheduled detections have none and never reach the group. */
  vehicleRegistration?: string | null;
  /** Optional: `produceIncident` (Task 3) does not return this on its result, so a caller resolving straight off that result has none to pass. Included in metadata only when known. */
  incidentReference?: string;
}

function openedBody(input: OpenedNotificationInput): string {
  const who = input.staffName ?? 'Unknown staff';
  const where = input.operationalSiteName ?? input.projectName ?? 'Unassigned project';
  const reason = input.reasonCodes.length > 0 ? input.reasonCodes.slice(0, 3).join(', ') : 'review required';
  return `${who} — ${where} — ${reason}`;
}

/**
 * The mandatory-WhatsApp bypass goes straight to deliverWhatsApp, which has no dedup of its
 * own — it sends and logs. Without a claim, anything that re-invokes a notification for the
 * same transition (a retried source-event webhook, an admin resend) would message a critical
 * incident's recipients again every time.
 *
 * The claim namespace is deliberately `${eventType}:whatsapp`, not `eventType`. notify() has
 * already claimed (userId, eventType, key) for the in-app/email fan-out by the time we get
 * here, so reusing that exact triple would return false for every recipient and suppress the
 * WhatsApp leg entirely rather than deduplicate it.
 *
 * Both claim operations are fail-open, and deliberately so: for the one channel a critical
 * incident is guaranteed to reach, delivering twice beats not delivering. A claim that throws
 * is logged and the send proceeds — the alternative is letting a bookkeeping error suppress an
 * accident/SOS notification, and this module's contract is that failures are counted in
 * NotifyResult, never thrown at the caller. A failed send releases its claim so a transient
 * bridge outage does not silence the recipient.
 *
 * Residual risk, accepted rather than hidden: if the send fails AND the release also fails —
 * likely the same underlying outage — the claim is stranded and that recipient's retries stay
 * suppressed. Clearing it needs a TTL or reconciliation on notification_idempotency_claims,
 * which is a change to shared notification infrastructure and out of scope here.
 */
async function sendMandatoryWhatsApp(
  userIds: readonly string[], payload: Omit<NotifyPayload, 'recipient_user_ids'>,
  eventType: string, idempotencyKey: string, logContext: Record<string, unknown>,
): Promise<number> {
  let failed = 0;
  const claimEvent = `${eventType}:whatsapp`;
  for (const userId of userIds) {
    try {
      if (!await claimNotification(userId, claimEvent, idempotencyKey)) continue;
    } catch (claimError) {
      log.error('[fleet-incident-notifications] WhatsApp claim failed; sending anyway', {
        ...logContext, userId, error: sanitizedMessage(claimError),
      }, MODULE);
    }
    try {
      await deliverWhatsApp(userId, { ...payload, recipient_user_ids: [userId] }, null);
    } catch (error) {
      failed += 1;
      log.error('[fleet-incident-notifications] mandatory WhatsApp delivery failed', {
        ...logContext, userId, error: sanitizedMessage(error),
      }, MODULE);
      try {
        await releaseNotificationClaim(userId, claimEvent, idempotencyKey);
      } catch (releaseError) {
        log.error('[fleet-incident-notifications] could not release a WhatsApp claim after a failed send', {
          ...logContext, userId, error: sanitizedMessage(releaseError),
        }, MODULE);
      }
    }
  }
  return failed;
}

interface MandatoryWhatsAppInput {
  incidentId: string; incidentReference: string | null; incidentType: IncidentType;
  vehicleRegistration: string | null; projectName: string | null; detectedAt: string;
  payload: NotifyPayload; userIds: readonly string[]; idempotencyKey: string;
}

/**
 * The mandatory-WhatsApp leg: one post to the Fleet Alerts group, with the
 * per-user DM fan-out above as its fallback (plan §5, PR5). The DM path is
 * injected rather than re-implemented in `incidentGroupDelivery` so the claim
 * and release bookkeeping stays here, and so the import runs one way only.
 * Returns the failure count to fold into `NotifyResult.failed`.
 */
async function deliverMandatoryWhatsApp(input: MandatoryWhatsAppInput): Promise<number> {
  const { recipient_user_ids: _recipients, idempotency_key: _key, ...waPayload } = input.payload;
  const logContext = { incidentId: input.incidentId };
  const groupIncident: FleetAlertsGroupIncident = {
    incidentId: input.incidentId, incidentReference: input.incidentReference,
    incidentType: input.incidentType, vehicleRegistration: input.vehicleRegistration,
    projectName: input.projectName, detectedAt: input.detectedAt,
    eventType: input.payload.event_type, idempotencyKey: input.idempotencyKey,
    recipientUserIds: input.userIds,
    deliverToRecipients: () => sendMandatoryWhatsApp(
      input.userIds, waPayload, input.payload.event_type, input.idempotencyKey, logContext),
  };
  return postToFleetAlertsGroup(groupIncident, buildFleetAlertsMessage(groupIncident));
}

export async function sendIncidentOpenedNotification(input: OpenedNotificationInput): Promise<NotifyResult> {
  const recipients = await resolveIncidentRecipients(input.projectId);
  if (recipients.failed) {
    log.error('[fleet-incident-notifications] no recipient resolved for opened incident', {
      incidentId: input.incidentId, incidentType: input.incidentType, projectId: input.projectId,
    }, MODULE);
    return { ...NO_RECIPIENT_RESULT };
  }

  const plan = resolveIncidentOpenedNotification(input.rule, input.severity, input.producerKind);
  const openedIdempotencyKey = buildIncidentOpenedIdempotencyKey(input.incidentId);
  const payload: NotifyPayload = {
    event_type: 'fleet.operational_incident_opened',
    title: `Fleet incident opened: ${humanizeCode(input.incidentType)}`,
    body: openedBody(input),
    action_url: reviewUrl(input.incidentId),
    source_module: 'fleet-incidents',
    source_id: input.incidentId,
    metadata: {
      incidentReference: input.incidentReference ?? null, incidentType: input.incidentType, severity: input.severity,
      detectedAt: input.detectedAt, reasonCodes: [...input.reasonCodes],
    },
    recipient_user_ids: recipients.userIds,
    idempotency_key: openedIdempotencyKey,
  };
  const result = await safeNotify(payload, { incidentId: input.incidentId });

  if (plan.mandatoryChannels.includes('whatsapp')) {
    result.failed += await deliverMandatoryWhatsApp({
      incidentId: input.incidentId, incidentReference: input.incidentReference ?? null,
      incidentType: input.incidentType, vehicleRegistration: input.vehicleRegistration ?? null,
      projectName: input.projectName, detectedAt: input.detectedAt,
      payload, userIds: recipients.userIds, idempotencyKey: openedIdempotencyKey,
    });
  }

  return result;
}

// -- Escalation -----------------------------------------------------------

export function buildIncidentEscalatedIdempotencyKey(incidentId: string, escalationLevel: number): string {
  return `fleet-incident-escalated:${incidentId}:${escalationLevel}`;
}

export interface EscalationNotificationInput {
  incidentId: string; incidentReference: string; incidentType: IncidentType; severity: IncidentSeverity;
  producerKind: IncidentProducerKind;
  projectId: string | null; staffName: string | null; projectName: string | null;
  operationalSiteName: string | null; escalationLevel: number;
  /** Vehicle registration snapshot and the incident's detection instant — both carried into the Fleet Alerts group message for critical source-event incidents (PR5). */
  vehicleRegistration: string | null; detectedAt: string;
}

export async function sendEscalationNotification(input: EscalationNotificationInput): Promise<NotifyResult> {
  const recipients = await resolveIncidentRecipients(input.projectId);
  if (recipients.failed) {
    log.error('[fleet-incident-notifications] no recipient resolved for escalation', {
      incidentId: input.incidentId, escalationLevel: input.escalationLevel,
    }, MODULE);
    return { ...NO_RECIPIENT_RESULT };
  }
  const who = input.staffName ?? 'Unknown staff';
  const where = input.operationalSiteName ?? input.projectName ?? 'Unassigned project';
  const escalatedIdempotencyKey = buildIncidentEscalatedIdempotencyKey(input.incidentId, input.escalationLevel);
  const payload: NotifyPayload = {
    event_type: 'fleet.operational_incident_escalated',
    title: `Fleet incident escalated (level ${input.escalationLevel}): ${humanizeCode(input.incidentType)}`,
    body: `${who} — ${where} — still unacknowledged at escalation level ${input.escalationLevel}`,
    action_url: reviewUrl(input.incidentId),
    source_module: 'fleet-incidents',
    source_id: input.incidentId,
    metadata: {
      incidentReference: input.incidentReference, incidentType: input.incidentType,
      severity: input.severity, escalationLevel: input.escalationLevel,
    },
    recipient_user_ids: recipients.userIds,
    idempotency_key: escalatedIdempotencyKey,
  };
  const result = await safeNotify(payload, { incidentId: input.incidentId });

  if (requiresMandatoryIncidentWhatsApp(input.severity, input.producerKind)) {
    result.failed += await deliverMandatoryWhatsApp({
      incidentId: input.incidentId, incidentReference: input.incidentReference,
      incidentType: input.incidentType, vehicleRegistration: input.vehicleRegistration,
      projectName: input.projectName, detectedAt: input.detectedAt,
      payload, userIds: recipients.userIds, idempotencyKey: escalatedIdempotencyKey,
    });
  }

  return result;
}

// -- Resolution / dismissal -------------------------------------------------

export function buildIncidentResolvedIdempotencyKey(incidentId: string, outcome: IncidentOutcome): string {
  return `fleet-incident-resolved:${incidentId}:${outcome}`;
}

export interface ResolutionNotificationInput {
  incidentId: string; incidentReference: string; incidentType: IncidentType; severity: IncidentSeverity;
  projectId: string | null; staffName: string | null; lifecycleStatus: 'resolved' | 'dismissed';
  outcome: IncidentOutcome; resolutionNote: string;
}

function boundedNote(note: string): string {
  return note.length > 300 ? `${note.slice(0, 300)}…` : note;
}

export async function sendResolutionNotification(input: ResolutionNotificationInput): Promise<NotifyResult> {
  const recipients = await resolveIncidentRecipients(input.projectId);
  if (recipients.failed) {
    log.error('[fleet-incident-notifications] no recipient resolved for resolution', {
      incidentId: input.incidentId, outcome: input.outcome,
    }, MODULE);
    return { ...NO_RECIPIENT_RESULT };
  }
  const who = input.staffName ?? 'Unknown staff';
  return safeNotify({
    event_type: 'fleet.operational_incident_resolved',
    title: `Fleet incident ${input.lifecycleStatus}: ${humanizeCode(input.incidentType)}`,
    body: `${who} — outcome: ${humanizeCode(input.outcome)}. ${boundedNote(input.resolutionNote)}`,
    action_url: reviewUrl(input.incidentId),
    source_module: 'fleet-incidents',
    source_id: input.incidentId,
    metadata: {
      incidentReference: input.incidentReference, incidentType: input.incidentType,
      lifecycleStatus: input.lifecycleStatus, outcome: input.outcome,
    },
    recipient_user_ids: recipients.userIds,
    idempotency_key: buildIncidentResolvedIdempotencyKey(input.incidentId, input.outcome),
  }, { incidentId: input.incidentId });
}

// -- Morning summary ---------------------------------------------------------

export function buildMorningSummaryIdempotencyKey(recipientUserId: string, projectId: string | null, workDate: string): string {
  return `fleet-morning-summary:${recipientUserId}:${projectId ?? 'unassigned'}:${workDate}`;
}

export interface MorningSummaryGroupInput {
  recipientUserId: string; projectId: string | null; projectName: string | null; workDate: string;
  items: { incidentType: IncidentType; count: number }[];
}

export async function sendMorningSummaryNotification(input: MorningSummaryGroupInput): Promise<NotifyResult> {
  const totalCount = input.items.reduce((sum, item) => sum + item.count, 0);
  const breakdown = input.items.map((item) => `${humanizeCode(item.incidentType)}: ${item.count}`).join(', ');
  const projectLabel = input.projectName ?? 'Unassigned';
  return safeNotify({
    event_type: 'fleet.operational_morning_summary',
    title: `Fleet evidence-gap summary — ${projectLabel}`,
    body: `${totalCount} unresolved condition(s) — ${breakdown}`,
    action_url: input.projectId ? `/fleet/incidents?projectId=${input.projectId}` : '/fleet/incidents?projectId=unassigned',
    source_module: 'fleet-incidents',
    metadata: {
      workDate: input.workDate, projectId: input.projectId, totalCount,
      items: input.items.map((item) => ({ incidentType: item.incidentType, count: item.count })),
    },
    recipient_user_ids: [input.recipientUserId],
    idempotency_key: buildMorningSummaryIdempotencyKey(input.recipientUserId, input.projectId, input.workDate),
  }, { recipientUserId: input.recipientUserId, projectId: input.projectId, workDate: input.workDate });
}

// -- Monitor health -----------------------------------------------------------

/**
 * `occurrenceRef` is the failed run's UUID when there is a run to point at, and a synthetic
 * per-occurrence reference (`missing:<SAST date>`) when there is not. It must never be a
 * constant for the missing-run case: a constant would dedupe the "the monitor is dead"
 * alert permanently after the first day it fired — a silent failure strictly worse than the
 * crash it replaces.
 */
export function buildMonitorFailedIdempotencyKey(runKind: MonitorRunKind, occurrenceRef: string): string {
  return `fleet-monitor-failed:${runKind}:${occurrenceRef}`;
}

/**
 * A missing-run alert has no run to reference, so it MUST carry an `occurrenceKey` instead
 * — `user_notifications.source_id` is a uuid column (migration 192) and anything else
 * written there raises 22P02 inside `notify()`, losing the in-app, email, AND WhatsApp
 * dispatch that share one try block. The union makes that unrepresentable rather than
 * merely documented.
 */
export type MonitorFailedNotificationInput =
  | { runId: string; occurrenceKey?: never; runKind: MonitorRunKind; reason: string }
  | { runId: null; occurrenceKey: string; runKind: MonitorRunKind; reason: string };

export async function sendMonitorFailedNotification(input: MonitorFailedNotificationInput): Promise<NotifyResult> {
  const recipients = await resolveIncidentRecipients(null);
  if (recipients.failed) {
    log.error('[fleet-incident-notifications] no oversight recipient resolved for monitor health', {
      runId: input.runId, runKind: input.runKind,
    }, MODULE);
    return { ...NO_RECIPIENT_RESULT };
  }
  // Defence in depth behind the union type above: a cast or a JavaScript caller can still
  // hand over a non-uuid runId, and the cost of one reaching the uuid column is the total,
  // silent loss of this alert on every channel. Keep the reference in metadata (where it is
  // jsonb and always safe) and warn — never let it reach source_id, never throw.
  let sourceId: string | undefined;
  if (input.runId !== null) {
    if (isValidUUID(input.runId)) {
      sourceId = input.runId;
    } else {
      log.warn('[fleet-incident-notifications] non-uuid runId kept out of source_id', {
        runId: input.runId, runKind: input.runKind,
      }, MODULE);
    }
  }
  const occurrenceRef = sourceId ?? input.occurrenceKey ?? `unreferenced:${input.runId ?? 'missing'}`;
  return safeNotify({
    event_type: 'fleet.operational_monitor_failed',
    // `humanizeCode('status_monitor')` is already "status monitor", so appending
    // " monitor failure" read as "Fleet status monitor monitor failure" in every
    // alert delivered on 2026-08-21.
    title: `Fleet ${humanizeCode(input.runKind)} failure`,
    body: input.reason,
    action_url: '/fleet/incidents',
    source_module: 'fleet-incidents',
    source_id: sourceId,
    metadata: { runKind: input.runKind, runId: input.runId, occurrenceKey: input.occurrenceKey ?? null },
    recipient_user_ids: recipients.userIds,
    idempotency_key: buildMonitorFailedIdempotencyKey(input.runKind, occurrenceRef),
  }, { runId: input.runId, runKind: input.runKind });
}
