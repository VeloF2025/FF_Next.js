/**
 * Reads behind the compliance dashboard.
 *
 * The result filter is two whole queries rather than one with a conditional
 * fragment. That is not style: interpolating a ternary that returns a tagged
 * template fragment is broken in this codebase and silently produces wrong
 * SQL. CLAUDE.md spells the pattern out.
 *
 * Described rather than quoted on purpose: the no-direct-db-connections guard
 * greps this directory for tagged-template SQL and reads text, not syntax, so
 * a comment SHOWING the broken form reported this file as a direct database
 * connection. Teaching that guard to skip comments was tried and each attempt
 * made it MISS real code instead — a worse failure for a guard than the false
 * positive it was fixing. One sentence of prose is cheaper than a JavaScript
 * lexer living inside a test.
 */
import { sql } from '@/lib/db-pool';
import type { ComplianceRow, ParkingCheckResult } from './types';

interface ComplianceQueryRow extends Record<string, unknown> {
  id: string;
  vehicle_id: string | null;
  registration: string;
  check_date: string | Date;
  result: ParkingCheckResult;
  distance_m: number | null;
  last_fix_at: string | Date | null;
  last_fix_lat: string | null;
  last_fix_lon: string | null;
  last_fix_age_seconds: number | null;
  address_label: string | null;
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapRow(r: ComplianceQueryRow): ComplianceRow {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    registration: r.registration,
    checkDate:
      typeof r.check_date === 'string' ? r.check_date : r.check_date.toISOString().slice(0, 10),
    result: r.result,
    distanceM: r.distance_m,
    lastFixAt: toIso(r.last_fix_at),
    lastFixLat: r.last_fix_lat === null ? null : Number(r.last_fix_lat),
    lastFixLon: r.last_fix_lon === null ? null : Number(r.last_fix_lon),
    lastFixAgeSeconds: r.last_fix_age_seconds,
    addressLabel: r.address_label,
  };
}

export async function loadCompliance(filter: {
  from: string;
  to: string;
  result?: ParkingCheckResult;
}): Promise<ComplianceRow[]> {
  if (filter.result) {
    const rows = await sql<ComplianceQueryRow>`
      SELECT c.id, c.vehicle_id, c.vehicle_registration AS registration,
             to_char(c.check_date, 'YYYY-MM-DD') AS check_date, c.result,
             c.distance_m, c.last_fix_at,
             c.last_fix_lat::text AS last_fix_lat,
             c.last_fix_lon::text AS last_fix_lon,
             c.last_fix_age_seconds,
             pl.label AS address_label
        FROM fleet_parking_compliance_checks c
        LEFT JOIN fleet_vehicle_parking_locations pl ON pl.id = c.parking_location_id
       WHERE c.check_date BETWEEN ${filter.from}::date AND ${filter.to}::date
         AND c.result = ${filter.result}
       ORDER BY c.check_date DESC, c.vehicle_registration ASC
       LIMIT 1000
    `;
    return rows.map(mapRow);
  }

  const rows = await sql<ComplianceQueryRow>`
    SELECT c.id, c.vehicle_id, c.vehicle_registration AS registration,
           to_char(c.check_date, 'YYYY-MM-DD') AS check_date, c.result,
           c.distance_m, c.last_fix_at,
           c.last_fix_lat::text AS last_fix_lat,
           c.last_fix_lon::text AS last_fix_lon,
           c.last_fix_age_seconds,
           pl.label AS address_label
      FROM fleet_parking_compliance_checks c
      LEFT JOIN fleet_vehicle_parking_locations pl ON pl.id = c.parking_location_id
     WHERE c.check_date BETWEEN ${filter.from}::date AND ${filter.to}::date
     ORDER BY c.check_date DESC, c.vehicle_registration ASC
     LIMIT 1000
  `;
  return rows.map(mapRow);
}
