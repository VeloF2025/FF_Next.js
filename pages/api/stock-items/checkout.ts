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
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import type { AuthRole } from '@/lib/auth/types';
import { ROLE_HIERARCHY } from '@/lib/auth/types';

const DATABASE_URL = process.env.DATABASE_URL || '';

// Categories eligible for checkout
const CHECKOUT_CATEGORIES = ['tools', 'assets', 'ppe'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Role check: manager, admin, super_admin only
  const authReq = req as AuthenticatedNextApiRequest;
  const user = authReq.user;
  if (!user || (ROLE_HIERARCHY[user.role as AuthRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return res.status(403).json({ error: 'Only managers and above can check out items' });
  }

  const sql = neon(DATABASE_URL);

  try {
    const { stockItemId, jobSiteId, jobSiteName, expectedReturnDate } = req.body;

    // Validate required fields
    if (!stockItemId) {
      return res.status(400).json({ error: 'stockItemId is required' });
    }
    if (!expectedReturnDate) {
      return res.status(400).json({ error: 'expectedReturnDate is required' });
    }
    if (!jobSiteName && !jobSiteId) {
      return res.status(400).json({ error: 'Job site is required (jobSiteName or jobSiteId)' });
    }

    // Fetch the stock item
    const [item] = await sql`
      SELECT id, serial_number, category, name, item_code
      FROM stock_items WHERE id = ${stockItemId}
    `;

    if (!item) {
      return res.status(404).json({ error: 'Stock item not found' });
    }

    // Check category is eligible
    if (!CHECKOUT_CATEGORIES.includes(String(item.category))) {
      return res.status(400).json({
        error: `Only items in categories ${CHECKOUT_CATEGORIES.join(', ')} can be checked out`,
      });
    }

    // Block if no serial number
    if (!item.serial_number) {
      return res.status(400).json({
        error: 'This item has no serial number. Please add a serial number before checking out.',
        code: 'NO_SERIAL',
      });
    }

    // Check if already checked out
    const [activeCheckout] = await sql`
      SELECT id, checked_out_by FROM tool_checkouts
      WHERE stock_item_id = ${stockItemId} AND status = 'checked_out'
      LIMIT 1
    `;

    if (activeCheckout) {
      return res.status(409).json({
        error: 'This item is already checked out',
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
      return res.status(500).json({ error: 'Failed to create checkout record' });
    }

    log.info('Tool checked out', {
      checkoutId: String(checkout.id),
      stockItemId: String(stockItemId),
      serialNumber: String(item.serial_number),
      checkedOutBy: user.id,
      userName: user.name,
    }, 'ToolCheckout');

    return res.status(201).json({
      data: mapCheckoutRow(checkout),
      message: `${String(item.item_code)} checked out successfully`,
    });
  } catch (error) {
    log.error('Error checking out stock item', { error }, 'ToolCheckout');
    return res.status(500).json({ error: 'Failed to check out item' });
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
