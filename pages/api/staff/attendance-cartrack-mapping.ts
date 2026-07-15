/**
 * GET  /api/staff/attendance-cartrack-mapping
 *   Returns fleet_vehicles joined with their current cartrack_vehicle_id.
 *   Optionally fetches Cartrack's vehicle list so the UI can suggest a
 *   match by registration — toggled via ?include_candidates=true.
 *
 * POST /api/staff/attendance-cartrack-mapping
 *   Body: { fleet_vehicle_id, cartrack_vehicle_id | null }
 *   Sets (or clears) the Cartrack mapping on a single fleet vehicle.
 *
 * RBAC: people.staff.attendance.cartrack_mapping.
 * GET requires `view`; POST requires `edit` (enforced per-action inside
 * the handler against the migration-320-style pattern).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import { userHasPermission } from '@/lib/permissions';
import { cartrackClientFromEnv, CartrackError } from '@/services/tracking/cartrack/client';
import { setVehicleTracker } from '@/services/tracking/trackerQueries';

interface FleetVehicleRow extends Record<string, unknown> {
  id: string;
  registration: string | null;
  description: string | null;
  cartrack_vehicle_id: string | null;
}

interface FleetVehicleExistenceRow extends Record<string, unknown> {
  id: string;
  registration: string | null;
  description: string | null;
}

/** Which Cartrack tenant/account this deployment maps against (see migration 441). */
const CARTRACK_ACCOUNT_REF = process.env.CARTRACK_ACCOUNT_REF ?? 'default';

async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const includeCandidates = req.query.include_candidates === 'true';

  // Joins the active Cartrack tracker (if any) onto each vehicle. A vehicle
  // can have at most one active tracker (partial unique index on
  // fleet_vehicle_trackers(vehicle_id) WHERE is_active), so this LEFT JOIN
  // cannot fan out rows even before the provider filter narrows it further.
  const rows = await sql<FleetVehicleRow>`
    SELECT fv.id, fv.registration, fv.description, t.external_id AS cartrack_vehicle_id
    FROM fleet_vehicles fv
    LEFT JOIN fleet_vehicle_trackers t
      ON t.vehicle_id = fv.id AND t.is_active AND t.provider = 'cartrack'
    WHERE fv.status IN ('active', 'maintenance')
    ORDER BY fv.registration ASC NULLS LAST
  `;

  let candidates: Array<{
    cartrackId: string;
    registration: string | null;
    description: string | null;
  }> = [];
  let candidatesError: string | null = null;
  if (includeCandidates) {
    try {
      const client = cartrackClientFromEnv();
      candidates = await client.listVehicles();
    } catch (err) {
      candidatesError =
        err instanceof CartrackError ? err.message : err instanceof Error ? err.message : String(err);
      log.warn('[cartrack-mapping] candidate fetch failed', { error: candidatesError });
    }
  }

  apiResponse.success(res, { vehicles: rows, candidates, candidatesError });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const authed = req as AuthenticatedNextApiRequest;
  const actor = authed.user?.id;
  if (!actor) {
    apiResponse.unauthorized(res);
    return;
  }
  // Per-action permission gate — outer middleware grants `view`; POST
  // requires `edit`. Matches the weekly-locks handler pattern.
  if (authed.user.role !== 'super_admin') {
    const allowed = await userHasPermission(
      actor,
      'people.staff.attendance.cartrack_mapping',
      'edit'
    );
    if (!allowed) {
      apiResponse.error(
        res,
        ErrorCode.FORBIDDEN,
        'Missing edit permission on people.staff.attendance.cartrack_mapping'
      );
      return;
    }
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const fleetVehicleId = typeof body.fleet_vehicle_id === 'string' ? body.fleet_vehicle_id : '';
  const rawCartrackId = body.cartrack_vehicle_id;
  const cartrackVehicleId =
    typeof rawCartrackId === 'string' && rawCartrackId.trim().length > 0
      ? rawCartrackId.trim()
      : null;
  const allowUnknown = req.query.allow_unknown === 'true';

  if (!fleetVehicleId) {
    apiResponse.badRequest(res, 'fleet_vehicle_id is required');
    return;
  }

  // Validate against Cartrack's fleet list unless the caller explicitly
  // opts out. A typo silently persisted here produces permanent
  // vehicle_not_mapped verdicts that nobody notices until a supervisor
  // eyeballs the week view — loud rejection at submit time is much
  // cheaper than a "why are all these rows grey?" investigation.
  if (cartrackVehicleId && !allowUnknown) {
    try {
      const client = cartrackClientFromEnv();
      const candidates = await client.listVehicles();
      const exists = candidates.some((c) => c.cartrackId === cartrackVehicleId);
      if (!exists) {
        apiResponse.badRequest(
          res,
          `cartrack_vehicle_id '${cartrackVehicleId}' not found in Cartrack fleet. Pass ?allow_unknown=true to persist anyway (e.g. when Cartrack is unreachable).`
        );
        return;
      }
    } catch (err) {
      // Cartrack is unreachable — do NOT silently persist an unvalidated ID
      // (that produces permanent vehicle_not_mapped verdicts nobody notices
      // until a supervisor eyeballs the week view). Return a distinct 503 so
      // the operator knows validation was skipped and can explicitly opt in
      // via ?allow_unknown=true (the UI offers a "Save without validation"
      // action that re-POSTs with that flag). (#1999)
      log.warn('[cartrack-mapping] validation against Cartrack failed — refusing to persist unvalidated', {
        fleetVehicleId,
        cartrackVehicleId,
        error: err instanceof Error ? err.message : String(err),
      });
      apiResponse.error(
        res,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Could not reach Cartrack to validate this vehicle ID. Use "Save without validation" to persist it without the cross-check.'
      );
      return;
    }
  }

  try {
    // `status IN ('active','maintenance')` matches the GET filter — the UI
    // won't offer retired vehicles, and a direct POST against a retired
    // row is almost certainly a bug. Defence-in-depth against stale IDs.
    // fleet_vehicle_trackers has no status column of its own (it FKs to
    // fleet_vehicles), so this existence check is what enforces the filter
    // before setVehicleTracker writes.
    const existing = await sql<FleetVehicleExistenceRow>`
      SELECT id, registration, description
      FROM fleet_vehicles
      WHERE id = ${fleetVehicleId}
        AND status IN ('active', 'maintenance')
    `;
    if (existing.length === 0) {
      apiResponse.notFound(res, 'FleetVehicle', fleetVehicleId);
      return;
    }

    await setVehicleTracker({
      vehicleId: fleetVehicleId,
      provider: 'cartrack',
      accountRef: CARTRACK_ACCOUNT_REF,
      externalId: cartrackVehicleId,
    });

    const vehicle: FleetVehicleRow = { ...existing[0], cartrack_vehicle_id: cartrackVehicleId };
    apiResponse.success(res, { vehicle });
  } catch (err) {
    log.error('[cartrack-mapping] update failed', {
      fleetVehicleId,
      cartrackVehicleId,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(
  withPermission('people.staff.attendance.cartrack_mapping', 'view')(handler)
);
