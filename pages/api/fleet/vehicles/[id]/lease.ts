/**
 * Fleet Vehicle Lease/Rental API
 * GET: Get lease/rental details for a vehicle
 * PUT: Create or update lease/rental details
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  VehicleLease,
  VehicleLeaseRow,
  UpsertLeaseRequest,
} from '@/modules/fleet/types';
import { rowToVehicleLease } from '@/modules/fleet/types';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id: vehicleId } = req.query;

  if (!vehicleId || typeof vehicleId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res, vehicleId);
      case 'PUT':
        return handlePut(req, res, vehicleId);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET', 'PUT']);
    }
  } catch (error) {
    log.error('Fleet lease API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const rows = await sql`
    SELECT *
    FROM fleet_vehicle_lease
    WHERE vehicle_id = ${vehicleId}
  ` as VehicleLeaseRow[];

  if (rows.length === 0 || !rows[0]) {
    return apiResponse.success(res, null);
  }

  const lease = rowToVehicleLease(rows[0]);
  return apiResponse.success(res, lease);
}

async function handlePut(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const body = req.body as UpsertLeaseRequest;

  // Validate required fields
  if (!body.leaseType || !body.companyName || !body.startDate) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Lease type, company name, and start date are required');
  }

  // Verify vehicle exists and update ownership_type
  const ownershipType = body.leaseType === 'rental' ? 'rental' : 'leased';
  const vehicleCheck = await sql`
    UPDATE fleet_vehicles
    SET ownership_type = ${ownershipType}, updated_at = NOW()
    WHERE id = ${vehicleId}
    RETURNING id
  `;
  if (vehicleCheck.length === 0) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  // Check if lease record exists
  const existing = await sql`
    SELECT id FROM fleet_vehicle_lease WHERE vehicle_id = ${vehicleId}
  `;

  let rows: VehicleLeaseRow[];

  if (existing.length > 0) {
    // Update existing
    rows = await sql`
      UPDATE fleet_vehicle_lease SET
        lease_type = ${body.leaseType},
        company_name = ${body.companyName},
        company_registration = ${body.companyRegistration || null},
        company_vat = ${body.companyVat || null},
        company_address = ${body.companyAddress || null},
        company_phone = ${body.companyPhone || null},
        company_email = ${body.companyEmail || null},
        company_website = ${body.companyWebsite || null},
        contract_number = ${body.contractNumber || null},
        quote_number = ${body.quoteNumber || null},
        start_date = ${body.startDate},
        end_date = ${body.endDate || null},
        contract_duration_months = ${body.contractDurationMonths || null},
        monthly_cost = ${body.monthlyCost || null},
        deposit_amount = ${body.depositAmount || null},
        deposit_refundable = ${body.depositRefundable ?? true},
        km_limit_monthly = ${body.kmLimitMonthly || null},
        km_limit_total = ${body.kmLimitTotal || null},
        excess_km_rate = ${body.excessKmRate || null},
        current_km = ${body.currentKm || null},
        includes_maintenance = ${body.includesMaintenance ?? false},
        includes_tyres = ${body.includesTyres ?? false},
        includes_fuel_card = ${body.includesFuelCard ?? false},
        includes_tracking = ${body.includesTracking ?? false},
        includes_insurance = ${body.includesInsurance ?? false},
        account_manager = ${body.accountManager || null},
        account_manager_phone = ${body.accountManagerPhone || null},
        account_manager_email = ${body.accountManagerEmail || null},
        alternate_contact_name = ${body.alternateContactName || null},
        alternate_contact_phone = ${body.alternateContactPhone || null},
        return_conditions = ${body.returnConditions || null},
        early_termination_fee = ${body.earlyTerminationFee || null},
        notes = ${body.notes || null},
        updated_at = NOW()
      WHERE vehicle_id = ${vehicleId}
      RETURNING *
    ` as VehicleLeaseRow[];
  } else {
    // Create new
    rows = await sql`
      INSERT INTO fleet_vehicle_lease (
        vehicle_id,
        lease_type,
        company_name,
        company_registration,
        company_vat,
        company_address,
        company_phone,
        company_email,
        company_website,
        contract_number,
        quote_number,
        start_date,
        end_date,
        contract_duration_months,
        monthly_cost,
        deposit_amount,
        deposit_refundable,
        km_limit_monthly,
        km_limit_total,
        excess_km_rate,
        current_km,
        includes_maintenance,
        includes_tyres,
        includes_fuel_card,
        includes_tracking,
        includes_insurance,
        account_manager,
        account_manager_phone,
        account_manager_email,
        alternate_contact_name,
        alternate_contact_phone,
        return_conditions,
        early_termination_fee,
        notes
      ) VALUES (
        ${vehicleId},
        ${body.leaseType},
        ${body.companyName},
        ${body.companyRegistration || null},
        ${body.companyVat || null},
        ${body.companyAddress || null},
        ${body.companyPhone || null},
        ${body.companyEmail || null},
        ${body.companyWebsite || null},
        ${body.contractNumber || null},
        ${body.quoteNumber || null},
        ${body.startDate},
        ${body.endDate || null},
        ${body.contractDurationMonths || null},
        ${body.monthlyCost || null},
        ${body.depositAmount || null},
        ${body.depositRefundable ?? true},
        ${body.kmLimitMonthly || null},
        ${body.kmLimitTotal || null},
        ${body.excessKmRate || null},
        ${body.currentKm || null},
        ${body.includesMaintenance ?? false},
        ${body.includesTyres ?? false},
        ${body.includesFuelCard ?? false},
        ${body.includesTracking ?? false},
        ${body.includesInsurance ?? false},
        ${body.accountManager || null},
        ${body.accountManagerPhone || null},
        ${body.accountManagerEmail || null},
        ${body.alternateContactName || null},
        ${body.alternateContactPhone || null},
        ${body.returnConditions || null},
        ${body.earlyTerminationFee || null},
        ${body.notes || null}
      )
      RETURNING *
    ` as VehicleLeaseRow[];
  }

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to save lease details');
  }

  const lease = rowToVehicleLease(rows[0]);

  log.info('Updated vehicle lease', {
    vehicleId,
    leaseId: lease.id,
    leaseType: lease.leaseType,
    companyName: lease.companyName,
  });

  return apiResponse.success(res, lease);
}
