/**
 * All SQL for the nightly overnight-parking check.
 *
 * One LEFT JOIN LATERAL pulls every active vehicle together with its
 * active declared location, its tracker mapping and its most recent fix
 * at or before the check instant — the same shape used by
 * pages/api/fleet/positions/live.ts. At ~22 vehicles this is one
 * round-trip and needs no caching layer.
 *
 * Numerics are cast to text and parsed in TypeScript: node-postgres
 * returns NUMERIC as a string to avoid precision loss, and doing the
 * conversion explicitly keeps that from surprising callers.
 */
import { sql } from '@/lib/db-pool';
import type { ParkingCheckResult, ParkingLocation, PositionFix } from './types';

export interface ParkingCandidate {
  vehicleId: string;
  registration: string;
  hasTracker: boolean;
  location: ParkingLocation | null;
  lastFix: PositionFix | null;
}

export interface ComplianceCheckRow {
  vehicleId: string;
  checkDate: string;
  evaluatedAt: Date;
  parkingLocationId: string | null;
  lastFixAt: Date | null;
  lastFixLat: number | null;
  lastFixLon: number | null;
  lastFixAgeSeconds: number | null;
  distanceM: number | null;
  result: ParkingCheckResult;
}

interface CandidateRow extends Record<string, unknown> {
  vehicle_id: string;
  registration: string;
  has_tracker: boolean;
  location_id: string | null;
  location_lat: string | null;
  location_lon: string | null;
  radius_m: number | null;
  fix_at: Date | null;
  fix_lat: string | null;
  fix_lon: string | null;
}

export async function loadParkingCheckCandidates(checkAt: Date): Promise<ParkingCandidate[]> {
  const rows = await sql<CandidateRow>`
    SELECT
      v.id AS vehicle_id,
      v.registration,
      (t.id IS NOT NULL) AS has_tracker,
      pl.id AS location_id,
      pl.lat::text AS location_lat,
      pl.lon::text AS location_lon,
      pl.radius_m,
      p.recorded_at AS fix_at,
      p.lat::text AS fix_lat,
      p.lon::text AS fix_lon
    FROM fleet_vehicles v
    LEFT JOIN fleet_vehicle_trackers t
      ON t.vehicle_id = v.id AND t.is_active
    LEFT JOIN fleet_vehicle_parking_locations pl
      ON pl.vehicle_id = v.id AND pl.status = 'active'
    LEFT JOIN LATERAL (
      SELECT fp.recorded_at, fp.lat, fp.lon
      FROM fleet_vehicle_positions fp
      WHERE fp.vehicle_id = v.id
        AND fp.recorded_at <= ${checkAt}
      ORDER BY fp.recorded_at DESC
      LIMIT 1
    ) p ON true
    WHERE v.status = 'active'
    ORDER BY v.registration
  `;

  return rows.map((r) => ({
    vehicleId: r.vehicle_id,
    registration: r.registration,
    hasTracker: r.has_tracker,
    location:
      r.location_id === null || r.location_lat === null || r.location_lon === null
        ? null
        : {
            id: r.location_id,
            lat: Number(r.location_lat),
            lon: Number(r.location_lon),
            radiusM: Number(r.radius_m ?? 200),
          },
    lastFix:
      r.fix_at === null || r.fix_lat === null || r.fix_lon === null
        ? null
        : {
            recordedAt: new Date(r.fix_at),
            lat: Number(r.fix_lat),
            lon: Number(r.fix_lon),
          },
  }));
}

/**
 * Idempotent by design: the unique index on (vehicle_id, check_date)
 * makes a re-run or a double cron fire a no-op rather than a duplicate
 * record — and therefore, later, a duplicate alert.
 */
export async function insertComplianceCheck(row: ComplianceCheckRow): Promise<void> {
  await sql`
    INSERT INTO fleet_parking_compliance_checks (
      vehicle_id, check_date, evaluated_at, parking_location_id,
      last_fix_at, last_fix_lat, last_fix_lon, last_fix_age_seconds,
      distance_m, result
    ) VALUES (
      ${row.vehicleId}, ${row.checkDate}, ${row.evaluatedAt}, ${row.parkingLocationId},
      ${row.lastFixAt}, ${row.lastFixLat}, ${row.lastFixLon}, ${row.lastFixAgeSeconds},
      ${row.distanceM}, ${row.result}
    )
    ON CONFLICT (vehicle_id, check_date) DO NOTHING
  `;
}
