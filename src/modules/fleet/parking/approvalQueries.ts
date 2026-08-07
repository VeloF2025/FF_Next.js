/**
 * The approval queue's reads, and the one write that matters.
 *
 * Imports nothing but the pool and the geo helpers: the real-Postgres test in
 * tests/migrations runs under an alias table that cannot resolve
 * notificationBus. Telling the driver lives in decisionNotifications.ts.
 */
import { pool, sql } from '@/lib/db-pool';
import { haversineDistanceM } from '@/lib/geo';
import type { DecisionInput, PendingRequest } from './types';

interface PendingRow extends Record<string, unknown> {
  id: string;
  vehicle_id: string;
  registration: string;
  driver_staff_id: string;
  driver_name: string | null;
  req_lat: string;
  req_lon: string;
  req_accuracy_m: string | null;
  req_label: string | null;
  req_address_text: string | null;
  cur_lat: string | null;
  cur_lon: string | null;
  cur_label: string | null;
  cur_address_text: string | null;
  request_note: string | null;
  created_at: string | Date;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function loadPendingRequests(): Promise<PendingRequest[]> {
  const rows = await sql<PendingRow>`
    SELECT
      p.id,
      p.vehicle_id,
      v.registration,
      p.declared_by_staff_id AS driver_staff_id,
      s.full_name            AS driver_name,
      p.lat::text            AS req_lat,
      p.lon::text            AS req_lon,
      p.accuracy_m::text     AS req_accuracy_m,
      p.label                AS req_label,
      p.address_text         AS req_address_text,
      cur.lat::text          AS cur_lat,
      cur.lon::text          AS cur_lon,
      cur.label              AS cur_label,
      cur.address_text       AS cur_address_text,
      p.request_note,
      p.created_at
    FROM fleet_vehicle_parking_locations p
    JOIN fleet_vehicles v ON v.id = p.vehicle_id
    LEFT JOIN staff s ON s.id = p.declared_by_staff_id
    LEFT JOIN fleet_vehicle_parking_locations cur
      ON cur.vehicle_id = p.vehicle_id AND cur.status = 'active'
    WHERE p.status = 'pending'
    ORDER BY p.created_at ASC
  `;

  return rows.map((r) => {
    const requested = {
      lat: Number(r.req_lat),
      lon: Number(r.req_lon),
      accuracyM: r.req_accuracy_m === null ? null : Number(r.req_accuracy_m),
      label: r.req_label,
      addressText: r.req_address_text,
    };
    const current =
      r.cur_lat === null || r.cur_lon === null
        ? null
        : {
            lat: Number(r.cur_lat),
            lon: Number(r.cur_lon),
            label: r.cur_label,
            addressText: r.cur_address_text,
          };
    return {
      id: r.id,
      vehicleId: r.vehicle_id,
      registration: r.registration,
      driverStaffId: r.driver_staff_id,
      driverName: r.driver_name,
      requested,
      current,
      // Null, not 0, when there is nothing to move from — a 0 here reads as
      // "the driver did not move the address", which is a different claim.
      moveDistanceM:
        current === null
          ? null
          : Math.round(
              haversineDistanceM(
                { lat: current.lat, lon: current.lon },
                { lat: requested.lat, lon: requested.lon }
              )
            ),
      requestNote: r.request_note,
      createdAt: toIso(r.created_at),
    };
  });
}

export type DecisionResult =
  | { ok: true; vehicleId: string; registration: string; driverStaffId: string }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'assignment_ended' | 'self_decision' };

/**
 * Approve or reject one request.
 *
 * Approval is two writes that must not be separable: the row in force becomes
 * `superseded`, and this row becomes `active`. Half of that leaves either two
 * active rows (which ux_parking_active_per_vehicle refuses, aborting the
 * request) or none (which silently turns every future check into
 * `no_address`). So both run on one pinned connection inside one transaction.
 *
 * The row is re-read FOR UPDATE inside the transaction rather than trusted
 * from the list the approver was looking at, which may be minutes old: two
 * approvers on the same request would otherwise both promote it.
 *
 * Spec §11 requires the driver's assignment to be re-validated here. A request
 * from someone who has since handed the vehicle over is refused rather than
 * applied — approving it would attach an address to a vehicle on the say-so of
 * someone no longer responsible for it. A *rejection* skips that check: the
 * driver may well be gone, and the request still needs closing out.
 *
 * NOBODY DECIDES THEIR OWN DECLARATION. Holding `fleet.parking-requests:edit`
 * and holding a company vehicle are not mutually exclusive — in production
 * today two people are in exactly that position, one of them a super_admin. A
 * decision carries disciplinary consequence for the named driver, so a
 * self-issued one is not oversight at all. Enforced here rather than in the
 * route so every caller inherits it, and applied to REJECTION as well as
 * approval: quietly closing your own violation is the same failure of
 * separation as approving it.
 */
export async function decideRequest(input: DecisionInput): Promise<DecisionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: found } = await client.query<{
      id: string;
      vehicle_id: string;
      status: string;
      declared_by_staff_id: string;
      registration: string;
    }>(
      `SELECT p.id, p.vehicle_id, p.status, p.declared_by_staff_id, v.registration
         FROM fleet_vehicle_parking_locations p
         JOIN fleet_vehicles v ON v.id = p.vehicle_id
        WHERE p.id = $1
          FOR UPDATE OF p`,
      [input.requestId]
    );

    const request = found[0];
    if (!request) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_pending' };
    }
    // Separation of duties. See the header note: approver and driver overlap in
    // real staff data, so this is a live path, not a theoretical one.
    if (
      input.decidedByStaffId !== null &&
      input.decidedByStaffId === request.declared_by_staff_id
    ) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'self_decision' };
    }

    if (input.outcome === 'approved') {
      const { rows: stillAssigned } = await client.query<{ ok: boolean }>(
        `SELECT true AS ok
           FROM vehicle_assignments va
          WHERE va.staff_id = $1
            AND va.vehicle_registration = $2
            AND va.is_active = true
          LIMIT 1`,
        [request.declared_by_staff_id, request.registration]
      );
      if (!stillAssigned[0]) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'assignment_ended' };
      }

      await client.query(
        `UPDATE fleet_vehicle_parking_locations
            SET status = 'superseded', superseded_at = now(), updated_at = now()
          WHERE vehicle_id = $1 AND status = 'active'`,
        [request.vehicle_id]
      );
      await client.query(
        `UPDATE fleet_vehicle_parking_locations
            SET status = 'active', effective_from = now(),
                decided_by = $2, decided_at = now(),
                decision_note = $3, updated_at = now()
          WHERE id = $1`,
        [input.requestId, input.decidedByStaffId, input.decisionNote]
      );
    } else {
      await client.query(
        `UPDATE fleet_vehicle_parking_locations
            SET status = 'rejected', decided_by = $2, decided_at = now(),
                decision_note = $3, updated_at = now()
          WHERE id = $1`,
        [input.requestId, input.decidedByStaffId, input.decisionNote]
      );
    }

    await client.query('COMMIT');
    return {
      ok: true,
      vehicleId: request.vehicle_id,
      registration: request.registration,
      driverStaffId: request.declared_by_staff_id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
