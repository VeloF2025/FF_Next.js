/**
 * Driver-input notification payloads and idempotency keys (design §§8, 10,
 * and this task's locked notification rules).
 *
 * Both events here are routine — in-app and email only, never WhatsApp
 * (registered `whatsapp: false` in `notifications/constants/index.ts`,
 * Task 1). The mandatory-WhatsApp bypass in `../incidentNotifications.ts`
 * exists only for critical explicit-source-event incidents; it is
 * deliberately not reused or extended here.
 *
 * Every call to `notify()` carries an `idempotency_key`, so `notify()`
 * itself claims `(userId, event_type, idempotency_key)` via
 * `claimNotification` before dispatching (see
 * `notificationBus.ts#notify`) — a retried caller cannot re-notify a
 * recipient who was already reached for the same key. Callers here are
 * responsible for invoking these functions only after their own incident
 * transaction has already committed (CLAUDE.md hard rule: notifications
 * never fire from inside a transaction that might still roll back).
 *
 * `notifyDriverResponseReceived` takes an already-resolved `recipientIds`
 * list rather than resolving recipients itself — recipient resolution
 * (`../recipientService.resolveIncidentRecipients`) is the caller's
 * responsibility (`./submissionService`, PR7 Task 4), exactly as this
 * task's brief specifies the function's shape.
 *
 * There is deliberately no "incident opened" notification for a driver
 * anywhere in this module: design §18 — a driver is notified only after an
 * authorized manager requests their input, never when an incident is first
 * detected or opened.
 */
import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services/notificationBus';
import type { NotifyPayload, NotifyResult } from '@/modules/notifications/types';
import type { DriverSubmissionKind } from './types';

const MODULE = 'FleetDriverInputNotifications';
const NO_RECIPIENT_RESULT: NotifyResult = { delivered: 0, suppressed: 0, failed: 1 };

function sanitizedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

/** Never throws — a notification failure must not turn an already-committed request/submission into a 500 for its caller. */
async function safeNotify(payload: NotifyPayload, logContext: Record<string, unknown>): Promise<NotifyResult> {
  try {
    return await notify(payload);
  } catch (error) {
    log.error('[fleet-driver-input-notifications] notify() threw', {
      ...logContext, event_type: payload.event_type, error: sanitizedMessage(error),
    }, MODULE);
    return { delivered: 0, suppressed: 0, failed: 1 };
  }
}

function driverIncidentUrl(incidentId: string): string { return `/my/fleet/incidents/${incidentId}`; }
function managerIncidentUrl(incidentId: string): string { return `/fleet/incidents?incidentId=${incidentId}`; }

function neutralWhere(projectLabel: string | null, siteLabel: string | null): string {
  return siteLabel ?? projectLabel ?? 'your assignment';
}

// -- Driver input requested --------------------------------------------

export function buildDriverInputRequestedKey(inputRequestId: string, driverUserId: string): string {
  return `fleet-driver-input-requested:${inputRequestId}:${driverUserId}`;
}

export interface DriverInputRequestNotificationRequest {
  inputRequestId: string;
  guidance: string | null;
  respondBy: string;
}

export interface DriverInputRequestNotificationIncident {
  incidentId: string;
  incidentReference: string;
  neutralLabel: string;
  projectLabel: string | null;
  siteLabel: string | null;
}

/**
 * `driverUserId` is `null` when the driver's staff record has no linked
 * FibreFlow account — the request is recorded regardless (its own
 * transaction already committed); this only reports that nobody could be
 * reached, exactly as `../recipientService.resolveIncidentRecipients`
 * reports an empty recipient set for PR6.
 */
export async function notifyDriverInputRequested(
  request: DriverInputRequestNotificationRequest,
  incident: DriverInputRequestNotificationIncident,
  driverUserId: string | null,
): Promise<NotifyResult> {
  if (!driverUserId) {
    log.error('[fleet-driver-input-notifications] driver has no linked user account; request recorded without notification', {
      inputRequestId: request.inputRequestId, incidentId: incident.incidentId,
    }, MODULE);
    return { ...NO_RECIPIENT_RESULT };
  }
  const where = neutralWhere(incident.projectLabel, incident.siteLabel);
  const payload: NotifyPayload = {
    event_type: 'fleet.driver_input_requested',
    title: 'A manager has asked you to respond to a Fleet record',
    body: `${incident.neutralLabel} — ${where}. Please respond by ${new Date(request.respondBy).toLocaleDateString('en-ZA')}.`,
    action_url: driverIncidentUrl(incident.incidentId),
    source_module: 'fleet-incidents',
    source_id: incident.incidentId,
    metadata: {
      incidentReference: incident.incidentReference, neutralLabel: incident.neutralLabel,
      respondBy: request.respondBy, guidance: request.guidance,
    },
    recipient_user_ids: [driverUserId],
    idempotency_key: buildDriverInputRequestedKey(request.inputRequestId, driverUserId),
  };
  return safeNotify(payload, { inputRequestId: request.inputRequestId, incidentId: incident.incidentId });
}

// -- Driver response received --------------------------------------------

export function buildDriverResponseReceivedKey(submissionId: string, recipientUserId: string): string {
  return `fleet-driver-response-received:${submissionId}:${recipientUserId}`;
}

export interface DriverResponseReceivedNotificationSubmission {
  submissionId: string;
  submissionKind: DriverSubmissionKind;
}

export interface DriverResponseReceivedNotificationIncident {
  incidentId: string;
  incidentReference: string;
  neutralLabel: string;
  projectLabel: string | null;
  siteLabel: string | null;
}

/**
 * One `notify()` call per recipient — each recipient's idempotency key
 * embeds their own user id (`buildDriverResponseReceivedKey`), so a single
 * shared key across a multi-recipient `notify()` call would not match this
 * task's required key format. Results are summed across recipients.
 */
export async function notifyDriverResponseReceived(
  submission: DriverResponseReceivedNotificationSubmission,
  incident: DriverResponseReceivedNotificationIncident,
  recipientIds: readonly string[],
): Promise<NotifyResult> {
  if (recipientIds.length === 0) {
    log.error('[fleet-driver-input-notifications] no recipient resolved for a driver response', {
      submissionId: submission.submissionId, incidentId: incident.incidentId,
    }, MODULE);
    return { ...NO_RECIPIENT_RESULT };
  }
  const where = neutralWhere(incident.projectLabel, incident.siteLabel);
  const kindLabel = submission.submissionKind === 'follow_up' ? 'follow-up' : 'response';
  const result: NotifyResult = { delivered: 0, suppressed: 0, failed: 0 };
  for (const recipientUserId of recipientIds) {
    const payload: NotifyPayload = {
      event_type: 'fleet.driver_response_received',
      title: `Driver ${kindLabel} received: ${incident.neutralLabel}`,
      body: `${where} — a driver ${kindLabel} is ready for review.`,
      action_url: managerIncidentUrl(incident.incidentId),
      source_module: 'fleet-incidents',
      source_id: incident.incidentId,
      metadata: { incidentReference: incident.incidentReference, submissionKind: submission.submissionKind },
      recipient_user_ids: [recipientUserId],
      idempotency_key: buildDriverResponseReceivedKey(submission.submissionId, recipientUserId),
    };
    const single = await safeNotify(payload, { submissionId: submission.submissionId, incidentId: incident.incidentId, recipientUserId });
    result.delivered += single.delivered;
    result.suppressed += single.suppressed;
    result.failed += single.failed;
  }
  return result;
}
