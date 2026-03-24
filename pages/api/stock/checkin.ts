/**
 * Stock Check-in API
 *
 * POST - Check in a previously checked-out serial unit
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, hasRole } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const DATABASE_URL = process.env.DATABASE_URL || '';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const sql = neon(DATABASE_URL);
  const user = (req as any).user;

  if (!hasRole(user, 'manager')) {
    return apiResponse.forbidden(res, 'Manager role or higher required');
  }

  try {
    const { checkoutId, conditionNotes } = req.body;

    if (!checkoutId) {
      return apiResponse.badRequest(res, 'checkoutId is required');
    }

    // Fetch checkout record
    const [checkout] = await sql`
      SELECT
        tc.*,
        si.name AS item_name,
        si.item_code
      FROM tool_checkouts tc
      JOIN stock_items si ON si.id = tc.stock_item_id
      WHERE tc.id = ${checkoutId}
    `;

    if (!checkout) {
      return apiResponse.notFound(res, 'Checkout record not found');
    }

    if (checkout.status !== 'checked_out') {
      return apiResponse.badRequest(res, 'This item has already been returned');
    }

    // Update checkout record
    const [updated] = await sql`
      UPDATE tool_checkouts
      SET checked_in_at = NOW(),
          checked_in_by = ${user.id},
          condition_notes = ${conditionNotes || null},
          status = 'returned',
          updated_at = NOW()
      WHERE id = ${checkoutId}
      RETURNING *
    `;

    // Update serial status back to available
    await sql`
      UPDATE stock_item_serials
      SET status = 'available',
          current_checkout_id = NULL,
          updated_at = NOW()
      WHERE id = ${checkout.serial_id}
    `;

    log.info('Tool checked in', {
      checkoutId,
      serialNumber: checkout.serial_number,
      itemName: checkout.item_name,
      checkedInBy: user.name,
      conditionNotes,
    }, 'StockCheckin');

    return res.status(200).json({
      data: {
        ...updated,
        item_name: checkout.item_name,
        item_code: checkout.item_code,
        checked_in_by_name: user.name,
      },
    });
  } catch (error) {
    log.error('Failed to check in tool', { error }, 'StockCheckin');
    return apiResponse.internalError(res, new Error('Failed to check in tool'));
  }
}

export default withAuth(handler);
