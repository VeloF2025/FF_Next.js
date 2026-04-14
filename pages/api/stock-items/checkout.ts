/**
 * Stock Items API - Check Out
 *
 * POST - Check out a stock item (tool/asset/PPE) to a manager
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import type { AuthRole } from '@/lib/auth/types';
import { ROLE_HIERARCHY } from '@/lib/auth/types';
import { mapCheckoutRow } from '@/modules/stock-items/utils/checkoutUtils';

const DATABASE_URL = process.env.DATABASE_URL || '';

// Categories eligible for checkout
const CHECKOUT_CATEGORIES = ['tools', 'assets', 'ppe'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  // Role check: manager, admin, super_admin only
  const authReq = req as AuthenticatedNextApiRequest;
  const user = authReq.user;
  if (!user || (ROLE_HIERARCHY[user.role as AuthRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return apiResponse.forbidden(res, 'Only managers and above can check out items');
  }

  const sql = neon(DATABASE_URL);

  try {
    const { stockItemId, jobSiteId, jobSiteName, expectedReturnDate } = req.body;

    // Validate required fields
    if (!stockItemId) {
      return apiResponse.badRequest(res, 'stockItemId is required');
    }
    if (!expectedReturnDate) {
      return apiResponse.badRequest(res, 'expectedReturnDate is required');
    }
    if (!jobSiteName && !jobSiteId) {
      return apiResponse.badRequest(res, 'Job site is required (jobSiteName or jobSiteId)');
    }

    // Fetch the stock item
    const [item] = await sql`
      SELECT id, serial_number, category, name, item_code
      FROM stock_items WHERE id = ${stockItemId}
    `;

    if (!item) {
      return apiResponse.notFound(res, 'Stock item', stockItemId);
    }

    // Check category is eligible
    if (!CHECKOUT_CATEGORIES.includes(String(item.category))) {
      return apiResponse.badRequest(
        res,
        `Only items in categories ${CHECKOUT_CATEGORIES.join(', ')} can be checked out`,
      );
    }

    // Block if no serial number
    if (!item.serial_number) {
      return apiResponse.badRequest(
        res,
        'This item has no serial number. Please add a serial number before checking out.',
      );
    }

    // Check if already checked out
    const [activeCheckout] = await sql`
      SELECT id, checked_out_by FROM tool_checkouts
      WHERE stock_item_id = ${stockItemId} AND status = 'checked_out'
      LIMIT 1
    `;

    if (activeCheckout) {
      return apiResponse.error(res, ErrorCode.CONFLICT, 'This item is already checked out', {
        existingCheckoutId: activeCheckout.id,
      });
    }

    // Create checkout record
    const [checkout] = await sql`
      INSERT INTO tool_checkouts (
        stock_item_id, serial_number, checked_out_by,
        job_site_id, job_site_name, expected_return_date
      ) VALUES (
        ${stockItemId}, ${String(item.serial_number)}, ${user.id},
        ${jobSiteId || null}, ${jobSiteName || null}, ${expectedReturnDate}
      )
      RETURNING *
    `;

    if (!checkout) {
      return apiResponse.internalError(res, new Error('Failed to create checkout record'));
    }

    log.info('Tool checked out', {
      checkoutId: String(checkout.id),
      stockItemId: String(stockItemId),
      serialNumber: String(item.serial_number),
      checkedOutBy: user.id,
      userName: user.name,
    }, 'ToolCheckout');

    return apiResponse.created(
      res,
      mapCheckoutRow(checkout),
      `${String(item.item_code)} checked out successfully`,
    );
  } catch (error) {
    log.error('Error checking out stock item', { error }, 'ToolCheckout');
    return apiResponse.internalError(res, error, 'Failed to check out item');
  }
}

export default withAuth(withArcjetProtection(withErrorHandler(handler) as any, aj));
