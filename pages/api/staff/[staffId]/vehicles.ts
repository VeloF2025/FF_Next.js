/**
 * Staff Vehicles API
 * GET /api/staff/[staffId]/vehicles - Get all vehicle assignments
 * POST /api/staff/[staffId]/vehicles - Create new vehicle assignment
 * PUT /api/staff/[staffId]/vehicles?id=xxx - Update vehicle assignment
 * DELETE /api/staff/[staffId]/vehicles?id=xxx - Deactivate vehicle assignment
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import type {
  VehicleAssignment,
  VehicleAssignmentCreate,
  VehicleAssignmentUpdate,
} from '@/types/staff';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffVehiclesAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { staffId, id, activeOnly } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return res.status(400).json({ error: 'Staff ID is required' });
  }

  // GET - Fetch vehicle assignments
  if (req.method === 'GET') {
    try {
      let vehicles;

      if (activeOnly === 'true') {
        vehicles = await sql`
          SELECT
            v.*,
            CONCAT(s.first_name, ' ', s.last_name) as staff_name
          FROM vehicle_assignments v
          LEFT JOIN staff s ON s.id = v.staff_id
          WHERE v.staff_id = ${staffId} AND v.is_active = true
          ORDER BY v.assignment_start DESC
        `;
      } else {
        vehicles = await sql`
          SELECT
            v.*,
            CONCAT(s.first_name, ' ', s.last_name) as staff_name
          FROM vehicle_assignments v
          LEFT JOIN staff s ON s.id = v.staff_id
          WHERE v.staff_id = ${staffId}
          ORDER BY v.is_active DESC, v.assignment_start DESC
        `;
      }

      // Check if staff has valid driver's license
      const [licenseCheck] = await sql`
        SELECT COUNT(*) as count
        FROM staff_documents
        WHERE staff_id = ${staffId}
          AND document_type = 'drivers_license'
          AND verification_status = 'verified'
          AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
      `;

      const hasValidLicense = (licenseCheck?.count || 0) > 0;

      return res.status(200).json({
        success: true,
        vehicles: vehicles.map((v) => mapDbToVehicle(v, hasValidLicense)),
        count: vehicles.length,
        hasValidLicense,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch vehicle assignments', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to fetch vehicle assignments', message: errorMessage });
    }
  }

  // POST - Create vehicle assignment
  if (req.method === 'POST') {
    try {
      const body = req.body as VehicleAssignmentCreate;

      if (!body.vehicleRegistration || !body.assignmentStart) {
        return res.status(400).json({ error: 'Vehicle registration and assignment start date are required' });
      }

      // Check for valid driver's license
      const [licenseCheck] = await sql`
        SELECT COUNT(*) as count
        FROM staff_documents
        WHERE staff_id = ${staffId}
          AND document_type = 'drivers_license'
          AND verification_status = 'verified'
          AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
      `;

      if ((licenseCheck?.count || 0) === 0) {
        return res.status(400).json({
          error: 'Valid driver\'s license required',
          message: 'Staff member must have a verified, non-expired driver\'s license to be assigned a vehicle',
        });
      }

      // Deactivate any existing active assignments for this staff member
      await sql`
        UPDATE vehicle_assignments
        SET is_active = false, assignment_end = CURRENT_DATE, updated_at = NOW()
        WHERE staff_id = ${staffId} AND is_active = true
      `;

      const [created] = await sql`
        INSERT INTO vehicle_assignments (
          staff_id,
          vehicle_registration,
          vehicle_make,
          vehicle_model,
          vehicle_year,
          vehicle_color,
          vehicle_vin,
          assignment_start,
          assignment_end,
          fuel_card_number,
          fuel_card_limit,
          odometer_start,
          insurance_policy_number,
          license_disc_expiry,
          service_due_date,
          service_due_km,
          notes,
          is_active
        ) VALUES (
          ${staffId},
          ${body.vehicleRegistration.toUpperCase()},
          ${body.vehicleMake || null},
          ${body.vehicleModel || null},
          ${body.vehicleYear || null},
          ${body.vehicleColor || null},
          ${body.vehicleVin || null},
          ${body.assignmentStart},
          ${body.assignmentEnd || null},
          ${body.fuelCardNumber || null},
          ${body.fuelCardLimit || null},
          ${body.odometerStart || null},
          ${body.insurancePolicyNumber || null},
          ${body.licenseDiscExpiry || null},
          ${body.serviceDueDate || null},
          ${body.serviceDueKm || null},
          ${body.notes || null},
          true
        )
        RETURNING *
      `;

      if (!created) {
        return res.status(500).json({ error: 'Failed to create vehicle assignment' });
      }

      // Update staff has_company_vehicle flag
      await sql`
        UPDATE staff SET has_company_vehicle = true, updated_at = NOW()
        WHERE id = ${staffId}
      `;

      logger.info('Vehicle assignment created', { staffId, vehicleId: created.id });

      return res.status(201).json({
        success: true,
        vehicle: mapDbToVehicle(created as Record<string, unknown>, true),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create vehicle assignment', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to create vehicle assignment', message: errorMessage });
    }
  }

  // PUT - Update vehicle assignment
  if (req.method === 'PUT') {
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Vehicle assignment ID is required' });
    }

    try {
      const body = req.body as VehicleAssignmentUpdate;

      // Verify assignment belongs to staff member
      const [existing] = await sql`
        SELECT id FROM vehicle_assignments
        WHERE id = ${id} AND staff_id = ${staffId}
      `;

      if (!existing) {
        return res.status(404).json({ error: 'Vehicle assignment not found' });
      }

      const [updated] = await sql`
        UPDATE vehicle_assignments
        SET
          vehicle_registration = COALESCE(${body.vehicleRegistration?.toUpperCase() || null}, vehicle_registration),
          vehicle_make = COALESCE(${body.vehicleMake || null}, vehicle_make),
          vehicle_model = COALESCE(${body.vehicleModel || null}, vehicle_model),
          vehicle_year = COALESCE(${body.vehicleYear || null}, vehicle_year),
          vehicle_color = COALESCE(${body.vehicleColor || null}, vehicle_color),
          vehicle_vin = COALESCE(${body.vehicleVin || null}, vehicle_vin),
          assignment_start = COALESCE(${body.assignmentStart || null}, assignment_start),
          assignment_end = COALESCE(${body.assignmentEnd || null}, assignment_end),
          fuel_card_number = COALESCE(${body.fuelCardNumber || null}, fuel_card_number),
          fuel_card_limit = COALESCE(${body.fuelCardLimit || null}, fuel_card_limit),
          odometer_start = COALESCE(${body.odometerStart || null}, odometer_start),
          odometer_current = COALESCE(${body.odometerCurrent || null}, odometer_current),
          insurance_policy_number = COALESCE(${body.insurancePolicyNumber || null}, insurance_policy_number),
          license_disc_expiry = COALESCE(${body.licenseDiscExpiry || null}, license_disc_expiry),
          service_due_date = COALESCE(${body.serviceDueDate || null}, service_due_date),
          service_due_km = COALESCE(${body.serviceDueKm || null}, service_due_km),
          notes = COALESCE(${body.notes || null}, notes),
          is_active = COALESCE(${body.isActive ?? null}, is_active),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      if (!updated) {
        return res.status(500).json({ error: 'Failed to update vehicle assignment' });
      }

      logger.info('Vehicle assignment updated', { staffId, vehicleId: id });

      return res.status(200).json({
        success: true,
        vehicle: mapDbToVehicle(updated as Record<string, unknown>, true),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update vehicle assignment', { staffId, id, error: errorMessage });
      return res.status(500).json({ error: 'Failed to update vehicle assignment', message: errorMessage });
    }
  }

  // DELETE - Deactivate vehicle assignment (soft delete)
  if (req.method === 'DELETE') {
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Vehicle assignment ID is required' });
    }

    try {
      // Verify assignment belongs to staff member
      const [existing] = await sql`
        SELECT id FROM vehicle_assignments
        WHERE id = ${id} AND staff_id = ${staffId}
      `;

      if (!existing) {
        return res.status(404).json({ error: 'Vehicle assignment not found' });
      }

      await sql`
        UPDATE vehicle_assignments
        SET is_active = false, assignment_end = CURRENT_DATE, updated_at = NOW()
        WHERE id = ${id}
      `;

      // Check if staff has any other active vehicles
      const [activeCount] = await sql`
        SELECT COUNT(*) as count FROM vehicle_assignments
        WHERE staff_id = ${staffId} AND is_active = true
      `;

      if ((activeCount?.count || 0) === 0) {
        await sql`
          UPDATE staff SET has_company_vehicle = false, updated_at = NOW()
          WHERE id = ${staffId}
        `;
      }

      logger.info('Vehicle assignment deactivated', { staffId, vehicleId: id });

      return res.status(200).json({
        success: true,
        message: 'Vehicle assignment deactivated',
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to deactivate vehicle assignment', { staffId, id, error: errorMessage });
      return res.status(500).json({ error: 'Failed to deactivate vehicle assignment', message: errorMessage });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withArcjetProtection(handler, aj);

// Map database row to VehicleAssignment interface
function mapDbToVehicle(row: Record<string, unknown>, hasValidLicense: boolean): VehicleAssignment {
  return {
    id: row.id as string,
    staffId: row.staff_id as string,
    vehicleRegistration: row.vehicle_registration as string,
    vehicleMake: row.vehicle_make as string | undefined,
    vehicleModel: row.vehicle_model as string | undefined,
    vehicleYear: row.vehicle_year as number | undefined,
    vehicleColor: row.vehicle_color as string | undefined,
    vehicleVin: row.vehicle_vin as string | undefined,
    assignmentStart: (row.assignment_start
      ? new Date(row.assignment_start as string).toISOString().split('T')[0]
      : '') as string,
    assignmentEnd: row.assignment_end
      ? new Date(row.assignment_end as string).toISOString().split('T')[0]
      : undefined,
    fuelCardNumber: row.fuel_card_number as string | undefined,
    fuelCardLimit: row.fuel_card_limit as number | undefined,
    odometerStart: row.odometer_start as number | undefined,
    odometerCurrent: row.odometer_current as number | undefined,
    insurancePolicyNumber: row.insurance_policy_number as string | undefined,
    licenseDiscExpiry: row.license_disc_expiry
      ? new Date(row.license_disc_expiry as string).toISOString().split('T')[0]
      : undefined,
    serviceDueDate: row.service_due_date
      ? new Date(row.service_due_date as string).toISOString().split('T')[0]
      : undefined,
    serviceDueKm: row.service_due_km as number | undefined,
    notes: row.notes as string | undefined,
    isActive: row.is_active as boolean,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    staff: row.staff_name
      ? {
          id: row.staff_id as string,
          name: row.staff_name as string,
          hasValidLicense,
        }
      : undefined,
  };
}
