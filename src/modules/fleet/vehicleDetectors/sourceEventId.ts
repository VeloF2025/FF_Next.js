/**
 * The deterministic identity of a detected event.
 *
 * `produceIncident` dedups source events on `(incident_type, source_event_id)`
 * and returns `unchanged` for a repeat, so this file — not the producer, and
 * not a database constraint the detectors could reach — is what decides whether
 * a condition that is still true five minutes later opens a SECOND incident.
 *
 * The rule: the id is a function of WHICH VEHICLE and WHICH OCCURRENCE, and of
 * nothing else. No `Date.now()`, no UUID, no tick counter. A detector that
 * fires on a still-present condition every tick must produce the same id every
 * tick, or the 5-minute cron mints 288 incidents a day out of one event.
 *
 * "Which occurrence" is a BUCKET, and each detector's bucket is chosen so that
 * it cannot move under the detector's own feet as the window slides:
 *
 *   theft_after_hours_movement   the after-hours window's start instant, derived
 *                                from the CALENDAR (see `afterHoursWindowKey`),
 *                                not from the earliest loaded fix — one incident
 *                                per vehicle per night however the window slides.
 *   severe_driving               the fix's `provider_event_id`, which is already
 *                                unique per event within its feed.
 *   prolonged_unauthorized_stop  the SAST calendar day the stop was observed to
 *                                start in — NOT the observed start instant, which
 *                                slides. See `calendarDayKey`.
 *   lost_contact_moving          the SAST calendar day of the last known fix —
 *                                the instant alone deduped a still-silent
 *                                vehicle but let a flappy unit that reconnects
 *                                mint a fresh instant per drop (MW63YBGP: four
 *                                incidents in 48 h). One per vehicle per SAST
 *                                day. See `calendarDayKey`.
 *   accident_sos                 no source; the detector is a stub.
 */

import { secondsOfDay, zonedDateParts } from './afterHours';
import type { VehicleDetectorId, VehicleOperationalRule } from './types';

/**
 * `${detectorId}:${vehicleId}:${bucketKey}`.
 *
 * The parts are joined with `:` and never escaped, and several of them CONTAIN
 * colons (an ISO instant does, and a provider id may). That is harmless because
 * the id is never parsed — it is an opaque equality key, matched whole against
 * `fleet_operational_incidents.source_event_id`. Two different occurrences
 * cannot collide on one string regardless: `detectorId` is a closed union with a
 * fixed prefix, `vehicleId` is a fixed-width UUID, and what follows is one
 * detector's own key space. Do not add a parser; if a caller ever needs the
 * parts back, they belong in `metadata`, not in a split() on this.
 *
 * The empty-key guard is here because an empty key silently collapses every
 * occurrence for a vehicle into a single incident.
 */
export function buildSourceEventId(
  detectorId: VehicleDetectorId, vehicleId: string, bucketKey: string,
): string {
  const key = bucketKey.trim();
  if (!key) throw new Error(`${detectorId}: a source-event bucket key may not be empty`);
  if (!vehicleId.trim()) throw new Error(`${detectorId}: a source-event id needs a vehicle`);
  return `${detectorId}:${vehicleId}:${key}`;
}

/**
 * The start of the after-hours window that contains `instantIso`, as
 * `YYYY-MM-DDTHH:MM:SS` in the rule's timezone.
 *
 * Calendar-derived on purpose. The obvious alternative — "the earliest
 * after-hours fix currently loaded" — is not stable: the detection window
 * slides forward every tick, so the earliest loaded fix eventually falls out of
 * it, the key changes, and the same night's movement opens a second incident
 * some hours later.
 *
 * The window WRAPS midnight (18:00 → 06:00), so an instant before the day's
 * start time belongs to the PREVIOUS day's window. An instant that is
 * after-hours only because it is a weekend or a public holiday is bucketed by
 * the same clock rule, which gives at most one theft incident per vehicle per
 * calendar night — the granularity a human on the receiving end can act on.
 */
export function afterHoursWindowKey(instantIso: string, rule: VehicleOperationalRule): string {
  const at = zonedDateParts(instantIso, rule.timezone);
  const start = secondsOfDay(rule.afterHoursStartTime);
  const clock = normaliseClock(rule.afterHoursStartTime);
  if (at.secondsOfDay >= start) return `${at.date}T${clock}`;
  return `${previousDate(at.date)}T${clock}`;
}

/**
 * The `YYYY-MM-DD` calendar day of `instantIso` in the rule's timezone.
 *
 * Exists because a sliding window makes an OBSERVED instant an unstable bucket.
 * `prolonged_unauthorized_stop` anchors a stop on the first qualifying fix it
 * can see, and for a stop that began before the window opened that fix is the
 * window's own edge — which moves forward every tick. Bucketing on it minted a
 * fresh `sourceEventId` per tick: measured at four ticks over thirteen hours,
 * four ids, and at a five-minute cadence that is twelve incidents an hour for
 * one parked vehicle.
 *
 * A calendar day cannot move as the window slides, so the guarantee is exact
 * and worth stating plainly: **at most one `prolonged_unauthorized_stop`
 * incident per vehicle per SAST day.** A vehicle parked Friday through Monday
 * opens at most four — one each day it is still stopped — rather than one every
 * five minutes.
 *
 * The cost, stated rather than hidden: two genuinely separate unauthorized stops
 * by one vehicle on one day are ONE incident, and the second is silently
 * deduped. That is the price of a key that provably cannot move, and it fails
 * quiet (an under-report) rather than loud. A finer bucket would have to be
 * derived from something equally stable — the stop's location on a grid was
 * considered and rejected, because a grid edge between two anchors 50 m apart
 * reintroduces exactly the duplicate this replaced.
 */
export function calendarDayKey(instantIso: string, rule: VehicleOperationalRule): string {
  return zonedDateParts(instantIso, rule.timezone).date;
}

/** `HH:MM` or `HH:MM:SS` → `HH:MM:SS`, so one rule cannot produce two spellings of one bucket. */
function normaliseClock(clockTime: string): string {
  const total = secondsOfDay(clockTime);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/**
 * The calendar day before `YYYY-MM-DD`.
 *
 * Done in UTC on a date-only value deliberately: this is calendar arithmetic on
 * a label that has ALREADY been resolved into the rule's timezone by
 * `zonedDateParts`, so there is no zone left to get wrong. Re-entering a
 * timezone here is what would reintroduce the off-by-one-day trap.
 */
function previousDate(date: string): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime())) throw new Error(`Not a calendar date: ${date}`);
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}
