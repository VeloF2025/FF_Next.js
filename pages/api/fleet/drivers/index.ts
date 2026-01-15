/**
 * Fleet Drivers API
 * GET /api/fleet/drivers - Get all drivers (staff with verified license) with full details
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import type {
  FleetDriver,
  DriverDashboardStats,
  DriversApiResponse,
  LicenseStatus,
  DriverStatus,
} from '@/modules/fleet/types/driver.types';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET']);
  }

  try {
    const { includeFormer, status, hasVehicle, search } = req.query;
    const includeFormerDrivers = includeFormer === 'true';
    const filterStatus = status as string | undefined;
    const filterHasVehicle = hasVehicle === 'true' ? true : hasVehicle === 'false' ? false : undefined;
    const searchTerm = search as string | undefined;

    // Build status filter
    const activeStatuses = ['ACTIVE'];
    const formerStatuses = ['INACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED', 'RETIRED'];

    // Get all drivers (staff with verified driver's license)
    const rows = await sql`
      SELECT
        s.id as staff_id,
        CONCAT(s.first_name, ' ', s.last_name) as name,
        s.email,
        s.phone,
        s.id_photo_url as photo_url,
        s.department,
        s.position,
        UPPER(COALESCE(s.status, 'ACTIVE')) as status,

        -- License info
        CASE
          WHEN lic.verification_status = 'verified' THEN true
          ELSE false
        END as has_verified_license,
        lic.expiry_date as license_expiry,
        lic.document_number as license_codes,
        CASE
          WHEN lic.expiry_date IS NULL THEN 'none'
          WHEN lic.expiry_date < CURRENT_DATE THEN 'expired'
          WHEN lic.expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 'expiring'
          ELSE 'valid'
        END as license_status,

        -- Vehicle assignment
        CASE WHEN fv.id IS NOT NULL THEN true ELSE false END as has_vehicle,
        fv.id as current_vehicle_id,
        fv.registration as current_vehicle_reg,
        fv.make as vehicle_make,
        fv.model as vehicle_model,

        -- Latest score
        ds.composite_score,
        COALESCE(ds.total_trips, 0) as total_trips,
        ds.check_in_compliance,
        ds.fuel_efficiency_score,
        ds.authorization_compliance,
        ds.vehicle_care_score,
        ds.score_date as last_score_date

      FROM staff s

      -- Join to get latest driver's license (verified only for driver criteria)
      INNER JOIN LATERAL (
        SELECT verification_status, expiry_date, document_number
        FROM staff_documents
        WHERE staff_id = s.id
          AND document_type = 'drivers_license'
          AND verification_status = 'verified'
        ORDER BY created_at DESC
        LIMIT 1
      ) lic ON true

      -- Join to get current vehicle assignment
      LEFT JOIN fleet_vehicles fv ON fv.assigned_driver_id = s.id AND fv.status = 'active'

      -- Join to get latest score
      LEFT JOIN LATERAL (
        SELECT
          composite_score,
          total_trips,
          check_in_compliance,
          fuel_efficiency_score,
          authorization_compliance,
          vehicle_care_score,
          score_date
        FROM fleet_driver_scores
        WHERE staff_id = s.id
        ORDER BY score_date DESC
        LIMIT 1
      ) ds ON true

      -- Filter by status
      WHERE (
        ${includeFormerDrivers} = true
        OR UPPER(COALESCE(s.status, 'ACTIVE')) = 'ACTIVE'
      )
      ${filterStatus ? sql`AND UPPER(COALESCE(s.status, 'ACTIVE')) = ${filterStatus.toUpperCase()}` : sql``}
      ${filterHasVehicle !== undefined ? sql`AND (fv.id IS NOT NULL) = ${filterHasVehicle}` : sql``}
      ${searchTerm ? sql`AND (
        LOWER(s.first_name) LIKE ${`%${searchTerm.toLowerCase()}%`}
        OR LOWER(s.last_name) LIKE ${`%${searchTerm.toLowerCase()}%`}
        OR LOWER(CONCAT(s.first_name, ' ', s.last_name)) LIKE ${`%${searchTerm.toLowerCase()}%`}
      )` : sql``}

      ORDER BY
        CASE WHEN UPPER(COALESCE(s.status, 'ACTIVE')) = 'ACTIVE' THEN 0 ELSE 1 END,
        s.first_name,
        s.last_name
    `;

    // Map to FleetDriver interface
    const drivers: FleetDriver[] = rows.map((row) => ({
      staffId: row.staff_id as string,
      name: row.name as string,
      email: row.email as string | null,
      phone: row.phone as string | null,
      photoUrl: row.photo_url as string | null,
      department: row.department as string | null,
      position: row.position as string | null,
      status: row.status as DriverStatus,
      hasVerifiedLicense: row.has_verified_license as boolean,
      licenseExpiry: row.license_expiry
        ? new Date(row.license_expiry as string).toISOString().split('T')[0]
        : null,
      licenseCodes: row.license_codes as string | null,
      licenseStatus: row.license_status as LicenseStatus,
      hasVehicle: row.has_vehicle as boolean,
      currentVehicleId: row.current_vehicle_id as string | null,
      currentVehicleReg: row.current_vehicle_reg as string | null,
      vehicleMake: row.vehicle_make as string | null,
      vehicleModel: row.vehicle_model as string | null,
      compositeScore: row.composite_score as number | null,
      totalTrips: row.total_trips as number,
      checkInCompliance: row.check_in_compliance as number | null,
      fuelEfficiencyScore: row.fuel_efficiency_score as number | null,
      authorizationCompliance: row.authorization_compliance as number | null,
      vehicleCareScore: row.vehicle_care_score as number | null,
      lastScoreDate: row.last_score_date
        ? new Date(row.last_score_date as string).toISOString().split('T')[0]
        : null,
    })) as FleetDriver[];

    // Calculate summary stats
    const activeDrivers = drivers.filter((d) => d.status === 'ACTIVE');
    const formerDrivers = drivers.filter((d) => d.status !== 'ACTIVE');
    const driversWithVehicle = drivers.filter((d) => d.hasVehicle);
    const driversWithoutVehicle = drivers.filter((d) => !d.hasVehicle && d.status === 'ACTIVE');

    const licensesValid = drivers.filter((d) => d.licenseStatus === 'valid');
    const licensesExpiring = drivers.filter((d) => d.licenseStatus === 'expiring');
    const licensesExpired = drivers.filter((d) => d.licenseStatus === 'expired');

    // Score distribution
    const driversWithScore = drivers.filter((d) => d.compositeScore !== null);
    const excellent = driversWithScore.filter((d) => d.compositeScore! >= 90);
    const good = driversWithScore.filter((d) => d.compositeScore! >= 70 && d.compositeScore! < 90);
    const fair = driversWithScore.filter((d) => d.compositeScore! >= 50 && d.compositeScore! < 70);
    const needsImprovement = driversWithScore.filter((d) => d.compositeScore! < 50);
    const noScore = drivers.filter((d) => d.compositeScore === null);

    // Average scores
    const avgCompositeScore = driversWithScore.length > 0
      ? driversWithScore.reduce((sum, d) => sum + d.compositeScore!, 0) / driversWithScore.length
      : null;

    const driversWithCompliance = drivers.filter((d) => d.checkInCompliance !== null);
    const avgCheckInCompliance = driversWithCompliance.length > 0
      ? driversWithCompliance.reduce((sum, d) => sum + d.checkInCompliance!, 0) / driversWithCompliance.length
      : null;

    // License expiry by month (next 6 months)
    const licenseExpiryByMonth: Array<{ month: string; count: number }> = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
      const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      const count = drivers.filter((d) => {
        if (!d.licenseExpiry) return false;
        const expiry = new Date(d.licenseExpiry);
        return expiry >= monthDate && expiry <= monthEnd;
      }).length;

      licenseExpiryByMonth.push({ month: monthLabel, count });
    }

    const summary: DriverDashboardStats = {
      totalDrivers: drivers.length,
      activeDrivers: activeDrivers.length,
      formerDrivers: formerDrivers.length,
      driversWithVehicle: driversWithVehicle.length,
      driversWithoutVehicle: driversWithoutVehicle.length,
      licensesValid: licensesValid.length,
      licensesExpiringSoon: licensesExpiring.length,
      licensesExpired: licensesExpired.length,
      avgCompositeScore: avgCompositeScore !== null ? Math.round(avgCompositeScore * 10) / 10 : null,
      avgCheckInCompliance: avgCheckInCompliance !== null ? Math.round(avgCheckInCompliance * 10) / 10 : null,
      scoreDistribution: {
        excellent: excellent.length,
        good: good.length,
        fair: fair.length,
        needsImprovement: needsImprovement.length,
        noScore: noScore.length,
      },
      licenseExpiryByMonth,
    };

    const response: DriversApiResponse = {
      drivers,
      summary,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
