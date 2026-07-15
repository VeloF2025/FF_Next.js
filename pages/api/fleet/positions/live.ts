/**
 * Last-known position per active vehicle, for the live map.
 *
 * Returns EVERY active vehicle, including untracked ones, with an explicit
 * trackingState. A map that silently omits the vehicles it cannot see is a
 * lie by omission — the gaps are exactly what the business needs to see.
 *
 * DISTINCT ON rides the (vehicle_id, recorded_at DESC) index. At ~22
 * vehicles a separate last-position cache table would be a second thing to
 * get out of sync for no measurable gain.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/db-pool';

/** A fix older than this is not "live" and must not be drawn as if it were. */
const STALE_AFTER_SECONDS = 15 * 60;

interface Row extends Record<string, unknown> {
  vehicle_id: string;
  registration: string;
  driver_name: string | null;
  provider: string | null;
  lat: string | null;
  lon: string | null;
  speed_kph: string | null;
  ignition: boolean | null;
  is_speeding: boolean | null;
  recorded_at: Date | null;
  has_tracker: boolean;
}

export type TrackingState = 'tracked' | 'awaiting_data' | 'untracked';

export interface LiveVehicle {
  vehicleId: string;
  registration: string;
  driverName: string | null;
  provider: string | null;
  lat: number | null;
  lon: number | null;
  speedKph: number | null;
  ignition: boolean | null;
  isSpeeding: boolean | null;
  recordedAt: string | null;
  ageSeconds: number | null;
  isStale: boolean;
  trackingState: TrackingState;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const rows = await sql<Row>`
    SELECT
      v.id AS vehicle_id,
      v.registration,
      NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), '') AS driver_name,
      p.provider,
      p.lat::text, p.lon::text, p.speed_kph::text,
      p.ignition, p.is_speeding, p.recorded_at,
      (t.id IS NOT NULL) AS has_tracker
    FROM fleet_vehicles v
    LEFT JOIN staff s ON s.id = v.assigned_driver_id
    LEFT JOIN fleet_vehicle_trackers t ON t.vehicle_id = v.id AND t.is_active
    LEFT JOIN LATERAL (
      SELECT DISTINCT ON (fp.vehicle_id)
             fp.provider, fp.lat, fp.lon, fp.speed_kph, fp.ignition, fp.is_speeding, fp.recorded_at
      FROM fleet_vehicle_positions fp
      WHERE fp.vehicle_id = v.id
      ORDER BY fp.vehicle_id, fp.recorded_at DESC
    ) p ON true
    WHERE v.status = 'active'
    ORDER BY v.registration
  `;

  const now = Date.now();
  const vehicles: LiveVehicle[] = rows.map((r) => {
    const recordedAt = r.recorded_at ? new Date(r.recorded_at) : null;
    const ageSeconds = recordedAt ? Math.round((now - recordedAt.getTime()) / 1000) : null;
    const trackingState: TrackingState = !r.has_tracker
      ? 'untracked'
      : recordedAt === null
        ? 'awaiting_data'
        : 'tracked';
    return {
      vehicleId: r.vehicle_id,
      registration: r.registration,
      driverName: r.driver_name,
      provider: r.provider,
      lat: r.lat === null ? null : Number(r.lat),
      lon: r.lon === null ? null : Number(r.lon),
      speedKph: r.speed_kph === null ? null : Number(r.speed_kph),
      ignition: r.ignition,
      isSpeeding: r.is_speeding,
      recordedAt: recordedAt?.toISOString() ?? null,
      ageSeconds,
      isStale: ageSeconds !== null && ageSeconds > STALE_AFTER_SECONDS,
      trackingState,
    };
  });

  return apiResponse.success(res, { vehicles, staleAfterSeconds: STALE_AFTER_SECONDS });
}
