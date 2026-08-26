/**
 * GET /api/fleet/vehicles/[id]/day-route?date=YYYY-MM-DD[&includePositions=1]
 *
 * One vehicle's trips for one SAST calendar day, and — only when asked for — the raw fixes behind
 * them.
 *
 * Positions are opt-in because the two feeds differ by three orders of magnitude in cadence: a
 * cartrack/velocity day is ~1,169 fixes and a netstar/europcar day is about ten. Shipping the
 * first by default to draw a line nobody zoomed into is a large payload for no reading.
 *
 * `allTripsTimedOut` exists because a trip closed by tracker silence has a real start and an
 * UNKNOWN end. A day made entirely of those is a plausible-looking route that ends where the
 * signal died, not where the vehicle stopped, and the map has to say so. `counts_toward_metrics`
 * is GENERATED in migration 526 precisely so a phantom trip is visible rather than plausible.
 *
 * Gated on `fleet.vehicle-stats:view` (migration 529, PR #2619 — unapplied on master today).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { query } from '@/lib/db-pool';
import { loadVehicleIdentity } from '@/modules/fleet/dailyStats/statsQueries';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POSITIONS = 5_000;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function num(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const parsed = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(v: string | Date | null): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

interface TripRow extends Record<string, unknown> {
  id: string;
  ignition_on_at: string | Date;
  ignition_off_at: string | Date | null;
  close_reason: string;
  counts_toward_metrics: boolean;
  on_lat: string | null; on_lon: string | null;
  off_lat: string | null; off_lon: string | null;
  on_nearest_place_label: string | null; off_nearest_place_label: string | null;
  duration_seconds: string | null; distance_km: string | null; max_speed_kph: string | null;
}

interface PositionRow extends Record<string, unknown> {
  recorded_at: string | Date;
  lat: string | null; lon: string | null;
  speed_kph: string | null; ignition: boolean | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const vehicleId = one(req.query.id as string | string[] | undefined);
  if (!vehicleId || !UUID_RE.test(vehicleId)) {
    return apiResponse.badRequest(res, 'vehicle id must be a UUID');
  }

  const date = one(req.query.date as string | string[] | undefined);
  if (!date || !DATE_RE.test(date)) {
    return apiResponse.badRequest(res, 'date is required as YYYY-MM-DD');
  }

  const vehicle = await loadVehicleIdentity(vehicleId);
  if (!vehicle) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  // SAST, not UTC: 00:00 SAST is 22:00 UTC the previous day, and a UTC window silently drops
  // every trip that started before 02:00 local.
  const startAt = `${date}T00:00:00+02:00`;
  const endAt = `${date}T23:59:59.999+02:00`;

  const trips = await query<TripRow>(
    `/* fleet-day-route:trips */
     SELECT id, ignition_on_at, ignition_off_at, close_reason, counts_toward_metrics,
            on_lat, on_lon, off_lat, off_lon,
            on_nearest_place_label, off_nearest_place_label,
            duration_seconds, distance_km, max_speed_kph
     FROM fleet_vehicle_trips
     WHERE vehicle_id = $1
       AND ignition_on_at >= $2::timestamptz AND ignition_on_at <= $3::timestamptz
     ORDER BY ignition_on_at`,
    [vehicleId, startAt, endAt],
  );

  const wantsPositions = one(req.query.includePositions as string | string[] | undefined) === '1';
  // Two explicit branches, never a conditional tagged-template fragment: those are broken in this
  // repo and produce a malformed query rather than an error.
  const positionRows = wantsPositions
    ? await query<PositionRow>(
        `/* fleet-day-route:positions */
         SELECT recorded_at, lat, lon, speed_kph, ignition
         FROM fleet_vehicle_positions
         WHERE vehicle_id = $1
           AND recorded_at >= $2::timestamptz AND recorded_at <= $3::timestamptz
           AND lat IS NOT NULL AND lon IS NOT NULL
         ORDER BY recorded_at, id
         LIMIT $4`,
        [vehicleId, startAt, endAt, MAX_POSITIONS],
      )
    : [];

  return apiResponse.success(res, {
    vehicle,
    workDate: date,
    trips: trips.map((t) => ({
      id: t.id,
      ignitionOnAt: iso(t.ignition_on_at),
      ignitionOffAt: iso(t.ignition_off_at),
      closeReason: t.close_reason,
      countsTowardMetrics: t.counts_toward_metrics,
      start: { lat: num(t.on_lat), lon: num(t.on_lon), place: t.on_nearest_place_label },
      end: { lat: num(t.off_lat), lon: num(t.off_lon), place: t.off_nearest_place_label },
      durationSeconds: num(t.duration_seconds),
      distanceKm: num(t.distance_km),
      maxSpeedKph: num(t.max_speed_kph),
    })),
    // A day with no trips is NOT a day of timed-out trips; the two read differently on the map.
    allTripsTimedOut: trips.length > 0 && trips.every((t) => t.close_reason === 'timeout'),
    timedOutTrips: trips.filter((t) => t.close_reason === 'timeout').length,
    positions: wantsPositions
      ? positionRows.map((p) => ({
          recordedAt: iso(p.recorded_at),
          lat: num(p.lat), lon: num(p.lon),
          speedKph: num(p.speed_kph), ignition: p.ignition,
        }))
      : null,
    positionsTruncated: positionRows.length === MAX_POSITIONS,
  });
}

async function permissionRouted(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  return withPermission('fleet.vehicle-stats', 'view')(handler)(req, res);
}

export default withAuth(permissionRouted);
