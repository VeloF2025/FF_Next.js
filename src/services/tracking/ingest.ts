/**
 * Writes normalised positions into fleet_vehicle_positions.
 *
 * Idempotent by (provider, provider_event_id): polling windows overlap on
 * purpose, so re-ingesting the same event must be a no-op, not a duplicate.
 */
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { ProviderKey, ProviderPosition } from './types';

/** Reject fixes dated further ahead than this — device clock skew. */
const MAX_FUTURE_MS = 5 * 60 * 1000;

interface TrackerRow extends Record<string, unknown> {
  external_id: string;
  vehicle_id: string;
  tracker_id: string;
}

export async function ingestPositions(
  provider: ProviderKey,
  positions: ProviderPosition[]
): Promise<{ inserted: number; skippedUnmapped: number }> {
  if (positions.length === 0) return { inserted: 0, skippedUnmapped: 0 };

  const trackers = await sql<TrackerRow>`
    SELECT external_id, vehicle_id, id AS tracker_id
    FROM fleet_vehicle_trackers
    WHERE provider = ${provider} AND is_active
  `;
  const byExternalId = new Map(trackers.map((t) => [t.external_id, t]));

  const cutoff = Date.now() + MAX_FUTURE_MS;
  let inserted = 0;
  let skippedUnmapped = 0;
  let skippedFuture = 0;

  for (const p of positions) {
    const t = byExternalId.get(p.externalId);
    if (!t) { skippedUnmapped++; continue; }
    if (p.recordedAt.getTime() > cutoff) { skippedFuture++; continue; }

    await sql`
      INSERT INTO fleet_vehicle_positions (
        vehicle_id, tracker_id, provider, provider_event_id, recorded_at,
        lat, lon, speed_kph, road_speed_kph, is_speeding, ignition,
        odometer_km, linear_g, lateral_g, bearing, altitude_m, gps_fix_type
      ) VALUES (
        ${t.vehicle_id}, ${t.tracker_id}, ${provider}, ${p.providerEventId}, ${p.recordedAt},
        ${p.lat}, ${p.lon}, ${p.speedKph}, ${p.roadSpeedKph}, ${p.isSpeeding}, ${p.ignition},
        ${p.odometerKm}, ${p.linearG}, ${p.lateralG}, ${p.bearing}, ${p.altitudeM}, ${p.gpsFixType}
      )
      ON CONFLICT DO NOTHING
    `;
    inserted++;
  }

  if (skippedFuture > 0) {
    log.warn('[tracking-ingest] rejected positions dated in the future', { provider, skippedFuture });
  }
  if (skippedUnmapped > 0) {
    // Expected steady state — e.g. a tracker on the account with no plate.
    log.info('[tracking-ingest] positions for unmapped trackers', { provider, skippedUnmapped });
  }
  return { inserted, skippedUnmapped };
}
