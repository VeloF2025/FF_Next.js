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
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import type { AuthRole } from '@/lib/auth/types';
import { ROLE_HIERARCHY } from '@/lib/auth/types';

const DATABASE_URL = process.env.DATABASE_URL || '';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Role check: manager, admin, super_admin only
  const authReq = req as AuthenticatedNextApiRequest;
  const user = authReq.user;
  if (!user || (ROLE_HIERARCHY[user.role as AuthRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return res.status(403).json({ error: 'Only managers and above can check in items' });
  }

  const sql = neon(DATABASE_URL);

  try {
    const { checkoutId, conditionNotes } = req.body;

    if (!checkoutId) {
      return res.status(400).json({ error: 'checkoutId is required' });
    }

    // Find the active checkout
    const [checkout] = await sql`
      SELECT tc.*, si.item_code, si.name as item_name
      FROM tool_checkouts tc
      JOIN stock_items si ON si.id = tc.stock_item_id
      WHERE tc.id = ${checkoutId} AND tc.status = 'checked_out'
    `;

    if (!checkout) {
      return res.status(404).json({ error: 'Active checkout not found' });
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
      return res.status(500).json({ error: 'Failed to update checkout record' });
    }

    log.info('Tool checked in', {
      checkoutId: String(checkoutId),
      stockItemId: String(checkout.stock_item_id),
      serialNumber: String(checkout.serial_number),
      checkedInBy: user.id,
      userName: user.name,
    }, 'ToolCheckout');

    return res.status(200).json({
      data: mapCheckoutRow(updated),
      message: `${String(checkout.item_code)} checked in successfully`,
    });
  } catch (error) {
    log.error('Error checking in stock item', { error }, 'ToolCheckout');
    return res.status(500).json({ error: 'Failed to check in item' });
  }
}

export default withAuth(withArcjetProtection(handler, aj));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCheckoutRow(row: Record<string, any>) {
  return {
    id: row.id,
    stockItemId: row.stock_item_id,
    serialNumber: row.serial_number,
    checkedOutBy: row.checked_out_by,
    jobSiteId: row.job_site_id,
    jobSiteName: row.job_site_name,
    expectedReturnDate: row.expected_return_date,
    checkedOutAt: row.checked_out_at,
    checkedInAt: row.checked_in_at,
    checkedInBy: row.checked_in_by,
    conditionNotes: row.condition_notes,
    status: row.status,
  };
}
