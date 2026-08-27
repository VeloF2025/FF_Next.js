/**
 * Monday 08:30 SAST weekly fleet digest — one WhatsApp text to the Fleet Alerts group covering
 * the previous Monday–Sunday SAST week, from `fleet_vehicle_daily_stats` and
 * `fleet_operational_incidents`. A fifth phase on the `fleet-incident-actions` tick, isolated
 * exactly as `vehicleSummaryPhase` is: its own try/catch in `actionRunner`, so a failure here
 * never blocks or degrades escalation, the roster summary, the vehicle summary, or the health
 * check, and never touches their totals.
 *
 * ## Group only — no DM fan-out
 *
 * The daily vehicle summary fans out to each recipient in parallel with its group post. This one
 * deliberately does not. It is a weekly management read rather than an alert: nobody needs to be
 * reached about it out-of-band, and N DMs of the same 20-line digest every Monday is noise, not
 * redundancy. An unset `FLEET_ALERTS_WA_GROUP_JID` therefore has nowhere to fall back to, so the
 * phase warns and skips — and does NOT take the claim, so configuring the JID later still gets
 * that week's digest rather than finding the week already claimed by the ticks that ran without one.
 *
 * ## No migration, no run row — the same call the vehicle summary made, for the same reason
 *
 * `fleet_operational_monitor_runs_kind_check` (migration 510) admits only `status_monitor`,
 * `escalation` and `morning_summary`; a `weekly_digest` kind would need a migration purely for
 * bookkeeping. The once-per-week guard is instead the group post's own notification claim, keyed
 * `fleet-weekly-digest:<weekStart>` where `weekStart` is the MONDAY OF THE WEEK SUMMARISED — one
 * week per key, and the key names the week a reader would go looking for. A per-DAY key would let
 * a second digest out on Tuesday; the phase's Monday gate is what stops that today, and the claim
 * is what stops the 08:30, 08:35 and 08:40 ticks of the same Monday from posting three times.
 *
 * Claims are fail-open, per `incidentGroupDelivery`'s documented policy: for the one channel this
 * digest reaches, posting twice beats not posting. A failed post releases its claim, so a
 * WhatsApp bridge outage at 08:30 is retried by the 08:35 tick rather than silencing the week.
 *
 * The cost, stated: the two aggregate queries re-run on every tick from 08:30 Monday until
 * midnight, and every one after the first is claim-suppressed before it sends anything. Two
 * indexed aggregates over seven days is cheap, and nothing is sent twice.
 */
import { log } from '@/lib/logger';
import { sastDateString } from '../parking/sastDate';
import { sastMidnightIso, sastMinutesOfDay, sastWeekday, shiftSastDate } from './incidentActionShared';
import { postToFleetAlertsGroupResult } from './incidentGroupDelivery';
import { VEHICLE_MORNING_SUMMARY_EVENT } from './incidentNotifications';
import { resolveIncidentRecipients } from './recipientService';
import { buildWeeklyDigestMessage } from './weeklyDigestMessage';
import { loadWeeklyIncidentCounts, loadWeeklyVehicleTotals } from './weeklyDigestQueries';
import type { IncidentActionRunnerRequest, WeeklyDigestResult } from './types';

const MODULE = 'FleetWeeklyDigestPhase';
const DIGEST_WEEKDAY = 1; // Monday, in `Date.getUTCDay()` numbering
const DIGEST_MINUTE_OF_DAY = 8 * 60 + 30; // 08:30 SAST
const DAYS_IN_WEEK = 7;

export interface WeeklyDigestWindow {
  /** Monday that opens the week summarised. */
  weekStart: string;
  /** Sunday that closes it, inclusive — what the message shows a human. */
  weekEnd: string;
  /** The Monday AFTER `weekEnd`, i.e. the digest's own day. Every query bound is `< this`, never `<=`. */
  weekEndExclusive: string;
}

/**
 * The completed week behind a Monday tick.
 *
 * `weekEndExclusive` is the tick's own SAST date: the digest is sent ON the Monday that opens the
 * next week, so that Monday is the first instant NOT in the window. Including it would count the
 * digest morning's own incidents here and again in next week's digest.
 */
export function weeklyDigestWindow(sastDate: string): WeeklyDigestWindow {
  return {
    weekStart: shiftSastDate(sastDate, -DAYS_IN_WEEK),
    weekEnd: shiftSastDate(sastDate, -1),
    weekEndExclusive: sastDate,
  };
}

/**
 * Null when the tick is not a Monday at or after 08:30 SAST — the phase did not run at all, which
 * is not a result. Both halves are read in SAST: a UTC weekday would fire the digest at 02:00
 * SAST Monday (22:00 UTC Sunday is still Sunday in UTC) and skip the real Monday morning.
 */
export function weeklyDigestIsDue(effectiveAt: string): boolean {
  const sastDate = sastDateString(new Date(effectiveAt));
  return sastWeekday(sastDate) === DIGEST_WEEKDAY && sastMinutesOfDay(effectiveAt) >= DIGEST_MINUTE_OF_DAY;
}

export async function runWeeklyDigestPhase(
  request: IncidentActionRunnerRequest,
): Promise<WeeklyDigestResult | null> {
  if (!weeklyDigestIsDue(request.effectiveAt)) return null;
  const window = weeklyDigestWindow(sastDateString(new Date(request.effectiveAt)));

  // Checked here as well as inside `postToFleetAlertsGroupResult` so the skip is reported
  // honestly: this phase has no DM fallback, so an unset JID means nobody was reached, and
  // returning it as a zero-failure post would read as a delivered digest.
  if (!process.env.FLEET_ALERTS_WA_GROUP_JID?.trim()) {
    log.warn('[fleet-weekly-digest] FLEET_ALERTS_WA_GROUP_JID unset — weekly digest not sent', {
      weekStart: window.weekStart,
    }, MODULE);
    return { ...window, delivered: 0, failed: 0, groupPostFailed: false, skippedNoGroupJid: true };
  }

  const [vehicles, incidentCounts, recipients] = await Promise.all([
    loadWeeklyVehicleTotals(window.weekStart, window.weekEndExclusive),
    loadWeeklyIncidentCounts(sastMidnightIso(window.weekStart), sastMidnightIso(window.weekEndExclusive)),
    resolveIncidentRecipients(null),
  ]);

  // The claim anchors on a real user id (`notification_idempotency_claims.user_id` is NOT NULL),
  // so with no recipient there is nothing to anchor on and the digest would post on every tick.
  if (recipients.failed) {
    log.error('[fleet-weekly-digest] no recipient resolved — weekly digest not sent', {
      weekStart: window.weekStart,
    }, MODULE);
    return { ...window, delivered: 0, failed: 1, groupPostFailed: false, skippedNoGroupJid: false };
  }

  const outcome = await postToFleetAlertsGroupResult({
    incidentId: `weekly-digest:${window.weekStart}`,
    // The registered `fleet.operational_morning_summary` event, reused rather than invented:
    // the claim triple is (user, `<event>:wa_group`, key) and the key below is in its own
    // `fleet-weekly-digest:` namespace, so it cannot collide with either summary's claims. A new
    // event constant would have to be registered in `notifications/constants` to buy nothing.
    eventType: VEHICLE_MORNING_SUMMARY_EVENT,
    idempotencyKey: `fleet-weekly-digest:${window.weekStart}`,
    recipientUserIds: recipients.userIds,
    // Group-only by design (see the header): there is no per-user fan-out to fall back to.
    deliverToRecipients: () => Promise.resolve(0),
  }, buildWeeklyDigestMessage({
    weekStart: window.weekStart, weekEnd: window.weekEnd, vehicles, incidentCounts,
  }));

  const result: WeeklyDigestResult = {
    ...window,
    // A delivery, never an attempt: from the second tick of the morning this is 0 because the
    // claim suppressed the post, not because anything went wrong.
    delivered: outcome.posted ? 1 : 0,
    failed: outcome.failures,
    groupPostFailed: outcome.failures > 0,
    skippedNoGroupJid: false,
  };
  log.info('[fleet-weekly-digest] weekly digest tick complete', {
    ...result, vehicleCount: vehicles.length, suppressed: outcome.skipped === 'already_claimed',
  }, MODULE);
  return result;
}
