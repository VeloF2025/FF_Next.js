/**
 * Fleet Vehicles API
 * CRUD operations for fleet vehicles
 *
 * GET /api/fleet/vehicles - List all vehicles (with optional filters)
 * GET /api/fleet/vehicles?id={id} - Get single vehicle
 * POST /api/fleet/vehicles - Create new vehicle
 * PUT /api/fleet/vehicles?id={id} - Update vehicle
 * DELETE /api/fleet/vehicles?id={id} - Soft delete (set status to 'retired')
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { getSql } from '@/lib/neon-sql';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import type { FleetVehicle, VehicleType, OwnershipType, VehicleStatus } from '@/modules/fleet/types';

const getSqlInstance = () => getSql();

// Validation helpers
function validateRegistration(registration: string): string | null {
  if (!registration || registration.trim().length === 0) {
    return 'Registration is required';
  }
  if (registration.length > 20) {
    return 'Registration must be 20 characters or less';
  }
  return null;
}

function validateVehicleType(type: string): type is VehicleType {
  const validTypes: VehicleType[] = ['bakkie', 'sedan', 'van', 'truck', 'suv', 'motorcycle', 'other'];
  return validTypes.includes(type as VehicleType);
}

function validateOwnershipType(type: string): type is OwnershipType {
  const validTypes: OwnershipType[] = ['company', 'rental', 'leased'];
  return validTypes.includes(type as OwnershipType);
}

function validateYear(year: number | undefined): string | null {
  if (year !== undefined) {
    if (year < 1900 || year > 2100) {
      return 'Year must be between 1900 and 2100';
    }
  }
  return null;
}

function validateRates(fuelRate: number | undefined, depreciationRate: number | undefined): string | null {
  if (fuelRate !== undefined && fuelRate <= 0) {
    return 'Fuel rate must be positive';
  }
  if (depreciationRate !== undefined && depreciationRate < 0) {
    return 'Depreciation rate cannot be negative';
  }
  return null;
}

export default withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const sql = getSqlInstance();

  switch (req.method) {
    case 'GET': {
      const { id, status, type, search, assigned, page = '1', limit = '50' } = req.query;

      // Single vehicle by ID
      if (id) {
        const vehicles = await sql`
          SELECT
            fv.*,
            fv.fuel_rate_per_km as "fuelRatePerKm",
            fv.depreciation_rate_per_km as "depreciationRatePerKm",
            fv.vehicle_type as "vehicleType",
            fv.ownership_type as "ownershipType",
            fv.owner_name as "ownerName",
            fv.is_financed as "isFinanced",
            fv.natis_number as "natisNumber",
            fv.engine_number as "engineNumber",
            fv.chassis_number as "chassisNumber",
            fv.created_at as "createdAt",
            fv.updated_at as "updatedAt",
            va.staff_id as "assignedStaffId",
            CONCAT(s.first_name, ' ', s.last_name) as "assignedStaffName"
          FROM fleet_vehicles fv
          LEFT JOIN vehicle_assignments va ON va.fleet_vehicle_id = fv.id AND va.is_active = true
          LEFT JOIN staff s ON s.id = va.staff_id
          WHERE fv.id = ${id as string}
        `;

        const vehiclesArr = vehicles as Record<string, unknown>[];
        if (vehiclesArr.length === 0) {
          return apiResponse.notFound(res, 'Vehicle', id as string);
        }

        return apiResponse.success(res, vehiclesArr[0]);
      }

      // List vehicles with filters
      let vehicles;
      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);
      const offset = (pageNum - 1) * limitNum;

      // Build base query conditions
      if (status && type && search) {
        const searchTerm = `%${search}%`;
        vehicles = await sql`
          SELECT
            fv.*,
            fv.fuel_rate_per_km as "fuelRatePerKm",
            fv.depreciation_rate_per_km as "depreciationRatePerKm",
            fv.vehicle_type as "vehicleType",
            fv.ownership_type as "ownershipType",
            fv.owner_name as "ownerName",
            fv.is_financed as "isFinanced",
            fv.natis_number as "natisNumber",
            fv.engine_number as "engineNumber",
            fv.chassis_number as "chassisNumber",
            fv.created_at as "createdAt",
            fv.updated_at as "updatedAt",
            va.staff_id as "assignedStaffId",
            CONCAT(s.first_name, ' ', s.last_name) as "assignedStaffName"
          FROM fleet_vehicles fv
          LEFT JOIN vehicle_assignments va ON va.fleet_vehicle_id = fv.id AND va.is_active = true
          LEFT JOIN staff s ON s.id = va.staff_id
          WHERE fv.status = ${status}
            AND fv.vehicle_type = ${type}
            AND (
              LOWER(fv.registration) LIKE LOWER(${searchTerm}) OR
              LOWER(fv.make) LIKE LOWER(${searchTerm}) OR
              LOWER(fv.model) LIKE LOWER(${searchTerm})
            )
          ORDER BY fv.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (status && type) {
        vehicles = await sql`
          SELECT
            fv.*,
            fv.fuel_rate_per_km as "fuelRatePerKm",
            fv.depreciation_rate_per_km as "depreciationRatePerKm",
            fv.vehicle_type as "vehicleType",
            fv.ownership_type as "ownershipType",
            fv.owner_name as "ownerName",
            fv.is_financed as "isFinanced",
            fv.natis_number as "natisNumber",
            fv.engine_number as "engineNumber",
            fv.chassis_number as "chassisNumber",
            fv.created_at as "createdAt",
            fv.updated_at as "updatedAt",
            va.staff_id as "assignedStaffId",
            CONCAT(s.first_name, ' ', s.last_name) as "assignedStaffName"
          FROM fleet_vehicles fv
          LEFT JOIN vehicle_assignments va ON va.fleet_vehicle_id = fv.id AND va.is_active = true
          LEFT JOIN staff s ON s.id = va.staff_id
          WHERE fv.status = ${status} AND fv.vehicle_type = ${type}
          ORDER BY fv.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (status) {
        vehicles = await sql`
          SELECT
            fv.*,
            fv.fuel_rate_per_km as "fuelRatePerKm",
            fv.depreciation_rate_per_km as "depreciationRatePerKm",
            fv.vehicle_type as "vehicleType",
            fv.ownership_type as "ownershipType",
            fv.owner_name as "ownerName",
            fv.is_financed as "isFinanced",
            fv.natis_number as "natisNumber",
            fv.engine_number as "engineNumber",
            fv.chassis_number as "chassisNumber",
            fv.created_at as "createdAt",
            fv.updated_at as "updatedAt",
            va.staff_id as "assignedStaffId",
            CONCAT(s.first_name, ' ', s.last_name) as "assignedStaffName"
          FROM fleet_vehicles fv
          LEFT JOIN vehicle_assignments va ON va.fleet_vehicle_id = fv.id AND va.is_active = true
          LEFT JOIN staff s ON s.id = va.staff_id
          WHERE fv.status = ${status}
          ORDER BY fv.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (type) {
        vehicles = await sql`
          SELECT
            fv.*,
            fv.fuel_rate_per_km as "fuelRatePerKm",
            fv.depreciation_rate_per_km as "depreciationRatePerKm",
            fv.vehicle_type as "vehicleType",
            fv.ownership_type as "ownershipType",
            fv.owner_name as "ownerName",
            fv.is_financed as "isFinanced",
            fv.natis_number as "natisNumber",
            fv.engine_number as "engineNumber",
            fv.chassis_number as "chassisNumber",
            fv.created_at as "createdAt",
            fv.updated_at as "updatedAt",
            va.staff_id as "assignedStaffId",
            CONCAT(s.first_name, ' ', s.last_name) as "assignedStaffName"
          FROM fleet_vehicles fv
          LEFT JOIN vehicle_assignments va ON va.fleet_vehicle_id = fv.id AND va.is_active = true
          LEFT JOIN staff s ON s.id = va.staff_id
          WHERE fv.vehicle_type = ${type}
          ORDER BY fv.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (search) {
        const searchTerm = `%${search}%`;
        vehicles = await sql`
          SELECT
            fv.*,
            fv.fuel_rate_per_km as "fuelRatePerKm",
            fv.depreciation_rate_per_km as "depreciationRatePerKm",
            fv.vehicle_type as "vehicleType",
            fv.ownership_type as "ownershipType",
            fv.owner_name as "ownerName",
            fv.is_financed as "isFinanced",
            fv.natis_number as "natisNumber",
            fv.engine_number as "engineNumber",
            fv.chassis_number as "chassisNumber",
            fv.created_at as "createdAt",
            fv.updated_at as "updatedAt",
            va.staff_id as "assignedStaffId",
            CONCAT(s.first_name, ' ', s.last_name) as "assignedStaffName"
          FROM fleet_vehicles fv
          LEFT JOIN vehicle_assignments va ON va.fleet_vehicle_id = fv.id AND va.is_active = true
          LEFT JOIN staff s ON s.id = va.staff_id
          WHERE (
            LOWER(fv.registration) LIKE LOWER(${searchTerm}) OR
            LOWER(fv.make) LIKE LOWER(${searchTerm}) OR
            LOWER(fv.model) LIKE LOWER(${searchTerm})
          )
          ORDER BY fv.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (assigned === 'true') {
        vehicles = await sql`
          SELECT
            fv.*,
            fv.fuel_rate_per_km as "fuelRatePerKm",
            fv.depreciation_rate_per_km as "depreciationRatePerKm",
            fv.vehicle_type as "vehicleType",
            fv.ownership_type as "ownershipType",
            fv.owner_name as "ownerName",
            fv.is_financed as "isFinanced",
            fv.natis_number as "natisNumber",
            fv.engine_number as "engineNumber",
            fv.chassis_number as "chassisNumber",
            fv.created_at as "createdAt",
            fv.updated_at as "updatedAt",
            va.staff_id as "assignedStaffId",
            CONCAT(s.first_name, ' ', s.last_name) as "assignedStaffName"
          FROM fleet_vehicles fv
          INNER JOIN vehicle_assignments va ON va.fleet_vehicle_id = fv.id AND va.is_active = true
          LEFT JOIN staff s ON s.id = va.staff_id
          WHERE fv.status = 'active'
          ORDER BY fv.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (assigned === 'false') {
        vehicles = await sql`
          SELECT
            fv.*,
            fv.fuel_rate_per_km as "fuelRatePerKm",
            fv.depreciation_rate_per_km as "depreciationRatePerKm",
            fv.vehicle_type as "vehicleType",
            fv.ownership_type as "ownershipType",
            fv.owner_name as "ownerName",
            fv.is_financed as "isFinanced",
            fv.natis_number as "natisNumber",
            fv.engine_number as "engineNumber",
            fv.chassis_number as "chassisNumber",
            fv.created_at as "createdAt",
            fv.updated_at as "updatedAt",
            NULL as "assignedStaffId",
            NULL as "assignedStaffName"
          FROM fleet_vehicles fv
          LEFT JOIN vehicle_assignments va ON va.fleet_vehicle_id = fv.id AND va.is_active = true
          WHERE fv.status = 'active' AND va.id IS NULL
          ORDER BY fv.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else {
        vehicles = await sql`
          SELECT
            fv.*,
            fv.fuel_rate_per_km as "fuelRatePerKm",
            fv.depreciation_rate_per_km as "depreciationRatePerKm",
            fv.vehicle_type as "vehicleType",
            fv.ownership_type as "ownershipType",
            fv.owner_name as "ownerName",
            fv.is_financed as "isFinanced",
            fv.natis_number as "natisNumber",
            fv.engine_number as "engineNumber",
            fv.chassis_number as "chassisNumber",
            fv.created_at as "createdAt",
            fv.updated_at as "updatedAt",
            va.staff_id as "assignedStaffId",
            CONCAT(s.first_name, ' ', s.last_name) as "assignedStaffName",
            ld.expiry_date as "licenseDiscExpiry",
            CASE
              WHEN ld.expiry_date IS NULL THEN NULL
              WHEN ld.expiry_date < CURRENT_DATE THEN 'expired'
              WHEN ld.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'critical'
              WHEN ld.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'warning'
              ELSE 'ok'
            END as "expiryStatus"
          FROM fleet_vehicles fv
          LEFT JOIN vehicle_assignments va ON va.fleet_vehicle_id = fv.id AND va.is_active = true
          LEFT JOIN staff s ON s.id = va.staff_id
          LEFT JOIN LATERAL (
            SELECT expiry_date FROM fleet_license_disc
            WHERE vehicle_id = fv.id
            ORDER BY expiry_date DESC
            LIMIT 1
          ) ld ON true
          ORDER BY fv.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      }

      // Get total count for pagination
      const countResult = await sql`SELECT COUNT(*) as total FROM fleet_vehicles` as Record<string, unknown>[];
      const total = parseInt((countResult[0]?.total as string) || '0', 10);

      return apiResponse.paginated(res, vehicles as Record<string, unknown>[], {
        page: pageNum,
        pageSize: limitNum,
        total,
      });
    }

    case 'POST': {
      const body = req.body;

      // Validate required fields
      const registrationError = validateRegistration(body.registration);
      if (registrationError) {
        return apiResponse.validationError(res, { registration: registrationError });
      }

      // Validate vehicle type
      const vehicleType = body.vehicleType || body.vehicle_type || 'other';
      if (!validateVehicleType(vehicleType)) {
        return apiResponse.validationError(res, {
          vehicleType: 'Invalid vehicle type. Must be: bakkie, sedan, van, truck, suv, motorcycle, or other',
        });
      }

      // Validate ownership type
      const ownershipType = body.ownershipType || body.ownership_type || 'company';
      if (!validateOwnershipType(ownershipType)) {
        return apiResponse.validationError(res, {
          ownershipType: 'Invalid ownership type. Must be: company, rental, or leased',
        });
      }

      // Validate year
      const year = body.year ? parseInt(body.year, 10) : undefined;
      const yearError = validateYear(year);
      if (yearError) {
        return apiResponse.validationError(res, { year: yearError });
      }

      // Validate rates
      const fuelRate = body.fuelRatePerKm || body.fuel_rate_per_km || 3.0;
      const depreciationRate = body.depreciationRatePerKm || body.depreciation_rate_per_km || 1.5;
      const rateError = validateRates(fuelRate, depreciationRate);
      if (rateError) {
        return apiResponse.validationError(res, { rates: rateError });
      }

      try {
        const newVehicle = await sql`
          INSERT INTO fleet_vehicles (
            registration,
            vehicle_type,
            make,
            model,
            year,
            color,
            vin,
            engine_number,
            ownership_type,
            owner_name,
            fuel_rate_per_km,
            depreciation_rate_per_km,
            status,
            notes
          )
          VALUES (
            ${body.registration.toUpperCase().trim()},
            ${vehicleType},
            ${body.make || null},
            ${body.model || null},
            ${year || null},
            ${body.color || null},
            ${body.vin || null},
            ${body.engineNumber || body.engine_number || null},
            ${ownershipType},
            ${body.ownerName || body.owner_name || null},
            ${fuelRate},
            ${depreciationRate},
            ${'active'},
            ${body.notes || null}
          )
          RETURNING
            *,
            fuel_rate_per_km as "fuelRatePerKm",
            depreciation_rate_per_km as "depreciationRatePerKm",
            vehicle_type as "vehicleType",
            ownership_type as "ownershipType",
            owner_name as "ownerName",
            engine_number as "engineNumber",
            created_at as "createdAt",
            updated_at as "updatedAt"
        `;

        const newVehicleArr = newVehicle as Record<string, unknown>[];
        return apiResponse.created(res, newVehicleArr[0], 'Vehicle created successfully');
      } catch (error: any) {
        if (error.message?.includes('fleet_vehicles_registration_key') || error.code === '23505') {
          return apiResponse.error(
            res,
            ErrorCode.CONFLICT,
            `Vehicle with registration "${body.registration}" already exists`
          );
        }
        throw error;
      }
    }

    case 'PUT': {
      const { id } = req.query;
      if (!id) {
        return apiResponse.validationError(res, { id: 'Vehicle ID is required' });
      }

      const body = req.body;

      // Validate registration if provided
      if (body.registration) {
        const registrationError = validateRegistration(body.registration);
        if (registrationError) {
          return apiResponse.validationError(res, { registration: registrationError });
        }
      }

      // Validate vehicle type if provided
      if (body.vehicleType || body.vehicle_type) {
        const vehicleType = body.vehicleType || body.vehicle_type;
        if (!validateVehicleType(vehicleType)) {
          return apiResponse.validationError(res, {
            vehicleType: 'Invalid vehicle type',
          });
        }
      }

      // Validate ownership type if provided
      if (body.ownershipType || body.ownership_type) {
        const ownershipType = body.ownershipType || body.ownership_type;
        if (!validateOwnershipType(ownershipType)) {
          return apiResponse.validationError(res, {
            ownershipType: 'Invalid ownership type',
          });
        }
      }

      // Validate year if provided
      if (body.year) {
        const yearError = validateYear(parseInt(body.year, 10));
        if (yearError) {
          return apiResponse.validationError(res, { year: yearError });
        }
      }

      // Validate rates if provided
      const rateError = validateRates(
        body.fuelRatePerKm || body.fuel_rate_per_km,
        body.depreciationRatePerKm || body.depreciation_rate_per_km
      );
      if (rateError) {
        return apiResponse.validationError(res, { rates: rateError });
      }

      try {
        const updatedVehicle = await sql`
          UPDATE fleet_vehicles
          SET
            registration = COALESCE(${body.registration?.toUpperCase()?.trim()}, registration),
            vehicle_type = COALESCE(${body.vehicleType || body.vehicle_type}, vehicle_type),
            make = COALESCE(${body.make}, make),
            model = COALESCE(${body.model}, model),
            year = COALESCE(${body.year ? parseInt(body.year, 10) : null}, year),
            color = COALESCE(${body.color}, color),
            vin = COALESCE(${body.vin}, vin),
            engine_number = COALESCE(${body.engineNumber || body.engine_number}, engine_number),
            ownership_type = COALESCE(${body.ownershipType || body.ownership_type}, ownership_type),
            owner_name = COALESCE(${body.ownerName || body.owner_name}, owner_name),
            fuel_rate_per_km = COALESCE(${body.fuelRatePerKm || body.fuel_rate_per_km}, fuel_rate_per_km),
            depreciation_rate_per_km = COALESCE(${body.depreciationRatePerKm || body.depreciation_rate_per_km}, depreciation_rate_per_km),
            status = COALESCE(${body.status}, status),
            notes = COALESCE(${body.notes}, notes),
            updated_at = NOW()
          WHERE id = ${id as string}
          RETURNING
            *,
            fuel_rate_per_km as "fuelRatePerKm",
            depreciation_rate_per_km as "depreciationRatePerKm",
            vehicle_type as "vehicleType",
            ownership_type as "ownershipType",
            owner_name as "ownerName",
            engine_number as "engineNumber",
            created_at as "createdAt",
            updated_at as "updatedAt"
        `;

        const updatedVehicleArr = updatedVehicle as Record<string, unknown>[];
        if (updatedVehicleArr.length === 0) {
          return apiResponse.notFound(res, 'Vehicle', id as string);
        }

        return apiResponse.success(res, updatedVehicleArr[0], 'Vehicle updated successfully');
      } catch (error: any) {
        if (error.message?.includes('fleet_vehicles_registration_key') || error.code === '23505') {
          return apiResponse.error(
            res,
            ErrorCode.CONFLICT,
            `Vehicle with registration "${body.registration}" already exists`
          );
        }
        throw error;
      }
    }

    case 'DELETE': {
      const { id, permanent } = req.query;
      if (!id) {
        return apiResponse.validationError(res, { id: 'Vehicle ID is required' });
      }

      // Permanent delete - actually removes from database
      if (permanent === 'true') {
        // First check if vehicle exists
        const vehicle = await sql`
          SELECT id, status, registration FROM fleet_vehicles WHERE id = ${id as string}
        ` as Record<string, unknown>[];

        if (vehicle.length === 0) {
          return apiResponse.notFound(res, 'Vehicle', id as string);
        }

        // Delete related records first (cascade manually for safety)
        // Order matters due to foreign key dependencies

        // Check-in related (photos/responses depend on records)
        await sql`DELETE FROM fleet_check_photos WHERE record_id IN (SELECT id FROM fleet_check_records WHERE vehicle_id = ${id as string})`;
        await sql`DELETE FROM fleet_check_responses WHERE record_id IN (SELECT id FROM fleet_check_records WHERE vehicle_id = ${id as string})`;
        await sql`DELETE FROM fleet_check_records WHERE vehicle_id = ${id as string}`;

        // GPS jobs and trips
        await sql`DELETE FROM fleet_gps_trips WHERE job_id IN (SELECT id FROM fleet_gps_jobs WHERE vehicle_id = ${id as string})`;
        await sql`DELETE FROM fleet_gps_jobs WHERE vehicle_id = ${id as string}`;

        // Authorized locations (if vehicle-specific)
        await sql`DELETE FROM fleet_authorized_locations WHERE vehicle_id = ${id as string}`;

        // Assignments
        await sql`DELETE FROM vehicle_assignments WHERE fleet_vehicle_id = ${id as string}`;

        // Ownership/documents
        await sql`DELETE FROM fleet_vehicle_documents WHERE vehicle_id = ${id as string}`;
        await sql`DELETE FROM fleet_license_disc WHERE vehicle_id = ${id as string}`;
        await sql`DELETE FROM fleet_vehicle_finance WHERE vehicle_id = ${id as string}`;
        await sql`DELETE FROM fleet_vehicle_lease WHERE vehicle_id = ${id as string}`;
        await sql`DELETE FROM fleet_vehicle_insurance WHERE vehicle_id = ${id as string}`;

        // Now delete the vehicle
        const result = await sql`
          DELETE FROM fleet_vehicles WHERE id = ${id as string} RETURNING id
        ` as Record<string, unknown>[];

        return apiResponse.success(res, { id: result[0]?.id }, 'Vehicle permanently deleted');
      }

      // Soft delete by setting status to 'retired'
      const result = await sql`
        UPDATE fleet_vehicles
        SET status = 'retired', updated_at = NOW()
        WHERE id = ${id as string}
        RETURNING id
      ` as Record<string, unknown>[];

      if (result.length === 0) {
        return apiResponse.notFound(res, 'Vehicle', id as string);
      }

      return apiResponse.success(res, { id: result[0]?.id }, 'Vehicle retired successfully');
    }

    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT', 'DELETE']);
  }
});
