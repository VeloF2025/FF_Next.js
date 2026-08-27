/**
 * `theft_after_hours_movement` — a vehicle that drove itself somewhere after hours.
 *
 * PURE: no database, no clock. Everything arrives on the context.
 *
 * This is one of only two telematics types migration 529 leaves at
 * `severity='critical'`, which means every event this file emits sends a
 * WhatsApp to a human, immediately, possibly at 02:00. Every gate below exists
 * to stop that happening for something that is not a theft:
 *
 *   after-hours       from `isAfterHours`, which reads the versioned rule's
 *                     wrapping window, weekends and the real public-holiday table.
 *   not exempt        `fleet_vehicles.after_hours_exempt` (migration 529) — the
 *                     standby and after-hours-duty vehicles opt out here, and
 *                     without this check the detector pages someone every night
 *                     for a vehicle that is SUPPOSED to be out.
 *   ignition on       a towed or transported vehicle reports movement with the
 *                     ignition off; that is a different (unbuilt) detector, and
 *                     firing this one for it would teach people to ignore it.
 *   >= theft_min_positions fixes   a single GPS blip is not a journey.
 *   displacement > theft_displacement_meters   measured from the window's FIRST
 *                     qualifying fix, straight line.
 *
 * ## Why straight-line displacement and not path length
 *
 * "Cumulative path distance" is the tempting reading, and on the dense feed it
 * is a false-positive machine: `cartrack/velocity` reports a median 8-second
 * gap (~1,169 fixes/vehicle-day), so a vehicle standing still with its engine
 * running — an after-hours generator run, a driver waiting — accumulates GPS
 * jitter of a few metres per fix, which crosses a 500 m path budget in under
 * twenty minutes without the vehicle having moved at all. Straight-line
 * displacement from the window's first fix is immune to that: jitter cancels,
 * distance does not. A thief who drives a loop and returns before dawn is the
 * documented blind spot, and it is the right trade for a channel that wakes
 * people up.
 */

import { haversineDistanceM } from '@/lib/geo';
import { isAfterHours } from './afterHours';
import { afterHoursWindowKey, buildSourceEventId } from './sourceEventId';
import type { DetectedVehicleEvent, DetectorPosition, VehicleDetectorContext } from './types';

const DETECTOR_ID = 'theft_after_hours_movement';

interface Located extends DetectorPosition {
  lat: number;
  lon: number;
}

function hasFix(p: DetectorPosition): p is Located {
  return p.lat !== null && p.lon !== null;
}

/**
 * At most one event per after-hours window per vehicle.
 *
 * Firing at the first fix that crosses BOTH thresholds (not at the largest
 * displacement in the window) is deliberate: the incident is dated when the
 * theft became detectable, and a later, further fix in the same night must not
 * move `occurredAt` — the bucket key would still dedup it, but the incident's
 * own timestamp would drift backwards and forwards between ticks.
 */
export function detectTheftAfterHoursMovement(ctx: VehicleDetectorContext): DetectedVehicleEvent[] {
  if (ctx.vehicle.afterHoursExempt) return [];

  const events: DetectedVehicleEvent[] = [];
  const firedWindows = new Set<string>();
  const windows = new Map<string, { anchor: Located; count: number }>();

  for (const position of ctx.positions) {
    if (position.ignition !== true) continue;
    if (!hasFix(position)) continue;
    if (!isAfterHours(position.recordedAt, ctx.rule, ctx.holidays)) continue;

    const windowKey = afterHoursWindowKey(position.recordedAt, ctx.rule);
    const window = windows.get(windowKey) ?? { anchor: position, count: 0 };
    window.count += 1;
    windows.set(windowKey, window);
    if (firedWindows.has(windowKey)) continue;
    if (window.count < ctx.rule.theftMinPositions) continue;

    const displacement = haversineDistanceM(
      { lat: window.anchor.lat, lon: window.anchor.lon },
      { lat: position.lat, lon: position.lon },
    );
    if (displacement <= ctx.rule.theftDisplacementMeters) continue;

    firedWindows.add(windowKey);
    events.push({
      detectorId: DETECTOR_ID,
      occurredAt: position.recordedAt,
      sourceEventId: buildSourceEventId(DETECTOR_ID, ctx.vehicle.vehicleId, windowKey),
      lat: position.lat,
      lon: position.lon,
      metadata: {
        vehicleRegistration: ctx.vehicle.registration,
        afterHoursWindowStart: windowKey,
        windowStartedAt: window.anchor.recordedAt,
        displacementMeters: Math.round(displacement),
        thresholdMeters: ctx.rule.theftDisplacementMeters,
        positionsInWindow: window.count,
        minimumPositions: ctx.rule.theftMinPositions,
        speedKph: position.speedKph,
        provider: position.provider,
        ruleVersion: ctx.rule.version,
      },
    });
  }

  return events;
}

/** The async detector shape `vehicleDetectorService` registers. */
export async function theftDetector(ctx: VehicleDetectorContext): Promise<DetectedVehicleEvent[]> {
  return detectTheftAfterHoursMovement(ctx);
}
