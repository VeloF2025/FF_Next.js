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
    if (isBlocked === 'true') conditions.push('va.is_blocked = true');
    if (hasUnaccounted === 'true') conditions.push('va.unaccounted_count > 0');

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Aging buckets come from the v_holder_held_aging companion view (migration
    // 409), LEFT JOINed on holder_id so holders with no held stock still appear
    // with zeroed buckets.
    const rows = await sql.query(
      `SELECT
        va.holder_id, va.holder_type, va.staff_id, va.contractor_id, va.name, va.is_active,
        va.issued_count, va.issued_value,
        va.consumed_count, va.consumed_value,
        va.returned_count, va.returned_value,
        va.held_count, va.held_value,
        va.unaccounted_count,
        va.is_blocked, va.blocked_reason, va.blocked_at, va.blocked_by,
        va.pending_recovery_amount, va.recovered_amount,
        va.last_reconciliation_date, va.last_reconciliation_by,
        COALESCE(ag.held_age_0_7, 0)     AS held_age_0_7,
        COALESCE(ag.held_age_8_30, 0)    AS held_age_8_30,
        COALESCE(ag.held_age_31_plus, 0) AS held_age_31_plus,
        ag.oldest_held_at,
        COALESCE(ag.oldest_held_days, 0) AS oldest_held_days
       FROM v_holder_accountability va
       LEFT JOIN v_holder_held_aging ag ON ag.holder_id = va.holder_id
       ${whereClause}
       ORDER BY va.name`
    );

    return apiResponse.success(res, rows);
  } catch (error: unknown) {
    log.error('Error listing holder accountability', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
