/**
 * Holder Accountability List API
 * GET /api/procurement/field-stock/accountability/holders
 *
 * Returns all holders from v_holder_accountability.
 * Optional filters:
 *   ?isBlocked=true    → WHERE is_blocked = true
 *   ?hasUnaccounted=true → WHERE unaccounted_count > 0
 * Filters can be combined.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const { isBlocked, hasUnaccounted } = req.query;

    const conditions: string[] = [];
    if (isBlocked === 'true') conditions.push('is_blocked = true');
    if (hasUnaccounted === 'true') conditions.push('unaccounted_count > 0');

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await sql.query(
      `SELECT
        holder_id, holder_type, staff_id, contractor_id, name, is_active,
        issued_count, issued_value,
        consumed_count, consumed_value,
        returned_count, returned_value,
        held_count, held_value,
        unaccounted_count,
        is_blocked, blocked_reason, blocked_at, blocked_by,
        pending_recovery_amount, recovered_amount,
        last_reconciliation_date, last_reconciliation_by
       FROM v_holder_accountability
       ${whereClause}
       ORDER BY name`
    );

    return apiResponse.success(res, rows);
  } catch (error: unknown) {
    log.error('Error listing holder accountability', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
