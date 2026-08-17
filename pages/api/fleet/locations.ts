/**
 * Fleet Authorized Locations API
 * CRUD operations for authorized locations (geofencing).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { apiResponse } from '@/lib/apiResponse';
import { getSql } from '@/lib/neon-sql';
import type { LocationType } from '@/modules/fleet/types';
import {
  validateLocationInput,
  type LocationInput,
} from '@/modules/fleet/locations/locationRules';

type LocationAction = 'view' | 'create' | 'edit' | 'delete';

const getSqlInstance = () => getSql();

function actionForMethod(method: string | undefined): LocationAction {
  if (method === 'POST') return 'create';
  if (method === 'PUT') return 'edit';
  if (method === 'DELETE') return 'delete';
  return 'view';
}

function requestBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function numberValue(value: unknown): number {
  if (value === null || (typeof value === 'string' && !value.trim())) return Number.NaN;
  return typeof value === 'number' ? value : Number(value);
}

function vehicleIdValue(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value.trim() || null;
  return fallback;
}

// A rejected `isActive` must fail loudly rather than be coerced: `=== true`
// silently turned a malformed truthy value into `false`, deactivating the
// location while returning 200.
function isActiveValue(value: unknown): boolean | null | 'invalid' {
  if (value === undefined) return null;
  return typeof value === 'boolean' ? value : 'invalid';
}

function normalizeLocationInput(
  body: Record<string, unknown>,
  fallback: LocationInput
): LocationInput {
  const rawLocationType = body.locationType ?? body.location_type;
  const hasLocationType = rawLocationType !== undefined;
  const hasVehicleId = Object.prototype.hasOwnProperty.call(body, 'vehicleId');
  const vehicleId = hasVehicleId ? vehicleIdValue(body.vehicleId, fallback.vehicleId) : fallback.vehicleId;

  return {
    name: body.name === undefined
      ? fallback.name
      : typeof body.name === 'string' ? body.name : '',
    lat: body.lat === undefined ? fallback.lat : numberValue(body.lat),
    lon: body.lon === undefined ? fallback.lon : numberValue(body.lon),
    radiusKm: body.radiusKm === undefined ? fallback.radiusKm : numberValue(body.radiusKm),
    // Deliberately NOT narrowed here: an invalid value must reach
    // validateLocationInput so it returns 422 instead of being coerced to a
    // silent default.
    locationType: hasLocationType
      ? rawLocationType as LocationType
      : fallback.locationType,
    isGlobal: vehicleId ? false : body.isGlobal === undefined ? fallback.isGlobal : body.isGlobal !== false,
    vehicleId,
  };
}

const CREATE_DEFAULTS: LocationInput = {
  name: '',
  lat: Number.NaN,
  lon: Number.NaN,
  radiusKm: 1,
  locationType: 'other',
  isGlobal: true,
  vehicleId: null,
};

const UPDATE_DEFAULTS: LocationInput = {
  name: 'Existing location',
  lat: 0,
  lon: 0,
  radiusKm: 1,
  locationType: 'other',
  isGlobal: true,
  vehicleId: null,
};

async function verifyVehicle(sql: ReturnType<typeof getSql>, vehicleId: string, res: NextApiResponse): Promise<boolean> {
  const vehicle = await sql`SELECT id FROM fleet_vehicles WHERE id = ${vehicleId}` as Record<string, unknown>[];
  if (vehicle.length > 0) return true;

  apiResponse.validationError(res, { vehicleId: 'Vehicle not found' });
  return false;
}

async function routeHandler(req: NextApiRequest, res: NextApiResponse) {
  const sql = getSqlInstance();

  switch (req.method) {
    case 'GET': {
      const { id, vehicleId, global, type, active } = req.query;

      if (id) {
        const locations = await sql`
          SELECT fal.*, fal.radius_km as "radiusKm", fal.location_type as "locationType",
            fal.is_global as "isGlobal", fal.vehicle_id as "vehicleId", fal.is_active as "isActive",
            fal.created_at as "createdAt", fv.registration as "vehicleRegistration"
          FROM fleet_authorized_locations fal
          LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
          WHERE fal.id = ${id as string}
        ` as Record<string, unknown>[];

        if (locations.length === 0) {
          return apiResponse.notFound(res, 'Authorized Location', id as string);
        }

        return apiResponse.success(res, locations[0]);
      }

      let locations;
      if (vehicleId) {
        locations = await sql`
          SELECT fal.*, fal.radius_km as "radiusKm", fal.location_type as "locationType",
            fal.is_global as "isGlobal", fal.vehicle_id as "vehicleId", fal.is_active as "isActive",
            fal.created_at as "createdAt", fv.registration as "vehicleRegistration"
          FROM fleet_authorized_locations fal
          LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
          WHERE fal.is_active = true AND (fal.is_global = true OR fal.vehicle_id = ${vehicleId as string})
          ORDER BY fal.is_global DESC, fal.name ASC
        `;
      } else if (global === 'true') {
        locations = await sql`
          SELECT fal.*, fal.radius_km as "radiusKm", fal.location_type as "locationType",
            fal.is_global as "isGlobal", fal.vehicle_id as "vehicleId", fal.is_active as "isActive",
            fal.created_at as "createdAt"
          FROM fleet_authorized_locations fal
          WHERE fal.is_global = true
          ORDER BY fal.name ASC
        `;
      } else if (type) {
        locations = await sql`
          SELECT fal.*, fal.radius_km as "radiusKm", fal.location_type as "locationType",
            fal.is_global as "isGlobal", fal.vehicle_id as "vehicleId", fal.is_active as "isActive",
            fal.created_at as "createdAt", fv.registration as "vehicleRegistration"
          FROM fleet_authorized_locations fal
          LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
          WHERE fal.location_type = ${type as string}
          ORDER BY fal.is_global DESC, fal.name ASC
        `;
      } else if (active === 'false') {
        locations = await sql`
          SELECT fal.*, fal.radius_km as "radiusKm", fal.location_type as "locationType",
            fal.is_global as "isGlobal", fal.vehicle_id as "vehicleId", fal.is_active as "isActive",
            fal.created_at as "createdAt", fv.registration as "vehicleRegistration"
          FROM fleet_authorized_locations fal
          LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
          ORDER BY fal.is_active DESC, fal.is_global DESC, fal.name ASC
        `;
      } else {
        locations = await sql`
          SELECT fal.*, fal.radius_km as "radiusKm", fal.location_type as "locationType",
            fal.is_global as "isGlobal", fal.vehicle_id as "vehicleId", fal.is_active as "isActive",
            fal.created_at as "createdAt", fv.registration as "vehicleRegistration"
          FROM fleet_authorized_locations fal
          LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
          WHERE fal.is_active = true
          ORDER BY fal.is_global DESC, fal.name ASC
        `;
      }

      return apiResponse.success(res, locations);
    }

    case 'POST': {
      const input = normalizeLocationInput(requestBody(req.body), CREATE_DEFAULTS);
      const errors = validateLocationInput(input);
      if (Object.keys(errors).length > 0) {
        return apiResponse.validationError(res, errors);
      }

      if (input.vehicleId && !await verifyVehicle(sql, input.vehicleId, res)) return;

      const newLocation = await sql`
        INSERT INTO fleet_authorized_locations (
          name, lat, lon, radius_km, location_type, is_global, vehicle_id, is_active
        ) VALUES (
          ${input.name.trim()}, ${input.lat}, ${input.lon}, ${input.radiusKm}, ${input.locationType},
          ${input.isGlobal}, ${input.vehicleId}, ${true}
        )
        RETURNING *, radius_km as "radiusKm", location_type as "locationType", is_global as "isGlobal",
          vehicle_id as "vehicleId", is_active as "isActive", created_at as "createdAt"
      ` as Record<string, unknown>[];

      return apiResponse.created(res, newLocation[0], 'Authorized location created successfully');
    }

    case 'PUT': {
      const { id } = req.query;
      if (!id) return apiResponse.validationError(res, { id: 'Location ID is required' });

      const body = requestBody(req.body);
      const input = normalizeLocationInput(body, UPDATE_DEFAULTS);
      const relationshipUpdated = body.isGlobal !== undefined
        || Object.prototype.hasOwnProperty.call(body, 'vehicleId');
      const isActive = isActiveValue(body.isActive);
      const errors: Record<string, string> = {
        ...validateLocationInput(input),
        ...(isActive === 'invalid' ? { isActive: 'isActive must be a boolean' } : {}),
      };
      if (Object.keys(errors).length > 0) {
        return apiResponse.validationError(res, errors);
      }

      if (Object.prototype.hasOwnProperty.call(body, 'vehicleId') && input.vehicleId
        && !await verifyVehicle(sql, input.vehicleId, res)) return;

      const updatedLocation = await sql`
        UPDATE fleet_authorized_locations
        SET
          name = COALESCE(${body.name === undefined ? null : input.name.trim()}, name),
          lat = COALESCE(${body.lat === undefined ? null : input.lat}, lat),
          lon = COALESCE(${body.lon === undefined ? null : input.lon}, lon),
          radius_km = COALESCE(${body.radiusKm === undefined ? null : input.radiusKm}, radius_km),
          location_type = COALESCE(${body.locationType ?? body.location_type ?? null}, location_type),
          is_global = CASE WHEN ${relationshipUpdated} THEN ${input.isGlobal} ELSE is_global END,
          vehicle_id = CASE
            WHEN ${relationshipUpdated && input.isGlobal} THEN NULL
            WHEN ${Object.prototype.hasOwnProperty.call(body, 'vehicleId')} THEN ${input.vehicleId}
            ELSE vehicle_id
          END,
          is_active = COALESCE(${isActive}, is_active)
        WHERE id = ${id as string}
        RETURNING *, radius_km as "radiusKm", location_type as "locationType", is_global as "isGlobal",
          vehicle_id as "vehicleId", is_active as "isActive", created_at as "createdAt"
      ` as Record<string, unknown>[];

      if (updatedLocation.length === 0) {
        return apiResponse.notFound(res, 'Authorized Location', id as string);
      }

      return apiResponse.success(res, updatedLocation[0], 'Location updated successfully');
    }

    case 'DELETE': {
      const { id, permanent } = req.query;
      if (!id) return apiResponse.validationError(res, { id: 'Location ID is required' });

      if (permanent === 'true') {
        const result = await sql`
          DELETE FROM fleet_authorized_locations WHERE id = ${id as string} RETURNING id
        ` as Record<string, unknown>[];
        if (result.length === 0) return apiResponse.notFound(res, 'Authorized Location', id as string);

        return apiResponse.success(res, { id: result[0]?.id }, 'Location permanently deleted');
      }

      const result = await sql`
        UPDATE fleet_authorized_locations SET is_active = false WHERE id = ${id as string} RETURNING id
      ` as Record<string, unknown>[];
      if (result.length === 0) return apiResponse.notFound(res, 'Authorized Location', id as string);

      return apiResponse.success(res, { id: result[0]?.id }, 'Location deactivated successfully');
    }

    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT', 'DELETE']);
  }
}

const errorHandled = withErrorHandler(routeHandler);

async function permissionRouted(req: NextApiRequest, res: NextApiResponse) {
  return withPermission('fleet.locations', actionForMethod(req.method))(errorHandled)(req, res);
}

export default withAuth(permissionRouted);
