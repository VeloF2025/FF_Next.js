/**
 * Contractor Stock Accountability API
 * GET /api/procurement/field-stock/accountability - List all contractor accountability
 * POST /api/procurement/field-stock/accountability - Create/initialize accountability record
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleList(req, res);
  } else if (req.method === 'POST') {
    return handleCreate(req, res);
  }
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

async function handleList(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { isBlocked, hasUnaccounted } = req.query;

    let result;

    if (isBlocked === 'true' && hasUnaccounted === 'true') {
      result = await sql`
        SELECT
          id, contractor_id, contractor_name,
          total_issued_count, total_issued_value,
          total_consumed_count, total_consumed_value,
          total_returned_count, total_returned_value,
          unaccounted_count, unaccounted_value,
          pending_recovery_amount, recovered_amount,
          is_blocked, blocked_reason, blocked_at, blocked_by,
          last_reconciliation_date, last_reconciliation_by,
          created_at, updated_at
        FROM contractor_stock_accountability
        WHERE is_blocked = true AND unaccounted_count > 0
        ORDER BY unaccounted_value DESC
      `;
    } else if (isBlocked === 'true') {
      result = await sql`
        SELECT
          id, contractor_id, contractor_name,
          total_issued_count, total_issued_value,
          total_consumed_count, total_consumed_value,
          total_returned_count, total_returned_value,
          unaccounted_count, unaccounted_value,
          pending_recovery_amount, recovered_amount,
          is_blocked, blocked_reason, blocked_at, blocked_by,
          last_reconciliation_date, last_reconciliation_by,
          created_at, updated_at
        FROM contractor_stock_accountability
        WHERE is_blocked = true
        ORDER BY blocked_at DESC
      `;
    } else if (hasUnaccounted === 'true') {
      result = await sql`
        SELECT
          id, contractor_id, contractor_name,
          total_issued_count, total_issued_value,
          total_consumed_count, total_consumed_value,
          total_returned_count, total_returned_value,
          unaccounted_count, unaccounted_value,
          pending_recovery_amount, recovered_amount,
          is_blocked, blocked_reason, blocked_at, blocked_by,
          last_reconciliation_date, last_reconciliation_by,
          created_at, updated_at
        FROM contractor_stock_accountability
        WHERE unaccounted_count > 0
        ORDER BY unaccounted_value DESC
      `;
    } else {
      result = await sql`
        SELECT
          id, contractor_id, contractor_name,
          total_issued_count, total_issued_value,
          total_consumed_count, total_consumed_value,
          total_returned_count, total_returned_value,
          unaccounted_count, unaccounted_value,
          pending_recovery_amount, recovered_amount,
          is_blocked, blocked_reason, blocked_at, blocked_by,
          last_reconciliation_date, last_reconciliation_by,
          created_at, updated_at
        FROM contractor_stock_accountability
        ORDER BY contractor_name ASC
      `;
    }

    return apiResponse.success(res, result);
  } catch (error: unknown) {
    log.error('Error listing accountability', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

async function handleCreate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { contractorId, contractorName } = req.body;

    if (!contractorId) {
      return apiResponse.validationError(res, { contractorId: 'Contractor ID is required' });
    }

    if (!contractorName) {
      return apiResponse.validationError(res, { contractorName: 'Contractor name is required' });
    }

    // Check if already exists
    const existing = await sql`
      SELECT id FROM contractor_stock_accountability
      WHERE contractor_id = ${contractorId}
    `;

    if (existing.length > 0) {
      return apiResponse.validationError(res, {
        contractorId: 'Accountability record already exists for this contractor'
      });
    }

    // Create new accountability record
    const result = await sql`
      INSERT INTO contractor_stock_accountability (
        contractor_id,
        contractor_name,
        total_issued_count,
        total_issued_value,
        total_consumed_count,
        total_consumed_value,
        total_returned_count,
        total_returned_value,
        unaccounted_count,
        unaccounted_value,
        is_blocked,
        pending_recovery_amount,
        recovered_amount
      ) VALUES (
        ${contractorId},
        ${contractorName},
        0, 0, 0, 0, 0, 0, 0, 0, false, 0, 0
      )
      RETURNING
        id, contractor_id, contractor_name,
        total_issued_count, total_issued_value,
        total_consumed_count, total_consumed_value,
        total_returned_count, total_returned_value,
        unaccounted_count, unaccounted_value,
        is_blocked, pending_recovery_amount, recovered_amount,
        created_at, updated_at
    `;

    log.info('Accountability record created', { contractorId, contractorName }, 'field-stock');
    res.status(201);
    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error creating accountability', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
