/**
 * All SQL for the driver side of overnight parking compliance.
 *
 * Separate from parkingQueries.ts, which serves the nightly job: that module
 * reads every active vehicle at once, this one reads and writes exactly one
 * vehicle's declarations on behalf of the signed-in driver.
 *
 * Numerics are cast to text and parsed in TypeScript for the reason given in
 * parkingQueries.ts: node-postgres returns NUMERIC as a string.
 */
import { sql } from '@/lib/db-pool';
import type { ParkingDeclaration, ParkingDeclarationStatus } from './types';

/**
 * Name of the partial unique index that enforces "one open request per
 * vehicle" (migration 483). Exported so the route can recognise the 23505 it
 * raises without duplicating the string literal.
 */
export const PENDING_CONFLICT = 'ux_parking_pending_per_vehicle';

interface DeclarationRow extends Record<string, unknown> {
  id: string;
  status: ParkingDeclarationStatus;
  lat: string;
  lon: string;
  accuracy_m: string | null;
  radius_m: number;
  label: string | null;
  address_text: string | null;
  request_note: string | null;
  decision_note: string | null;
  effective_from: string | Date | null;
  decided_at: string | Date | null;
  created_at: string | Date;
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapDeclaration(r: DeclarationRow): ParkingDeclaration {
  return {
    id: r.id,
    status: r.status,
    lat: Number(r.lat),
    lon: Number(r.lon),
    accuracyM: r.accuracy_m === null ? null : Number(r.accuracy_m),
    radiusM: Number(r.radius_m),
    label: r.label,
    addressText: r.address_text,
    requestNote: r.request_note,
    decisionNote: r.decision_note,
    effectiveFrom: toIso(r.effective_from),
    decidedAt: toIso(r.decided_at),
    createdAt: toIso(r.created_at) as string,
  };
}

/**
 * Resolve the signed-in driver's vehicle.
 *
 * vehicle_assignments stores the registration string rather than a vehicle FK,
 * so the join is on registration — the same shape as
 * pages/api/my/fleet-handoff.ts. is_active is filtered here because
 * assignments are ended by flag, not by deletion.
 */
export async function resolveDriverVehicle(
  staffId: string
): Promise<{ vehicleId: string; registration: string } | null> {
  const rows = await sql<{ vehicle_id: string; registration: string }>`
    SELECT v.id AS vehicle_id, v.registration
    FROM vehicle_assignments va
    JOIN fleet_vehicles v ON v.registration = va.vehicle_registration
    WHERE va.staff_id = ${staffId}
      AND va.is_active = true
    ORDER BY va.assignment_start DESC
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { vehicleId: row.vehicle_id, registration: row.registration } : null;
}

/**
 * Every declaration for one vehicle, split by status.
 *
 * One query rather than three: at most a handful of rows exist per vehicle,
 * and the partial unique indexes guarantee at most one active and one pending
 * among them.
 */
export async function loadDriverParkingState(vehicleId: string): Promise<{
  active: ParkingDeclaration | null;
  pending: ParkingDeclaration | null;
  history: ParkingDeclaration[];
}> {
  const rows = await sql<DeclarationRow>`
    SELECT id, status, lat::text AS lat, lon::text AS lon,
           accuracy_m::text AS accuracy_m, radius_m,
           label, address_text, request_note, decision_note,
           effective_from, decided_at, created_at
    FROM fleet_vehicle_parking_locations
    WHERE vehicle_id = ${vehicleId}
    ORDER BY created_at DESC
    LIMIT 20
  `;

  const all = rows.map(mapDeclaration);
  return {
    active: all.find((d) => d.status === 'active') ?? null,
    pending: all.find((d) => d.status === 'pending') ?? null,
    history: all.filter((d) => d.status !== 'active' && d.status !== 'pending'),
  };
}

export interface InsertDeclarationArgs {
  vehicleId: string;
  staffId: string;
  lat: number;
  lon: number;
  accuracyM: number;
  label: string | null;
  addressText: string | null;
  requestNote: string | null;
}

/**
 * Insert a submission as `pending` (spec §6.1 — even a first declaration is
 * approved, not auto-activated). A second open request raises 23505 on
 * ux_parking_pending_per_vehicle; the caller turns that into a 409 rather than
 * pre-checking, so two rapid taps cannot both pass a check and then both
 * insert.
 */
export async function insertPendingDeclaration(
  args: InsertDeclarationArgs
): Promise<ParkingDeclaration> {
  const rows = await sql<DeclarationRow>`
    INSERT INTO fleet_vehicle_parking_locations (
      vehicle_id, declared_by_staff_id, lat, lon, accuracy_m,
      label, address_text, status, request_note
    ) VALUES (
      ${args.vehicleId}, ${args.staffId}, ${args.lat}, ${args.lon}, ${args.accuracyM},
      ${args.label}, ${args.addressText}, 'pending', ${args.requestNote}
    )
    RETURNING id, status, lat::text AS lat, lon::text AS lon,
              accuracy_m::text AS accuracy_m, radius_m,
              label, address_text, request_note, decision_note,
              effective_from, decided_at, created_at
  `;
  return mapDeclaration(rows[0]!);
}

/**
 * Withdraw the driver's own open request.
 *
 * Scoped by declared_by_staff_id as well as vehicle_id: the vehicle already
 * comes from the session, and this keeps a re-assigned vehicle's previous
 * driver from withdrawing the current driver's request. Returns whether a row
 * was actually withdrawn.
 */
export async function withdrawPendingDeclaration(
  vehicleId: string,
  staffId: string
): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    UPDATE fleet_vehicle_parking_locations
       SET status = 'withdrawn', updated_at = now()
     WHERE vehicle_id = ${vehicleId}
       AND declared_by_staff_id = ${staffId}
       AND status = 'pending'
    RETURNING id
  `;
  return rows.length > 0;
}
