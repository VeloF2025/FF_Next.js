/**
 * /api/my/vehicle/parking — the driver's overnight parking address.
 *
 *   GET    → the caller's vehicle plus its active, pending and past declarations
 *   POST   → submit a declaration or a change request (stored as `pending`)
 *   DELETE → withdraw the caller's own open request
 *
 * The vehicle is resolved server-side from the session on every method. A
 * `vehicleId` in the body is ignored, which is the point: it mirrors the
 * portal-auth hardening of 2026-07-30 (canAccessPortalVehicle) that closed
 * exactly this class of hole.
 *
 * Design: docs/superpowers/specs/2026-08-04-fleet-parking-compliance-design.md §8
 */
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { validateDeclaration } from '@/modules/fleet/parking/declarationRules';
import {
  PENDING_CONFLICT,
  insertPendingDeclaration,
  loadDriverParkingState,
  resolveDriverVehicle,
  withdrawPendingDeclaration,
} from '@/modules/fleet/parking/driverParkingQueries';
import { notifyParkingChangeRequested } from '@/modules/fleet/parking/parkingNotifications';
import type { DeclarationInput } from '@/modules/fleet/parking/types';
import { reverseGeocode } from '@/utils/geoLocation';

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

/** Postgres unique-violation carrying the constraint that was hit. */
function isPendingConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' && e?.constraint === PENDING_CONFLICT;
}

/**
 * A human-readable label for the capture. Resolved server-side rather than
 * taken from the body — the client has already asked /api/my/geocode for the
 * same coordinates, so this normally lands on that route's TTL cache instead
 * of a second Nominatim call, and an untrusted address never reaches the row.
 *
 * Spec §11: a failure here stores coordinates with no label. Never fatal.
 */
async function resolveAddressText(lat: number, lon: number): Promise<string | null> {
  try {
    const geo = await reverseGeocode(lat, lon);
    if (!geo) return null;
    const parts = [geo.city, geo.municipalDistrict, geo.province].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  } catch (err) {
    log.warn('[my/vehicle/parking] reverse geocode failed', { error: err }, 'fleet');
    return null;
  }
}

export default withMySession(async (req, res, session) => {
  const method = req.method ?? 'UNKNOWN';
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, method, ['GET', 'POST', 'DELETE']);
  }

  try {
    const vehicle = await resolveDriverVehicle(session.staffId);
    if (!vehicle) {
      return apiResponse.notFound(res, 'Active vehicle assignment', session.staffId);
    }

    if (method === 'GET') {
      const state = await loadDriverParkingState(vehicle.vehicleId);
      return apiResponse.success(res, {
        vehicle: { id: vehicle.vehicleId, registration: vehicle.registration },
        ...state,
      });
    }

    if (method === 'DELETE') {
      const withdrawn = await withdrawPendingDeclaration(vehicle.vehicleId, session.staffId);
      if (!withdrawn) {
        return apiResponse.notFound(res, 'Open parking request', vehicle.registration);
      }
      return apiResponse.success(res, { withdrawn: true });
    }

    const parsed = validateDeclaration((req.body ?? {}) as DeclarationInput);
    if (!parsed.ok) {
      return apiResponse.badRequest(res, parsed.error);
    }

    const addressText = await resolveAddressText(parsed.value.lat, parsed.value.lon);
    const declaration = await insertPendingDeclaration({
      vehicleId: vehicle.vehicleId,
      staffId: session.staffId,
      lat: parsed.value.lat,
      lon: parsed.value.lon,
      accuracyM: parsed.value.accuracyM,
      label: parsed.value.label,
      addressText,
      requestNote: parsed.value.requestNote,
    });

    // Fire-and-forget: the declaration is stored, and the notification helper
    // swallows and logs its own failures.
    void notifyParkingChangeRequested({
      registration: vehicle.registration,
      driverName: session.staffName,
      declarationId: declaration.id,
    });

    return apiResponse.success(res, { declaration }, undefined, 201);
  } catch (err) {
    if (isPendingConflict(err)) {
      return apiResponse.conflict(
        res,
        'You already have a parking address request waiting for approval. Withdraw it before submitting another.'
      );
    }
    log.error('[my/vehicle/parking] request failed', { error: err, method }, 'fleet');
    return apiResponse.internalError(res, err);
  }
});
