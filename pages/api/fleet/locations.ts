/**
 * Fleet Authorized Locations API
 * CRUD operations for authorized locations (geofencing)
 *
 * GET /api/fleet/locations - List all locations (global + vehicle-specific)
 * GET /api/fleet/locations?vehicleId={id} - Get locations for a specific vehicle
 * POST /api/fleet/locations - Create new authorized location
 * PUT /api/fleet/locations?id={id} - Update location
 * DELETE /api/fleet/locations?id={id} - Delete location
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { getSql } from '@/lib/neon-sql';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import type { AuthorizedLocation, LocationType } from '@/modules/fleet/types';
import { withAuth } from '@/lib/auth';

const getSqlInstance = () => getSql();

// Validation helpers
function validateName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return 'Name is required';
  }
  if (name.length > 100) {
    return 'Name must be 100 characters or less';
  }
  return null;
}

function validateCoordinates(lat: number, lon: number): string | null {
  if (lat === undefined || lat === null) {
    return 'Latitude is required';
  }
  if (lon === undefined || lon === null) {
    return 'Longitude is required';
  }
  if (lat < -90 || lat > 90) {
    return 'Latitude must be between -90 and 90';
  }
  if (lon < -180 || lon > 180) {
    return 'Longitude must be between -180 and 180';
  }
  return null;
}

function validateRadius(radiusKm: number): string | null {
  if (radiusKm === undefined || radiusKm === null) {
    return null; // Optional, uses default
  }
  if (radiusKm <= 0 || radiusKm > 100) {
    return 'Radius must be between 0 and 100 km';
  }
  return null;
}

function validateLocationType(type: string): type is LocationType {
  const validTypes: LocationType[] = ['work_site', 'accommodation', 'supplier', 'client', 'depot', 'other'];
  return validTypes.includes(type as LocationType);
}

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const sql = getSqlInstance();

  switch (req.method) {
    case 'GET': {
      const { id, vehicleId, global, type, active } = req.query;

      // Single location by ID
      if (id) {
        const locations = await sql`
          SELECT
            fal.*,
            fal.radius_km as "radiusKm",
            fal.location_type as "locationType",
            fal.is_global as "isGlobal",
            fal.vehicle_id as "vehicleId",
            fal.is_active as "isActive",
            fal.created_at as "createdAt",
            fv.registration as "vehicleRegistration"
          FROM fleet_authorized_locations fal
          LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
          WHERE fal.id = ${id as string}
        ` as Record<string, unknown>[];

        if (locations.length === 0) {
          return apiResponse.notFound(res, 'Authorized Location', id as string);
        }

        return apiResponse.success(res, locations[0]);
      }

      // List locations with filters
      let locations;

      if (vehicleId) {
        // Get locations for specific vehicle (global + vehicle-specific)
        locations = await sql`
          SELECT
            fal.*,
            fal.radius_km as "radiusKm",
            fal.location_type as "locationType",
            fal.is_global as "isGlobal",
            fal.vehicle_id as "vehicleId",
            fal.is_active as "isActive",
            fal.created_at as "createdAt",
            fv.registration as "vehicleRegistration"
          FROM fleet_authorized_locations fal
          LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
          WHERE fal.is_active = true
            AND (fal.is_global = true OR fal.vehicle_id = ${vehicleId as string})
          ORDER BY fal.is_global DESC, fal.name ASC
        `;
      } else if (global === 'true') {
        // Only global locations
        locations = await sql`
          SELECT
            fal.*,
            fal.radius_km as "radiusKm",
            fal.location_type as "locationType",
            fal.is_global as "isGlobal",
            fal.vehicle_id as "vehicleId",
            fal.is_active as "isActive",
            fal.created_at as "createdAt"
          FROM fleet_authorized_locations fal
          WHERE fal.is_global = true
          ORDER BY fal.name ASC
        `;
      } else if (type) {
        // Filter by location type
        locations = await sql`
          SELECT
            fal.*,
            fal.radius_km as "radiusKm",
            fal.location_type as "locationType",
            fal.is_global as "isGlobal",
            fal.vehicle_id as "vehicleId",
            fal.is_active as "isActive",
            fal.created_at as "createdAt",
            fv.registration as "vehicleRegistration"
          FROM fleet_authorized_locations fal
          LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
          WHERE fal.location_type = ${type as string}
          ORDER BY fal.is_global DESC, fal.name ASC
        `;
      } else if (active === 'false') {
        // Include inactive locations
        locations = await sql`
          SELECT
            fal.*,
            fal.radius_km as "radiusKm",
            fal.location_type as "locationType",
            fal.is_global as "isGlobal",
            fal.vehicle_id as "vehicleId",
            fal.is_active as "isActive",
            fal.created_at as "createdAt",
            fv.registration as "vehicleRegistration"
          FROM fleet_authorized_locations fal
          LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
          ORDER BY fal.is_active DESC, fal.is_global DESC, fal.name ASC
        `;
      } else {
        // All active locations
        locations = await sql`
          SELECT
            fal.*,
            fal.radius_km as "radiusKm",
            fal.location_type as "locationType",
            fal.is_global as "isGlobal",
            fal.vehicle_id as "vehicleId",
            fal.is_active as "isActive",
            fal.created_at as "createdAt",
            fv.registration as "vehicleRegistration"
          FROM fleet_authorized_locations fal
          LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
          WHERE fal.is_active = true
          ORDER BY fal.is_global DESC, fal.name ASC
        `;
      }

      return apiResponse.success(res, locations);
    }

    case 'POST': {
      const body = req.body;

      // Validate required fields
      const nameError = validateName(body.name);
      if (nameError) {
        return apiResponse.validationError(res, { name: nameError });
      }

      const lat = parseFloat(body.lat);
      const lon = parseFloat(body.lon);
      const coordError = validateCoordinates(lat, lon);
      if (coordError) {
        return apiResponse.validationError(res, { coordinates: coordError });
      }

      const radiusKm = body.radiusKm !== undefined ? parseFloat(body.radiusKm) : 1.0;
      const radiusError = validateRadius(radiusKm);
      if (radiusError) {
        return apiResponse.validationError(res, { radiusKm: radiusError });
      }

      // Validate location type if provided
      const locationType = body.locationType || body.location_type || 'other';
      if (!validateLocationType(locationType)) {
        return apiResponse.validationError(res, {
          locationType: 'Invalid location type. Must be: work_site, accommodation, supplier, client, depot, or other',
        });
      }

      // Determine if global or vehicle-specific
      const isGlobal = body.vehicleId ? false : (body.isGlobal !== false);
      const vehicleId = body.vehicleId || null;

      // If vehicle-specific, verify vehicle exists
      if (vehicleId) {
        const vehicle = await sql`SELECT id FROM fleet_vehicles WHERE id = ${vehicleId}` as Record<string, unknown>[];
        if (vehicle.length === 0) {
          return apiResponse.validationError(res, { vehicleId: 'Vehicle not found' });
        }
      }

      const newLocation = await sql`
        INSERT INTO fleet_authorized_locations (
          name,
          lat,
          lon,
          radius_km,
          location_type,
          is_global,
          vehicle_id,
          is_active
        )
        VALUES (
          ${body.name.trim()},
          ${lat},
          ${lon},
          ${radiusKm},
          ${locationType},
          ${isGlobal},
          ${vehicleId},
          ${true}
        )
        RETURNING
          *,
          radius_km as "radiusKm",
          location_type as "locationType",
          is_global as "isGlobal",
          vehicle_id as "vehicleId",
          is_active as "isActive",
          created_at as "createdAt"
      ` as Record<string, unknown>[];

      return apiResponse.created(res, newLocation[0], 'Authorized location created successfully');
    }

    case 'PUT': {
      const { id } = req.query;
      if (!id) {
        return apiResponse.validationError(res, { id: 'Location ID is required' });
      }

      const body = req.body;

      // Validate name if provided
      if (body.name) {
        const nameError = validateName(body.name);
        if (nameError) {
          return apiResponse.validationError(res, { name: nameError });
        }
      }

      // Validate coordinates if provided
      if (body.lat !== undefined || body.lon !== undefined) {
        const lat = body.lat !== undefined ? parseFloat(body.lat) : null;
        const lon = body.lon !== undefined ? parseFloat(body.lon) : null;
        if (lat !== null && lon !== null) {
          const coordError = validateCoordinates(lat, lon);
          if (coordError) {
            return apiResponse.validationError(res, { coordinates: coordError });
          }
        }
      }

      // Validate radius if provided
      if (body.radiusKm !== undefined) {
        const radiusError = validateRadius(parseFloat(body.radiusKm));
        if (radiusError) {
          return apiResponse.validationError(res, { radiusKm: radiusError });
        }
      }

      // Validate location type if provided
      if (body.locationType || body.location_type) {
        const locationType = body.locationType || body.location_type;
        if (!validateLocationType(locationType)) {
          return apiResponse.validationError(res, { locationType: 'Invalid location type' });
        }
      }

      const updatedLocation = await sql`
        UPDATE fleet_authorized_locations
        SET
          name = COALESCE(${body.name?.trim()}, name),
          lat = COALESCE(${body.lat !== undefined ? parseFloat(body.lat) : null}, lat),
          lon = COALESCE(${body.lon !== undefined ? parseFloat(body.lon) : null}, lon),
          radius_km = COALESCE(${body.radiusKm !== undefined ? parseFloat(body.radiusKm) : null}, radius_km),
          location_type = COALESCE(${body.locationType || body.location_type}, location_type),
          is_global = COALESCE(${body.isGlobal}, is_global),
          vehicle_id = COALESCE(${body.vehicleId}, vehicle_id),
          is_active = COALESCE(${body.isActive}, is_active)
        WHERE id = ${id as string}
        RETURNING
          *,
          radius_km as "radiusKm",
          location_type as "locationType",
          is_global as "isGlobal",
          vehicle_id as "vehicleId",
          is_active as "isActive",
          created_at as "createdAt"
      ` as Record<string, unknown>[];

      if (updatedLocation.length === 0) {
        return apiResponse.notFound(res, 'Authorized Location', id as string);
      }

      return apiResponse.success(res, updatedLocation[0], 'Location updated successfully');
    }

    case 'DELETE': {
      const { id, permanent } = req.query;
      if (!id) {
        return apiResponse.validationError(res, { id: 'Location ID is required' });
      }

      if (permanent === 'true') {
        // Hard delete
        const result = await sql`
          DELETE FROM fleet_authorized_locations
          WHERE id = ${id as string}
          RETURNING id
        ` as Record<string, unknown>[];

        if (result.length === 0) {
          return apiResponse.notFound(res, 'Authorized Location', id as string);
        }

        return apiResponse.success(res, { id: result[0]?.id }, 'Location permanently deleted');
      } else {
        // Soft delete (set is_active to false)
        const result = await sql`
          UPDATE fleet_authorized_locations
          SET is_active = false
          WHERE id = ${id as string}
          RETURNING id
        ` as Record<string, unknown>[];

        if (result.length === 0) {
          return apiResponse.notFound(res, 'Authorized Location', id as string);
        }

        return apiResponse.success(res, { id: result[0]?.id }, 'Location deactivated successfully');
      }
    }

    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT', 'DELETE']);
  }
}));
