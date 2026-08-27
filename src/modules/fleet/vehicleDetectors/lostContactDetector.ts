/**
 * `lost_contact_moving` — the tracker went quiet while the vehicle was moving.
 *
 * PURE: no database, no clock — `now` and the measured cadence both arrive on
 * the context.
 *
 * ## The threshold cannot be a constant, and this is why
 *
 * Measured p90 inter-fix gaps across the four live feeds span 30 s to 160
 * minutes. A fixed 30-minute rule would fire on eleven vehicles every tick
 * forever, which is not an alert, it is a broken cron that nobody can tell from
 * a working one. So the rule's `lost_contact_minutes` is a FLOOR and the real
 * threshold is scaled by the feed's own measured cadence:
 *
 *     effective = max(rule.lostContactMinutes, 3 x p90_gap_minutes)
 *
 * At the seeded floor of 30 that resolves to 30 min for `cartrack/velocity`
 * (p90 30 s) and 374–481 min for the other three feeds, where the signal is not
 * useful. In practice this is a SEVEN-VEHICLE detector. Say so rather than
 * letting the other eleven look broken — and do not "fix" it by restricting to
 * `granularity='history'`: `cartrack/urent` is history and is one of the eleven.
 *
 * The 3x multiplier is the smallest whole multiple that puts the threshold
 * clear of ordinary cadence variation: at 1x, one in ten gaps is already an
 * incident by definition; at 2x, a feed whose gap distribution has any tail at
 * all still fires routinely. It is also above every feed's p99 ingest lag, so a
 * fix that merely arrived late does not read as lost contact.
 *
 * When the cadence cannot be measured (fewer than two fixes in 24 h), the floor
 * stands alone — that vehicle is barely reporting, which is the only case where
 * the raw rule value is the honest answer.
 */

import { buildSourceEventId, calendarDayKey } from './sourceEventId';
import type { DetectedVehicleEvent, VehicleDetectorContext, VehicleOperationalRule } from './types';

const DETECTOR_ID = 'lost_contact_moving';

/** How many p90 gaps of silence count as lost contact. See the header. */
export const GAP_P90_MULTIPLIER = 3;

export function effectiveLostContactMinutes(
  rule: VehicleOperationalRule, gapP90Seconds: number | null,
): number {
  if (gapP90Seconds === null || !Number.isFinite(gapP90Seconds) || gapP90Seconds <= 0) {
    return rule.lostContactMinutes;
  }
  return Math.max(rule.lostContactMinutes, (GAP_P90_MULTIPLIER * gapP90Seconds) / 60);
}

/**
 * Reads `ctx.lastPosition`, NOT the last fix in the window.
 *
 * A vehicle that has been silent for three days has nothing inside the
 * detection window at all, and that silence is the entire signal — a
 * window-only read would make the detector go quiet exactly when it should
 * speak.
 *
 * The bucket key is the SAST calendar day of that fix, NOT its instant. The
 * instant stops moving once contact is lost, so it already deduped the
 * still-silent case — but a FLAPPY unit that reconnects mints a new last-fix
 * instant on every drop, and MW63YBGP opened four incidents in 48 hours that
 * way. Policy (Hein, 2026-08-27): at most ONE `lost_contact_moving` incident
 * per vehicle per SAST calendar day. A calendar day cannot move under the
 * detector, so the producer's dedup on `source_event_id` enforces the cooldown
 * with no new state. The stated cost, same as `prolonged_unauthorized_stop`:
 * a second genuine loss on the same day is silently deduped.
 */
export function detectLostContact(ctx: VehicleDetectorContext): DetectedVehicleEvent[] {
  const last = ctx.lastPosition;
  if (!last) return [];

  const wasMoving = (last.speedKph !== null && last.speedKph > 0) || last.ignition === true;
  if (!wasMoving) return [];

  const silentMs = Date.parse(ctx.now) - Date.parse(last.recordedAt);
  if (!Number.isFinite(silentMs)) return [];
  const silentMinutes = silentMs / 60_000;
  const threshold = effectiveLostContactMinutes(ctx.rule, ctx.gapP90Seconds);
  if (silentMinutes <= threshold) return [];

  return [{
    detectorId: DETECTOR_ID,
    occurredAt: last.recordedAt,
    sourceEventId: buildSourceEventId(DETECTOR_ID, ctx.vehicle.vehicleId, calendarDayKey(last.recordedAt, ctx.rule)),
    lat: last.lat,
    lon: last.lon,
    metadata: {
      vehicleRegistration: ctx.vehicle.registration,
      lastFixAt: last.recordedAt,
      silentMinutes: Math.round(silentMinutes),
      thresholdMinutes: Math.round(threshold),
      floorMinutes: ctx.rule.lostContactMinutes,
      gapP90Seconds: ctx.gapP90Seconds === null ? null : Math.round(ctx.gapP90Seconds),
      lastSpeedKph: last.speedKph,
      lastIgnition: last.ignition,
      provider: last.provider,
      ruleVersion: ctx.rule.version,
    },
  }];
}

/** The async detector shape `vehicleDetectorService` registers. */
export async function lostContactDetector(ctx: VehicleDetectorContext): Promise<DetectedVehicleEvent[]> {
  return detectLostContact(ctx);
}
