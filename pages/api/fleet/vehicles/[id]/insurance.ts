/**
 * Fleet Vehicle Insurance API
 * GET: List insurance policies for a vehicle
 * POST: Add a new insurance policy
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  VehicleInsurance,
  VehicleInsuranceRow,
  CreateInsuranceRequest,
} from '@/modules/fleet/types';
import { rowToVehicleInsurance } from '@/modules/fleet/types';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
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
      case 'POST':
        return handlePost(req, res, vehicleId);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('Fleet insurance API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const { active, current } = req.query;

  let query = `
    SELECT id, vehicle_id, insurance_company, policy_number, policy_type,
           cover_amount, excess_amount, excess_theft, excess_third_party,
           premium_monthly, premium_annual, payment_method, start_date, expiry_date,
           insurer_contact_name, insurer_contact_phone, insurer_claims_phone, insurer_email,
           broker_name, broker_company, broker_phone, broker_email,
           roadside_assistance_number, towing_included, car_hire_included,
           document_url, schedule_url, is_active, renewal_reminder_days,
           reminder_sent_at, claims_count, last_claim_date, notes, created_at, updated_at
    FROM fleet_vehicle_insurance
    WHERE vehicle_id = $1
  `;
  const params: (string | boolean)[] = [vehicleId];

  if (active !== undefined) {
    const isActive = active === 'true';
    params.push(isActive);
    query += ` AND is_active = $${params.length}`;
  }

  // If current=true, only get the most recent active one
  if (current === 'true') {
    query += ` AND is_active = true ORDER BY expiry_date DESC LIMIT 1`;
  } else {
    query += ' ORDER BY expiry_date DESC';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await (sql as any)(query, params)) as VehicleInsuranceRow[];
  const policies: VehicleInsurance[] = rows.map(rowToVehicleInsurance);

  // If requesting current, return single object or null
  if (current === 'true') {
    return apiResponse.success(res, policies[0] || null);
  }

  return apiResponse.success(res, policies);
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const body = req.body as CreateInsuranceRequest;

  // Validate required fields
  if (!body.insuranceCompany || !body.policyNumber || !body.expiryDate) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Insurance company, policy number, and expiry date are required');
  }

  // Verify vehicle exists
  const vehicleCheck = await sql`
    SELECT id FROM fleet_vehicles WHERE id = ${vehicleId}
  `;
  if (vehicleCheck.length === 0) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  // Deactivate any existing active policies
  await sql`
    UPDATE fleet_vehicle_insurance
    SET is_active = false, updated_at = NOW()
    WHERE vehicle_id = ${vehicleId}
      AND is_active = true
  `;

  const rows = await sql`
    INSERT INTO fleet_vehicle_insurance (
      vehicle_id,
      insurance_company,
      policy_number,
      policy_type,
      cover_amount,
      excess_amount,
      excess_theft,
      excess_third_party,
      premium_monthly,
      premium_annual,
      payment_method,
      start_date,
      expiry_date,
      insurer_contact_name,
      insurer_contact_phone,
      insurer_claims_phone,
      insurer_email,
      broker_name,
      broker_company,
      broker_phone,
      broker_email,
      roadside_assistance_number,
      towing_included,
      car_hire_included,
      document_url,
      schedule_url,
      is_active,
      renewal_reminder_days,
      notes
    ) VALUES (
      ${vehicleId},
      ${body.insuranceCompany},
      ${body.policyNumber},
      ${body.policyType || null},
      ${body.coverAmount || null},
      ${body.excessAmount || null},
      ${body.excessTheft || null},
      ${body.excessThirdParty || null},
      ${body.premiumMonthly || null},
      ${body.premiumAnnual || null},
      ${body.paymentMethod || null},
      ${body.startDate || null},
      ${body.expiryDate},
      ${body.insurerContactName || null},
      ${body.insurerContactPhone || null},
      ${body.insurerClaimsPhone || null},
      ${body.insurerEmail || null},
      ${body.brokerName || null},
      ${body.brokerCompany || null},
      ${body.brokerPhone || null},
      ${body.brokerEmail || null},
      ${body.roadsideAssistanceNumber || null},
      ${body.towingIncluded ?? false},
      ${body.carHireIncluded ?? false},
      ${body.documentUrl || null},
      ${body.scheduleUrl || null},
      true,
      30,
      ${body.notes || null}
    )
    RETURNING id, vehicle_id, insurance_company, policy_number, policy_type,
             cover_amount, excess_amount, excess_theft, excess_third_party,
             premium_monthly, premium_annual, payment_method, start_date, expiry_date,
             insurer_contact_name, insurer_contact_phone, insurer_claims_phone, insurer_email,
             broker_name, broker_company, broker_phone, broker_email,
             roadside_assistance_number, towing_included, car_hire_included,
             document_url, schedule_url, is_active, renewal_reminder_days,
             reminder_sent_at, claims_count, last_claim_date, notes, created_at, updated_at
  ` as VehicleInsuranceRow[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create insurance policy');
  }

  const policy = rowToVehicleInsurance(rows[0]);

  log.info('Created insurance policy', {
    vehicleId,
    policyId: policy.id,
    insuranceCompany: policy.insuranceCompany,
    policyNumber: policy.policyNumber,
  });

  return apiResponse.created(res, policy);
}

export default withAuth(handler);
