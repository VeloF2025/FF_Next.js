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

interface FleetVehicleRow extends Record<string, unknown> {
  id: string;
  registration: string | null;
  description: string | null;
  cartrack_vehicle_id: string | null;
}

async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const includeCandidates = req.query.include_candidates === 'true';

  const rows = await sql<FleetVehicleRow>`
    SELECT id, registration, description, cartrack_vehicle_id
    FROM fleet_vehicles
    WHERE status IN ('active', 'maintenance')
    ORDER BY registration ASC NULLS LAST
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
      // Cartrack is unreachable — fall through rather than block all
      // mapping writes. Log loud so ops sees it; the admin can retry
      // with ?allow_unknown=true if it's a sustained outage.
      log.warn('[cartrack-mapping] validation against Cartrack failed — persisting anyway', {
        fleetVehicleId,
        cartrackVehicleId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    // `status IN ('active','maintenance')` matches the GET filter — the UI
    // won't offer retired vehicles, and a direct POST against a retired
    // row is almost certainly a bug. Defence-in-depth against stale IDs.
    const updated = await sql<FleetVehicleRow>`
      UPDATE fleet_vehicles
      SET cartrack_vehicle_id = ${cartrackVehicleId}, updated_at = NOW()
      WHERE id = ${fleetVehicleId}
        AND status IN ('active', 'maintenance')
      RETURNING id, registration, description, cartrack_vehicle_id
    `;
    if (updated.length === 0) {
      apiResponse.notFound(res, 'FleetVehicle', fleetVehicleId);
      return;
    }
    apiResponse.success(res, { vehicle: updated[0] });
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
