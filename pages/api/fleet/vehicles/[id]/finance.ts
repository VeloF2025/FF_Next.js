/**
 * Fleet Vehicle Finance API
 * GET: Get finance details for a vehicle
 * PUT: Create or update finance details
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  VehicleFinance,
  VehicleFinanceRow,
  UpsertFinanceRequest,
} from '@/modules/fleet/types';
import { rowToVehicleFinance } from '@/modules/fleet/types';
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
      case 'PUT':
        return handlePut(req, res, vehicleId);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET', 'PUT']);
    }
  } catch (error) {
    log.error('Fleet finance API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const rows = await sql`
    SELECT id, vehicle_id, finance_company, finance_type, account_number,
           vehicle_price, deposit_paid, finance_amount, interest_rate, term_months,
           monthly_payment, balloon_payment, start_date, end_date, first_payment_date,
           remaining_balance, payments_made, next_payment_date,
           contact_name, contact_phone, contact_email, branch,
           settlement_amount, settlement_valid_until, notes, created_at, updated_at
    FROM fleet_vehicle_finance
    WHERE vehicle_id = ${vehicleId}
  ` as VehicleFinanceRow[];

  if (rows.length === 0 || !rows[0]) {
    return apiResponse.success(res, null);
  }

  const finance = rowToVehicleFinance(rows[0]);
  return apiResponse.success(res, finance);
}

async function handlePut(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const body = req.body as UpsertFinanceRequest;

  // Validate required fields
  if (!body.financeCompany) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Finance company is required');
  }

  // Verify vehicle exists and update is_financed flag
  const vehicleCheck = await sql`
    UPDATE fleet_vehicles
    SET is_financed = true, updated_at = NOW()
    WHERE id = ${vehicleId}
    RETURNING id
  `;
  if (vehicleCheck.length === 0) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  // Check if finance record exists
  const existing = await sql`
    SELECT id FROM fleet_vehicle_finance WHERE vehicle_id = ${vehicleId}
  `;

  let rows: VehicleFinanceRow[];

  if (existing.length > 0) {
    // Update existing
    rows = await sql`
      UPDATE fleet_vehicle_finance SET
        finance_company = ${body.financeCompany},
        finance_type = ${body.financeType || null},
        account_number = ${body.accountNumber || null},
        vehicle_price = ${body.vehiclePrice || null},
        deposit_paid = ${body.depositPaid || null},
        finance_amount = ${body.financeAmount || null},
        interest_rate = ${body.interestRate || null},
        term_months = ${body.termMonths || null},
        monthly_payment = ${body.monthlyPayment || null},
        balloon_payment = ${body.balloonPayment || null},
        start_date = ${body.startDate || null},
        end_date = ${body.endDate || null},
        first_payment_date = ${body.firstPaymentDate || null},
        remaining_balance = ${body.remainingBalance || null},
        payments_made = ${body.paymentsMade || 0},
        next_payment_date = ${body.nextPaymentDate || null},
        contact_name = ${body.contactName || null},
        contact_phone = ${body.contactPhone || null},
        contact_email = ${body.contactEmail || null},
        branch = ${body.branch || null},
        settlement_amount = ${body.settlementAmount || null},
        settlement_valid_until = ${body.settlementValidUntil || null},
        notes = ${body.notes || null},
        updated_at = NOW()
      WHERE vehicle_id = ${vehicleId}
      RETURNING id, vehicle_id, finance_company, finance_type, account_number,
               vehicle_price, deposit_paid, finance_amount, interest_rate, term_months,
               monthly_payment, balloon_payment, start_date, end_date, first_payment_date,
               remaining_balance, payments_made, next_payment_date,
               contact_name, contact_phone, contact_email, branch,
               settlement_amount, settlement_valid_until, notes, created_at, updated_at
    ` as VehicleFinanceRow[];
  } else {
    // Create new
    rows = await sql`
      INSERT INTO fleet_vehicle_finance (
        vehicle_id,
        finance_company,
        finance_type,
        account_number,
        vehicle_price,
        deposit_paid,
        finance_amount,
        interest_rate,
        term_months,
        monthly_payment,
        balloon_payment,
        start_date,
        end_date,
        first_payment_date,
        remaining_balance,
        payments_made,
        next_payment_date,
        contact_name,
        contact_phone,
        contact_email,
        branch,
        settlement_amount,
        settlement_valid_until,
        notes
      ) VALUES (
        ${vehicleId},
        ${body.financeCompany},
        ${body.financeType || null},
        ${body.accountNumber || null},
        ${body.vehiclePrice || null},
        ${body.depositPaid || null},
        ${body.financeAmount || null},
        ${body.interestRate || null},
        ${body.termMonths || null},
        ${body.monthlyPayment || null},
        ${body.balloonPayment || null},
        ${body.startDate || null},
        ${body.endDate || null},
        ${body.firstPaymentDate || null},
        ${body.remainingBalance || null},
        ${body.paymentsMade || 0},
        ${body.nextPaymentDate || null},
        ${body.contactName || null},
        ${body.contactPhone || null},
        ${body.contactEmail || null},
        ${body.branch || null},
        ${body.settlementAmount || null},
        ${body.settlementValidUntil || null},
        ${body.notes || null}
      )
      RETURNING id, vehicle_id, finance_company, finance_type, account_number,
               vehicle_price, deposit_paid, finance_amount, interest_rate, term_months,
               monthly_payment, balloon_payment, start_date, end_date, first_payment_date,
               remaining_balance, payments_made, next_payment_date,
               contact_name, contact_phone, contact_email, branch,
               settlement_amount, settlement_valid_until, notes, created_at, updated_at
    ` as VehicleFinanceRow[];
  }

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to save finance details');
  }

  const finance = rowToVehicleFinance(rows[0]);

  log.info('Updated vehicle finance', {
    vehicleId,
    financeId: finance.id,
    financeCompany: finance.financeCompany,
  });

  return apiResponse.success(res, finance);
}

export default withAuth(handler);
