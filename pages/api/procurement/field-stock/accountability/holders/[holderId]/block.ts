/**
 * Block Holder API
 * POST /api/procurement/field-stock/accountability/holders/[holderId]/block
 *
 * Persists a block flag on stock_accountability for the given holder.
 * Block state is DISPLAY-ONLY in Sprint D — no issue-time enforcement.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { queryOne } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';

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

    const { reason } = req.body as { reason?: string };

    // Get authenticated user as blocked_by identifier
    const authReq = req as AuthenticatedNextApiRequest;
    const blockedBy = authReq.user.name || authReq.user.email;

    // Upsert block state into stock_accountability
    const result = await queryOne(
      `INSERT INTO stock_accountability (
        holder_id, is_blocked, blocked_reason, blocked_at, blocked_by, updated_at
       ) VALUES ($1, true, $2, NOW(), $3, NOW())
       ON CONFLICT (holder_id) DO UPDATE SET
         is_blocked      = true,
         blocked_reason  = EXCLUDED.blocked_reason,
         blocked_at      = NOW(),
         blocked_by      = EXCLUDED.blocked_by,
         updated_at      = NOW()
       RETURNING *`,
      [holderId, reason ?? null, blockedBy]
    );

    log.info('Holder blocked', { holderId, reason, blockedBy }, 'field-stock');

    return apiResponse.success(res, result);
  } catch (error: unknown) {
    log.error('Error blocking holder', { error, holderId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

// SOP 4.4: blocking a holder is an admin/manager action, gated by the
// procurement.field-stock.block-holder permission (migration 389).
export default withAuth(withPermission('procurement.field-stock.block-holder', 'edit')(handler));
