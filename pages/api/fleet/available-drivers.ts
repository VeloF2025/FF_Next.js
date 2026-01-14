/**
 * Available Drivers API
 * GET /api/fleet/available-drivers - Get staff members with valid license status for vehicle assignment
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

interface AvailableDriver {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  hasValidLicense: boolean;
  licenseExpiry: string | null;
  hasVehicle: boolean;
  currentVehicleReg: string | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET']);
  }

  try {
    // Get all active staff with their license status and current vehicle assignment
    const rows = await sql`
      SELECT
        s.id,
        CONCAT(s.first_name, ' ', s.last_name) as name,
        s.email,
        s.phone,
        s.department,
        s.has_company_vehicle,
        -- Check for valid driver's license
        CASE
          WHEN lic.verification_status = 'verified'
            AND (lic.expiry_date IS NULL OR lic.expiry_date > CURRENT_DATE)
          THEN true
          ELSE false
        END as has_valid_license,
        lic.expiry_date as license_expiry,
        -- Get current vehicle registration if assigned
        va.vehicle_registration as current_vehicle_reg
      FROM staff s
      LEFT JOIN LATERAL (
        SELECT verification_status, expiry_date
        FROM staff_documents
        WHERE staff_id = s.id
          AND document_type = 'drivers_license'
        ORDER BY created_at DESC
        LIMIT 1
      ) lic ON true
      LEFT JOIN LATERAL (
        SELECT vehicle_registration
        FROM vehicle_assignments
        WHERE staff_id = s.id
          AND is_active = true
        ORDER BY assignment_start DESC
        LIMIT 1
      ) va ON true
      WHERE UPPER(s.status) = 'ACTIVE'
      ORDER BY s.first_name, s.last_name
    `;

    const drivers: AvailableDriver[] = rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      email: row.email as string | null,
      phone: row.phone as string | null,
      department: row.department as string | null,
      hasValidLicense: row.has_valid_license as boolean,
      licenseExpiry: row.license_expiry
        ? new Date(row.license_expiry as string).toISOString().split('T')[0]
        : null,
      hasVehicle: row.has_company_vehicle as boolean,
      currentVehicleReg: row.current_vehicle_reg as string | null,
    }));

    const withLicense = drivers.filter((d) => d.hasValidLicense);
    const withoutLicense = drivers.filter((d) => !d.hasValidLicense);

    return apiResponse.success(res, {
      drivers,
      summary: {
        total: drivers.length,
        withValidLicense: withLicense.length,
        withoutValidLicense: withoutLicense.length,
        alreadyAssigned: drivers.filter((d) => d.hasVehicle).length,
      },
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
