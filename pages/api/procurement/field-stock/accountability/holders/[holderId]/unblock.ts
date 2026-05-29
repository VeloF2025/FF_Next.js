/**
 * Unblock Holder API
 * POST /api/procurement/field-stock/accountability/holders/[holderId]/unblock
 *
 * Clears the block flag on stock_accountability for the given holder.
 * Block state is DISPLAY-ONLY in Sprint D — no issue-time enforcement.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { queryOne } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { holderId } = req.query;

  if (typeof holderId !== 'string') {
    return apiResponse.validationError(res, { holderId: 'Holder ID is required' });
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  try {
    // Verify holder exists in stock_holders
    const holderExists = await queryOne(
      `SELECT id FROM stock_holders WHERE id = $1`,
      [holderId]
    );

    if (!holderExists) {
      return apiResponse.notFound(res, 'Holder', holderId);
    }

    // Upsert unblock state into stock_accountability
    const result = await queryOne(
      `INSERT INTO stock_accountability (
        holder_id, is_blocked, blocked_reason, blocked_at, blocked_by, updated_at
       ) VALUES ($1, false, NULL, NULL, NULL, NOW())
       ON CONFLICT (holder_id) DO UPDATE SET
         is_blocked      = false,
         blocked_reason  = NULL,
         blocked_at      = NULL,
         blocked_by      = NULL,
         updated_at      = NOW()
       RETURNING *`,
      [holderId]
    );

    log.info('Holder unblocked', { holderId }, 'field-stock');

    return apiResponse.success(res, result);
  } catch (error: unknown) {
    log.error('Error unblocking holder', { error, holderId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

// SOP 4.4: unblocking a holder is an admin/manager action, gated by the same
// procurement.field-stock.block-holder permission as block (migration 389).
export default withAuth(withPermission('procurement.field-stock.block-holder', 'edit')(handler));
