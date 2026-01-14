/**
 * Fleet Vehicle License Disc API
 * GET: List license disc history for a vehicle
 * POST: Add a new license disc record
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  LicenseDisc,
  LicenseDiscRow,
  CreateLicenseDiscRequest,
} from '@/modules/fleet/types';
import { rowToLicenseDisc } from '@/modules/fleet/types';

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
      case 'POST':
        return handlePost(req, res, vehicleId);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('Fleet license disc API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const { status, current } = req.query;

  let query = `
    SELECT *
    FROM fleet_license_disc
    WHERE vehicle_id = $1
  `;
  const params: string[] = [vehicleId];

  if (status && typeof status === 'string') {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  // If current=true, only get the most recent active one
  if (current === 'true') {
    query += ` AND status = 'active' ORDER BY expiry_date DESC LIMIT 1`;
  } else {
    query += ' ORDER BY expiry_date DESC';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await (sql as any)(query, params)) as LicenseDiscRow[];
  const licenses: LicenseDisc[] = rows.map(rowToLicenseDisc);

  // If requesting current, return single object or null
  if (current === 'true') {
    return apiResponse.success(res, licenses[0] || null);
  }

  return apiResponse.success(res, licenses);
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const body = req.body as CreateLicenseDiscRequest;

  // Validate required fields
  if (!body.expiryDate) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Expiry date is required');
  }

  // Verify vehicle exists
  const vehicleCheck = await sql`
    SELECT id FROM fleet_vehicles WHERE id = ${vehicleId}
  `;
  if (vehicleCheck.length === 0) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  // Mark any existing active license as renewed
  await sql`
    UPDATE fleet_license_disc
    SET status = 'renewed', renewed_at = NOW()
    WHERE vehicle_id = ${vehicleId}
      AND status = 'active'
  `;

  const rows = await sql`
    INSERT INTO fleet_license_disc (
      vehicle_id,
      license_number,
      province,
      issue_date,
      expiry_date,
      cost,
      arrears,
      penalties,
      total_paid,
      document_url,
      renewal_reminder_days,
      status
    ) VALUES (
      ${vehicleId},
      ${body.licenseNumber || null},
      ${body.province || null},
      ${body.issueDate || null},
      ${body.expiryDate},
      ${body.cost || null},
      ${body.arrears || 0},
      ${body.penalties || 0},
      ${body.totalPaid || null},
      ${body.documentUrl || null},
      ${body.renewalReminderDays || 30},
      'active'
    )
    RETURNING *
  ` as LicenseDiscRow[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create license disc');
  }

  const license = rowToLicenseDisc(rows[0]);

  log.info('Created license disc record', {
    vehicleId,
    licenseId: license.id,
    expiryDate: license.expiryDate,
  });

  return apiResponse.created(res, license);
}
