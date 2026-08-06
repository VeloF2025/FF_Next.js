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
 *
 * The SQL here is exercised against a real Postgres by
 * tests/migrations/483_fleet_parking_queries.test.ts. Unit tests mock this
 * module out, so without that file nothing would ever hand these statements to
 * a parser.
 */
import { sql } from '@/lib/db-pool';
import type {
  ComplianceCheckRow,
  ComplianceCheckWrite,
  ParkingCandidate,
  ParkingCheckResult,
} from './types';

export type { ComplianceCheckRow, ParkingCandidate } from './types';

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
      -- received_at then id break ties on recorded_at. Two ingests can round to
      -- the same second, and without a total order the "last known position" is
      -- whichever row the plan happens to reach first — enough to flip a stored
      -- verdict between two runs of the same day with no new data.
      ORDER BY fp.recorded_at DESC, fp.received_at DESC, fp.id DESC
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
  previous_result: ParkingCheckResult | null;
}

/**
 * One row per vehicle per day: the unique index on (vehicle_id, check_date)
 * makes a re-run or a double cron fire converge on the same row instead of
 * a duplicate record. It is deliberately DO UPDATE, not DO NOTHING — a
 * manual smoke-test probe earlier in the day must not permanently poison
 * the slot and hide the genuine 20:00 SAST result. Last writer wins.
 *
 * Returns both what happened to the row and what it said before:
 *
 *   `inserted` — the standard Postgres `xmax = 0` idiom. `xmax` is the
 *   transaction id that deleted or updated a row version, so it is 0 only on a
 *   version nobody has touched — one this very INSERT created. On DO UPDATE it
 *   is false, because the update stamps a new xmax.
 *
 *   `previousResult` — read in the same statement, from the same snapshot, so
 *   it is the value the row held before this upsert. Callers alert on the
 *   transition into `violation`, not on `inserted`: a re-run that upgrades
 *   `unknown` to `violation` is an update, and dedup keyed on `inserted` would
 *   drop precisely the alert worth sending.
 */
export async function insertComplianceCheck(row: ComplianceCheckRow): Promise<ComplianceCheckWrite> {
  const rows = await sql<InsertResultRow>`
    WITH prior AS (
      SELECT result
        FROM fleet_parking_compliance_checks
       WHERE vehicle_id = ${row.vehicleId} AND check_date = ${row.checkDate}
    ),
    upserted AS (
      INSERT INTO fleet_parking_compliance_checks (
        vehicle_id, vehicle_registration, check_date, evaluated_at, parking_location_id,
        last_fix_at, last_fix_lat, last_fix_lon, last_fix_age_seconds,
        distance_m, result
      ) VALUES (
        ${row.vehicleId}, ${row.registration}, ${row.checkDate}, ${row.evaluatedAt}, ${row.parkingLocationId},
        ${row.lastFixAt}, ${row.lastFixLat}, ${row.lastFixLon}, ${row.lastFixAgeSeconds},
        ${row.distanceM}, ${row.result}
      )
      ON CONFLICT (vehicle_id, check_date) DO UPDATE SET
        vehicle_registration = EXCLUDED.vehicle_registration,
        evaluated_at = EXCLUDED.evaluated_at,
        parking_location_id = EXCLUDED.parking_location_id,
        last_fix_at = EXCLUDED.last_fix_at,
        last_fix_lat = EXCLUDED.last_fix_lat,
        last_fix_lon = EXCLUDED.last_fix_lon,
        last_fix_age_seconds = EXCLUDED.last_fix_age_seconds,
        distance_m = EXCLUDED.distance_m,
        result = EXCLUDED.result
      RETURNING (xmax = 0) AS inserted
    )
    SELECT u.inserted, p.result AS previous_result
      FROM upserted u
      LEFT JOIN prior p ON true
  `;

  return {
    inserted: rows[0]?.inserted === true,
    previousResult: rows[0]?.previous_result ?? null,
  };
}
