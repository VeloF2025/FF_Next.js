/**
 * Fleet Alerts WhatsApp group delivery for the incidents that must always be
 * seen, with the existing per-user DM fan-out as the fallback (plan §5, PR5).
 *
 * Only incidents for which `requiresMandatoryIncidentWhatsApp(severity,
 * producerKind)` holds — a critical source-event incident, i.e. `accident_sos`
 * and `theft_after_hours_movement` — reach this module. `incidentNotifications`
 * owns that predicate and this module never re-derives it.
 *
 * Contract, inherited from `incidentNotifications`: this never throws at its
 * caller. Every failure is returned as a count that the caller folds into
 * `NotifyResult.failed`.
 *
 * The group JID is read from `FLEET_ALERTS_WA_GROUP_JID` (precedent:
 * `OPS_REVIEW_WA_GROUP_JID` in `src/lib/group-nonactivation/delivery.ts`) and
 * deliberately has NO hardcoded default: an unset JID takes the DM fallback,
 * which is today's behaviour and therefore the rollback path.
 *
 * ACCEPTED CONSEQUENCE, stated rather than buried: on a successful group post
 * NO DMs are sent, so a resolved recipient who is not a member of the Fleet
 * Alerts group gets no WhatsApp at all for that incident. They still get the
 * in-app and email notification `notify()` sent. This is the chosen trade —
 * one post to the channel the fleet team actually watches beats N DMs — but it
 * makes group membership an out-of-band delivery dependency that RBAC does not
 * govern: adding someone to the incident recipients does not add them to the
 * group, and removing them from FibreFlow does not remove them from it. The
 * recipients covered by each post are logged so the gap stays auditable.
 *
 * Disclosure: the group message is strictly LESS revealing than the DM it
 * replaces — the DM body already names the staff member (`openedBody`), and
 * this message names only the vehicle. But it goes to whoever is in the group,
 * which is a wider and unmanaged audience, so nothing beyond the incident
 * reference, type, vehicle, project, and time belongs in it.
 */
import { log } from '@/lib/logger';
import { claimNotification, releaseNotificationClaim } from '@/modules/notifications/services/notificationIdempotency';
import { logDelivery, sendWhatsAppGroup } from '@/modules/notifications/services/whatsappDelivery';
import type { IncidentType } from './types';

const MODULE = 'FleetIncidentGroupDelivery';

/** Distinct from `sendMandatoryWhatsApp`'s per-user `${eventType}:whatsapp`. Reusing that triple would find the claim already taken and suppress the group post entirely instead of deduplicating it. */
const GROUP_CLAIM_SUFFIX = 'wa_group';

export interface FleetAlertsGroupIncident {
  incidentId: string;
  incidentReference: string | null;
  incidentType: IncidentType;
  vehicleRegistration: string | null;
  projectName: string | null;
  /** ISO instant; rendered as SAST wall-clock in the message. */
  detectedAt: string;
  /** Notification event type — the first element of the claim namespace. */
  eventType: string;
  /** The same idempotency key the in-app/email fan-out used for this transition. */
  idempotencyKey: string;
  recipientUserIds: readonly string[];
  /** The EXISTING per-user `deliverWhatsApp` path, injected by the caller so the claim/release bookkeeping stays in one place. Returns its failure count. */
  deliverToRecipients: () => Promise<number>;
}

function sastTimestamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const at = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')} SAST`;
}

function reviewLink(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';
  return `${base}/fleet/incidents`;
}

/**
 * The group is an operational channel, not a disciplinary one: no driver name,
 * no coordinates, no raw telematics — the same restraint the DM payload already
 * observes. The registration is the vehicle snapshot, which is what an
 * operator needs to act on an accident or a theft alert.
 */
export function buildFleetAlertsMessage(incident: FleetAlertsGroupIncident): string {
  return [
    `🚨 *Fleet incident — ${incident.incidentType.replaceAll('_', ' ')}*`,
    `Ref: ${incident.incidentReference ?? 'pending'}`,
    `Vehicle: ${incident.vehicleRegistration ?? 'not recorded'}`,
    `Project: ${incident.projectName ?? 'Unassigned'}`,
    `Detected: ${sastTimestamp(incident.detectedAt)}`,
    '',
    reviewLink(),
  ].join('\n');
}

/**
 * The claims table's `user_id` is `NOT NULL REFERENCES users(id)` (migration
 * 496), so a group post — which has no user — must anchor its claim on a real
 * one. The lexicographically smallest recipient is used rather than the first,
 * so the anchor does not move when recipient resolution returns the same set in
 * a different order and let a second post through.
 */
function claimHolder(userIds: readonly string[]): string | null {
  if (userIds.length === 0) return null;
  return [...userIds].sort()[0] ?? null;
}

/**
 * Post one incident to the Fleet Alerts group, falling back to the per-user DM
 * path when it cannot be posted. Returns the delivery failures to add to `NotifyResult.failed`.
 *
 * A failed group post counts as one failure even when the DM fallback then
 * succeeds: a WhatsApp bridge outage must stay visible in the run totals rather
 * than being masked by the fallback that covered for it. An UNSET JID is not a
 * failure — it is a configuration state (the rollback path), so it only warns.
 *
 * Claims are fail-open exactly as `sendMandatoryWhatsApp` documents: for the one
 * channel a critical incident is guaranteed to reach, posting twice beats not
 * posting. A failed post releases its claim so a transient outage does not
 * silence the retry.
 */
export async function postToFleetAlertsGroup(
  incident: FleetAlertsGroupIncident, message: string,
): Promise<number> {
  const logContext = { incidentId: incident.incidentId, eventType: incident.eventType };
  const groupJid = process.env.FLEET_ALERTS_WA_GROUP_JID?.trim();
  if (!groupJid) {
    log.warn('[fleet-incident-group] FLEET_ALERTS_WA_GROUP_JID unset — delivering to recipients individually', logContext, MODULE);
    return incident.deliverToRecipients();
  }

  const holder = claimHolder(incident.recipientUserIds);
  const claimEvent = `${incident.eventType}:${GROUP_CLAIM_SUFFIX}`;
  if (holder) {
    try {
      if (!await claimNotification(holder, claimEvent, incident.idempotencyKey)) return 0;
    } catch (claimError) {
      log.error('[fleet-incident-group] group claim failed; posting anyway', {
        ...logContext, error: sanitizedMessage(claimError),
      }, MODULE);
    }
  }

  try {
    await sendWhatsAppGroup(groupJid, message);
    // F3's audit trail: who this one post stood in for. Without it, "was this
    // person told?" is unanswerable for anybody outside the group.
    log.info('[fleet-incident-group] posted to the Fleet Alerts group', {
      ...logContext, coveredByGroupPost: [...incident.recipientUserIds],
    }, MODULE);
    await recordGroupDelivery(holder, groupJid, 'sent', null, logContext);
    return 0;
  } catch (error) {
    log.error('[fleet-incident-group] group post failed; falling back to individual delivery', {
      ...logContext, error: sanitizedMessage(error),
    }, MODULE);
    if (holder) {
      try {
        await releaseNotificationClaim(holder, claimEvent, incident.idempotencyKey);
      } catch (releaseError) {
        log.error('[fleet-incident-group] could not release the group claim after a failed post', {
          ...logContext, error: sanitizedMessage(releaseError),
        }, MODULE);
      }
    }
    await recordGroupDelivery(holder, groupJid, 'failed', sanitizedMessage(error), logContext);
    return 1 + await incident.deliverToRecipients();
  }
}

/**
 * One `notification_delivery_log` row per group post, so "did the SOS alert go
 * out?" is answerable from the database and not only from the application log.
 * The row is attributed to the claim anchor because `user_id` is NOT NULL
 * (migration 192); `recipient_address` carries the group JID, which is what
 * distinguishes a group post from a DM in that table — the same convention
 * `deliverWhatsApp` already uses for its own group sends.
 *
 * Bookkeeping must never change the delivery outcome, so a failure here is
 * logged and swallowed: the message was still sent (or still failed) either way.
 */
async function recordGroupDelivery(
  holder: string | null, groupJid: string, status: 'sent' | 'failed',
  errorMessage: string | null, logContext: Record<string, unknown>,
): Promise<void> {
  if (!holder) return;
  try {
    await logDelivery(null, holder, 'whatsapp', status, groupJid,
      errorMessage === null ? null : `fleet alerts group post: ${errorMessage}`);
  } catch (logError) {
    log.error('[fleet-incident-group] could not record the group post in the delivery log', {
      ...logContext, status, error: sanitizedMessage(logError),
    }, MODULE);
  }
}

function sanitizedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}
