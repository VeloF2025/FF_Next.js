/**
 * Holder Accountability Detail API
 * GET /api/procurement/field-stock/accountability/holders/[holderId]
 *
 * Returns the holder's accountability summary from v_holder_accountability
 * plus the items they currently hold (stock_custody) and their serials.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { query, queryOne } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { holderId } = req.query;

  if (typeof holderId !== 'string') {
    return apiResponse.validationError(res, { holderId: 'Holder ID is required' });
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    // Get the holder's accountability row from the live view
    const holderRow = await queryOne(
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
       WHERE holder_id = $1`,
      [holderId]
    );

    if (!holderRow) {
      return apiResponse.notFound(res, 'Holder accountability', holderId);
    }

    // Items currently held by this holder (non-zero quantity)
    const custody = await query(
      `SELECT
        sc.stock_item_id,
        si.item_code,
        si.name AS item_name,
        sc.lot_number,
        sc.quantity,
        sc.total_value
       FROM stock_custody sc
       JOIN stock_items si ON si.id = sc.stock_item_id
       WHERE sc.holder_id = $1
         AND sc.quantity <> 0`,
      [holderId]
    );

    // Serials currently attributed to this holder
    const serials = await query(
      `SELECT id, serial_number, stock_item_id, status
       FROM stock_serials
       WHERE holder_id = $1`,
      [holderId]
    );

    return apiResponse.success(res, {
      ...holderRow,
      custody,
      serials,
    });
  } catch (error: unknown) {
    log.error('Error fetching holder accountability', { error, holderId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
