/**
 * Fleet Vehicle Assignment API
 * GET /api/fleet/vehicles/[id]/assignment - Get current driver assignment
 * POST /api/fleet/vehicles/[id]/assignment - Assign a driver to this vehicle
 * DELETE /api/fleet/vehicles/[id]/assignment - Unassign driver from this vehicle
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface AssignedDriver {
  assignmentId: string;
  staffId: string;
  staffName: string;
  staffEmail: string | null;
  staffPhone: string | null;
  staffPhotoUrl: string | null;
  assignmentStart: string;
  assignmentEnd: string | null;
  fuelCardNumber: string | null;
  fuelCardLimit: number | null;
  notes: string | null;
  hasValidLicense: boolean;
  licenseExpiry: string | null;
  isActive: boolean;
}

interface AssignDriverRequest {
  staffId: string;
  assignmentStart?: string; // ISO date string, defaults to today
  fuelCardNumber?: string;
  fuelCardLimit?: number;
  notes?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id: vehicleId } = req.query;

  if (!vehicleId || typeof vehicleId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
  }

  try {
    // Verify vehicle exists
    const vehicleCheck = await sql`
      SELECT id, registration, make, model FROM fleet_vehicles WHERE id = ${vehicleId}
    `;

    if (vehicleCheck.length === 0) {
      return apiResponse.notFound(res, 'Vehicle', vehicleId);
    }

    const vehicle = vehicleCheck[0];

    switch (req.method) {
      case 'GET':
        return handleGet(res, vehicleId);
      case 'POST':
        return handlePost(req, res, vehicleId, vehicle);
      case 'DELETE':
        return handleDelete(res, vehicleId);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET', 'POST', 'DELETE']);
    }
  } catch (error) {
    log.error('Fleet vehicle assignment API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(
  res: NextApiResponse,
  vehicleId: string
) {
  // Get current active assignment for this vehicle
  const rows = await sql`
    SELECT
      va.id as assignment_id,
      va.staff_id,
      va.assignment_start,
      va.assignment_end,
      va.fuel_card_number,
      va.fuel_card_limit,
      va.notes,
      va.is_active,
      s.first_name,
      s.last_name,
      s.email,
      s.phone,
      s.id_photo_url as photo_url,
      lic.expiry_date as license_expiry,
      lic.verification_status as license_status
    FROM vehicle_assignments va
    JOIN staff s ON s.id = va.staff_id
    LEFT JOIN LATERAL (
      SELECT expiry_date, verification_status
      FROM staff_documents
      WHERE staff_id = s.id
        AND document_type = 'drivers_license'
      ORDER BY created_at DESC
      LIMIT 1
    ) lic ON true
    WHERE va.fleet_vehicle_id = ${vehicleId}
      AND va.is_active = true
    ORDER BY va.assignment_start DESC
    LIMIT 1
  `;

  if (rows.length === 0) {
    return apiResponse.success(res, {
      assigned: false,
      driver: null,
    });
  }

  const row = rows[0] as Record<string, unknown>;
  const hasValidLicense = row.license_status === 'verified' &&
    (!row.license_expiry || new Date(row.license_expiry as string) > new Date());

  const driver: AssignedDriver = {
    assignmentId: row.assignment_id as string,
    staffId: row.staff_id as string,
    staffName: `${row.first_name} ${row.last_name}`,
    staffEmail: row.email as string | null,
    staffPhone: row.phone as string | null,
    staffPhotoUrl: row.photo_url as string | null,
    assignmentStart: row.assignment_start
      ? new Date(row.assignment_start as string).toISOString().split('T')[0]
      : '',
    assignmentEnd: row.assignment_end
      ? new Date(row.assignment_end as string).toISOString().split('T')[0]
      : null,
    fuelCardNumber: row.fuel_card_number as string | null,
    fuelCardLimit: row.fuel_card_limit as number | null,
    notes: row.notes as string | null,
    hasValidLicense,
    licenseExpiry: row.license_expiry
      ? new Date(row.license_expiry as string).toISOString().split('T')[0]
      : null,
    isActive: row.is_active as boolean,
  };

  return apiResponse.success(res, {
    assigned: true,
    driver,
  });
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string,
  vehicle: Record<string, unknown>
) {
  const body = req.body as AssignDriverRequest;

  if (!body.staffId) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Staff ID is required');
  }

  // Verify staff member exists
  const staffCheck = await sql`
    SELECT id, first_name, last_name FROM staff WHERE id = ${body.staffId}
  `;

  if (staffCheck.length === 0) {
    return apiResponse.notFound(res, 'Staff member', body.staffId);
  }

  const staff = staffCheck[0];

  // Check for valid driver's license
  const licenseCheck = await sql`
    SELECT COUNT(*) as count
    FROM staff_documents
    WHERE staff_id = ${body.staffId}
      AND document_type = 'drivers_license'
      AND verification_status = 'verified'
      AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
  `;

  if ((licenseCheck[0]?.count || 0) === 0) {
    return apiResponse.error(
      res,
      ErrorCode.BAD_REQUEST,
      'Staff member must have a verified, non-expired driver\'s license'
    );
  }

  // Deactivate any existing active assignments for this vehicle
  await sql`
    UPDATE vehicle_assignments
    SET is_active = false, assignment_end = CURRENT_DATE, updated_at = NOW()
    WHERE fleet_vehicle_id = ${vehicleId} AND is_active = true
  `;

  // Deactivate any existing active assignments for this staff member
  await sql`
    UPDATE vehicle_assignments
    SET is_active = false, assignment_end = CURRENT_DATE, updated_at = NOW()
    WHERE staff_id = ${body.staffId} AND is_active = true
  `;

  const assignmentStart = body.assignmentStart || new Date().toISOString().split('T')[0];

  // Create new assignment linked to fleet vehicle
  const [created] = await sql`
    INSERT INTO vehicle_assignments (
      staff_id,
      fleet_vehicle_id,
      vehicle_registration,
      vehicle_make,
      vehicle_model,
      assignment_start,
      fuel_card_number,
      fuel_card_limit,
      notes,
      is_active
    ) VALUES (
      ${body.staffId},
      ${vehicleId},
      ${vehicle.registration as string},
      ${vehicle.make as string || null},
      ${vehicle.model as string || null},
      ${assignmentStart},
      ${body.fuelCardNumber || null},
      ${body.fuelCardLimit || null},
      ${body.notes || null},
      true
    )
    RETURNING *
  `;

  // Update staff has_company_vehicle flag
  await sql`
    UPDATE staff SET has_company_vehicle = true, updated_at = NOW()
    WHERE id = ${body.staffId}
  `;

  // Update fleet_vehicles with assigned_driver_id for quick lookups
  await sql`
    UPDATE fleet_vehicles SET assigned_driver_id = ${body.staffId}, updated_at = NOW()
    WHERE id = ${vehicleId}
  `;

  log.info('Driver assigned to fleet vehicle', {
    vehicleId,
    staffId: body.staffId,
    assignmentId: created.id,
  });

  return apiResponse.created(res, {
    assignment: {
      id: created.id,
      vehicleId,
      staffId: body.staffId,
      staffName: `${staff.first_name} ${staff.last_name}`,
      assignmentStart,
    },
  });
}

async function handleDelete(
  res: NextApiResponse,
  vehicleId: string
) {
  // Get current active assignment
  const existingRows = await sql`
    SELECT va.id, va.staff_id
    FROM vehicle_assignments va
    WHERE va.fleet_vehicle_id = ${vehicleId} AND va.is_active = true
  `;

  if (existingRows.length === 0) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'No active assignment for this vehicle');
  }

  const existing = existingRows[0];

  // Deactivate assignment
  await sql`
    UPDATE vehicle_assignments
    SET is_active = false, assignment_end = CURRENT_DATE, updated_at = NOW()
    WHERE id = ${existing.id}
  `;

  // Check if staff has any other active vehicles
  const activeCount = await sql`
    SELECT COUNT(*) as count FROM vehicle_assignments
    WHERE staff_id = ${existing.staff_id} AND is_active = true
  `;

  if ((activeCount[0]?.count || 0) === 0) {
    await sql`
      UPDATE staff SET has_company_vehicle = false, updated_at = NOW()
      WHERE id = ${existing.staff_id}
    `;
  }

  // Clear assigned_driver_id from fleet_vehicles
  await sql`
    UPDATE fleet_vehicles SET assigned_driver_id = NULL, updated_at = NOW()
    WHERE id = ${vehicleId}
  `;

  log.info('Driver unassigned from fleet vehicle', {
    vehicleId,
    staffId: existing.staff_id,
    assignmentId: existing.id,
  });

  return apiResponse.success(res, {
    message: 'Driver unassigned from vehicle',
  });
}

export default withAuth(handler);
