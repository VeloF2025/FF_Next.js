/**
 * Stock Items API - Check In
 *
 * POST - Check in a previously checked-out stock item
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import type { AuthRole } from '@/lib/auth/types';
import { ROLE_HIERARCHY } from '@/lib/auth/types';
import { mapCheckoutRow } from '@/modules/stock-items/utils/checkoutUtils';

const DATABASE_URL = process.env.DATABASE_URL || '';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  // Role check: manager, admin, super_admin only
  const authReq = req as AuthenticatedNextApiRequest;
  const user = authReq.user;
  if (!user || (ROLE_HIERARCHY[user.role as AuthRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return apiResponse.forbidden(res, 'Only managers and above can check in items');
  }

  const sql = neon(DATABASE_URL);

  try {
    const { checkoutId, conditionNotes } = req.body;

    if (!checkoutId) {
      return apiResponse.badRequest(res, 'checkoutId is required');
    }

    // Find the active checkout
    const [checkout] = await sql`
      SELECT tc.*, si.item_code, si.name as item_name
      FROM tool_checkouts tc
      JOIN stock_items si ON si.id = tc.stock_item_id
      WHERE tc.id = ${checkoutId} AND tc.status = 'checked_out'
    `;

    if (!checkout) {
      return apiResponse.notFound(res, 'Active checkout', checkoutId);
    }

    // Update checkout to returned
    const [updated] = await sql`
      UPDATE tool_checkouts
      SET
        checked_in_at = NOW(),
        checked_in_by = ${user.id},
        condition_notes = ${conditionNotes || null},
        status = 'returned'
      WHERE id = ${checkoutId}
      RETURNING *
    `;

    if (!updated) {
      return apiResponse.internalError(res, new Error('Failed to update checkout record'));
    }

    log.info('Tool checked in', {
      checkoutId: String(checkoutId),
      stockItemId: String(checkout.stock_item_id),
      serialNumber: String(checkout.serial_number),
      checkedInBy: user.id,
      userName: user.name,
    }, 'ToolCheckout');

    return apiResponse.success(
      res,
      mapCheckoutRow(updated),
      `${String(checkout.item_code)} checked in successfully`,
    );
  } catch (error) {
    log.error('Error checking in stock item', { error }, 'ToolCheckout');
    return apiResponse.internalError(res, error, 'Failed to check in item');
  }
}

export default withAuth(withArcjetProtection(withErrorHandler(handler) as any, aj));
