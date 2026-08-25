/**
 * `severe_driving` — harsh braking, acceleration or cornering.
 *
 * PURE: no database, no clock.
 *
 * Two evidence bases with a precedence rule between them, and the precedence is
 * the part most likely to be quietly broken by an edit.
 *
 * ## Primary — the provider's own verdict
 *
 * `provider_event_type` carries Cartrack's `event_description` verbatim
 * (migration 528). Its firmware computes harshness itself and fires
 * `HARSH_BRAKING` / `HARSH_CORNERING` on the SIX of seven `cartrack/velocity`
 * vehicles whose `linear_g` and `lateral_g` are constant zero — including
 * `HARSH_CORNERING` at 95–129 km/h with `lin=0, lat=0`. Those are real events
 * our g columns cannot see at all, which is why this path is primary rather
 * than a cross-check.
 *
 * `HARSH_ACCELERATION` was NOT observed in 55,009 events over 7 days (PR0/U1).
 * It is accepted if it ever appears; nothing here may assume it exists and no
 * test may assert that it does.
 *
 * ## Fallback — signed g, gated twice
 *
 * Only consulted for a fix the primary path did not name, and only when the
 * vehicle's window carries a NON-ZERO g reading somewhere. `linear_g IS NOT
 * NULL` is not that test: six of seven vehicles report constant zero, so a null
 * check passes for a vehicle whose g columns can never fire, and the fallback
 * would then be silently dead rather than visibly absent.
 *
 *   -linear_g > harshLinearG   `linear_g` is SIGNED; negative is braking.
 *   lateral_g > harshLateralG  already an unsigned magnitude (min 0.000 over
 *                              237,419 rows) — `abs()` is a no-op and treating a
 *                              negative as possible is a bug.
 *   speed_kph >= harshMinSpeedKph   without this the detector is a report on one
 *                              broken device: 19 of its 20 braking events at
 *                              >= 0.35 g were at <= 10 km/h.
 *
 * ## The window gate is, today, provably subsumed — and stays anyway
 *
 * Mutation-tested and honest about the result: deleting `gAvailable` from the
 * decision below breaks no test, and cannot, because the per-fix comparisons are
 * STRICT and both thresholds are positive. `-linearG > 0.35` or `lateralG > 0.35`
 * implies that fix's g is non-zero, which implies the window carries a non-zero
 * reading, which is exactly what `gAvailable` asserts. The implication holds for
 * every input, so no fixture can separate the two versions.
 *
 * It is kept, deliberately, for the edit that breaks that implication: a
 * comparison loosened to `>=`, a threshold an operator sets to 0 (the rule
 * validator permits it), or a future "any g movement" branch. Each of those
 * makes a structurally-zero vehicle-day fire on nothing at all, and this is the
 * line that stops it. It is documented as subsumed rather than presented as
 * live protection, because a guard whose test passes for the wrong reason is
 * worse than no guard.
 *
 * The speed gate belongs to the g path ALONE. Every live `HARSH_BRAKING` sample
 * carries `speed = 6`, so gating the firmware path on 20 km/h would discard
 * every braking event the provider itself reported. (`dailyStats/harshEvents.ts`
 * gates both, because a day COUNT that mixes a broken device into a driver
 * statistic is a different failure from an incident that never opens.)
 */

import { buildSourceEventId } from './sourceEventId';
import type { DetectedVehicleEvent, DetectorPosition, VehicleDetectorContext } from './types';

const DETECTOR_ID = 'severe_driving';

export type HarshKind = 'braking' | 'acceleration' | 'cornering';

/** Provider vocabulary → the kind we report. `HARSH_ACCELERATION` is speculative; see the header. */
export const HARSH_EVENT_TYPES: Readonly<Record<string, HarshKind>> = {
  HARSH_BRAKING: 'braking',
  HARSH_CORNERING: 'cornering',
  HARSH_ACCELERATION: 'acceleration',
};

/**
 * Did this window carry any real g reading at all?
 *
 * The same observed-not-assumed test `dailyStats/coverage.ts` applies per
 * vehicle-day, computed here from the detection window because PR2's
 * `fleet_vehicle_daily_stats` is not merged and this phase must not depend on it.
 */
export function windowHasNonZeroG(positions: readonly DetectorPosition[]): boolean {
  return positions.some((p) => (p.linearG !== null && p.linearG !== 0) || (p.lateralG !== null && p.lateralG !== 0));
}

function providerVerdict(position: DetectorPosition): HarshKind | null {
  const event = position.providerEventType;
  // `Object.hasOwn`, not a bare index: providerEventType is a provider's string
  // held verbatim, so `HARSH_EVENT_TYPES['constructor']` would otherwise be a
  // truthy FUNCTION rather than undefined.
  if (event === null || !Object.hasOwn(HARSH_EVENT_TYPES, event)) return null;
  return (HARSH_EVENT_TYPES as Record<string, HarshKind>)[event] ?? null;
}

function gVerdict(position: DetectorPosition, ctx: VehicleDetectorContext): HarshKind | null {
  if (position.speedKph === null || position.speedKph < ctx.rule.harshMinSpeedKph) return null;
  if (position.linearG !== null && -position.linearG > ctx.rule.harshLinearG) return 'braking';
  if (position.linearG !== null && position.linearG > ctx.rule.harshLinearG) return 'acceleration';
  if (position.lateralG !== null && position.lateralG > ctx.rule.harshLateralG) return 'cornering';
  return null;
}

/**
 * The bucket key.
 *
 * `provider_event_id` is already unique per event within its feed and is
 * present on every row (ingest synthesises one for feeds that supply none), so
 * it is the natural bucket. The instant+kind fallback is for a fixture or a
 * future feed that leaves it null; two harsh events of the same kind on one
 * vehicle at the same instant are then one incident, which is the safe
 * direction to be wrong in.
 */
function bucketKey(position: DetectorPosition, kind: HarshKind): string {
  return position.providerEventId ?? `${position.recordedAt}:${kind}`;
}

export function detectSevereDriving(ctx: VehicleDetectorContext): DetectedVehicleEvent[] {
  const gAvailable = windowHasNonZeroG(ctx.positions);
  const events: DetectedVehicleEvent[] = [];
  const seen = new Set<string>();

  for (const position of ctx.positions) {
    const fromProvider = providerVerdict(position);
    // The firmware's verdict WINS and the g branch is not also consulted for
    // that fix — otherwise one event is reported twice under two bucket keys.
    const kind = fromProvider ?? (gAvailable ? gVerdict(position, ctx) : null);
    if (!kind) continue;

    const key = bucketKey(position, kind);
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({
      detectorId: DETECTOR_ID,
      occurredAt: position.recordedAt,
      sourceEventId: buildSourceEventId(DETECTOR_ID, ctx.vehicle.vehicleId, key),
      lat: position.lat,
      lon: position.lon,
      metadata: {
        vehicleRegistration: ctx.vehicle.registration,
        harshKind: kind,
        evidence: fromProvider ? 'provider_event' : 'g_force',
        providerEventType: position.providerEventType,
        speedKph: position.speedKph,
        linearG: position.linearG,
        lateralG: position.lateralG,
        provider: position.provider,
        ruleVersion: ctx.rule.version,
      },
    });
  }

  return events;
}

/** The async detector shape `vehicleDetectorService` registers. */
export async function severeDrivingDetector(ctx: VehicleDetectorContext): Promise<DetectedVehicleEvent[]> {
  return detectSevereDriving(ctx);
}
