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
            radiusM: Number(r.radius_m),
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

interface InsertResultRow extends Record<string, unknown> {
  inserted: boolean;
}

/**
 * One row per vehicle per day: the unique index on (vehicle_id, check_date)
 * makes a re-run or a double cron fire converge on the same row instead of
 * a duplicate record. It is deliberately DO UPDATE, not DO NOTHING — a
 * manual smoke-test probe earlier in the day must not permanently poison
 * the slot and hide the genuine 20:00 SAST result. Last writer wins.
 *
 * Returns whether this call inserted a brand-new row (true) or updated an
 * existing one (false), using the standard Postgres `xmax = 0` idiom:
 * `xmax` is the transaction id that deleted/updated a row version, so it
 * is exactly 0 only on a version nobody has touched yet — i.e. one this
 * very INSERT just created. On an ON CONFLICT ... DO UPDATE, `xmax = 0`
 * is false, because the update itself stamps a new xmax on the new row
 * version. Callers (e.g. violation notifications) use this to avoid
 * re-alerting on a re-run that only updated an existing row.
 */
export async function insertComplianceCheck(row: ComplianceCheckRow): Promise<boolean> {
  const rows = await sql<InsertResultRow>`
    INSERT INTO fleet_parking_compliance_checks (
      vehicle_id, check_date, evaluated_at, parking_location_id,
      last_fix_at, last_fix_lat, last_fix_lon, last_fix_age_seconds,
      distance_m, result
    ) VALUES (
      ${row.vehicleId}, ${row.checkDate}, ${row.evaluatedAt}, ${row.parkingLocationId},
      ${row.lastFixAt}, ${row.lastFixLat}, ${row.lastFixLon}, ${row.lastFixAgeSeconds},
      ${row.distanceM}, ${row.result}
    )
    ON CONFLICT (vehicle_id, check_date) DO UPDATE SET
      evaluated_at = EXCLUDED.evaluated_at,
      parking_location_id = EXCLUDED.parking_location_id,
      last_fix_at = EXCLUDED.last_fix_at,
      last_fix_lat = EXCLUDED.last_fix_lat,
      last_fix_lon = EXCLUDED.last_fix_lon,
      last_fix_age_seconds = EXCLUDED.last_fix_age_seconds,
      distance_m = EXCLUDED.distance_m,
      result = EXCLUDED.result
    RETURNING (xmax = 0) AS inserted
  `;
  return rows[0]?.inserted === true;
}
