/**
 * Stock Checkout API
 *
 * POST - Check out a serial unit to a project/job site
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, hasRole } from '@/lib/auth';
import { log } from '@/lib/logger';

const DATABASE_URL = process.env.DATABASE_URL || '';

const CHECKOUT_ELIGIBLE_CATEGORIES = ['tools', 'assets', 'ppe'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(DATABASE_URL);
  const user = (req as any).user;

  if (!hasRole(user, 'manager')) {
    return res.status(403).json({ error: 'Manager role or higher required' });
  }

  try {
    const { serialId, projectId, jobSiteName, expectedReturnDate } = req.body;

    if (!serialId || !expectedReturnDate) {
      return res.status(400).json({ error: 'serialId and expectedReturnDate are required' });
    }

    // Validate return date is in the future
    const returnDate = new Date(expectedReturnDate);
    if (returnDate <= new Date()) {
      return res.status(400).json({ error: 'Expected return date must be in the future' });
    }

    // Fetch serial with stock item info
    const [serial] = await sql`
      SELECT
        s.id,
        s.stock_item_id,
        s.serial_number,
        s.status,
        si.name AS item_name,
        si.item_code,
        si.category
      FROM stock_item_serials s
      JOIN stock_items si ON si.id = s.stock_item_id
      WHERE s.id = ${serialId}
    `;

    if (!serial) {
      return res.status(404).json({ error: 'Serial unit not found' });
    }

    if (serial.status !== 'available') {
      return res.status(400).json({ error: `Unit is currently ${serial.status}, cannot check out` });
    }

    if (!CHECKOUT_ELIGIBLE_CATEGORIES.includes(serial.category)) {
      return res.status(400).json({
        error: `Category "${serial.category}" is not eligible for checkout. Eligible: ${CHECKOUT_ELIGIBLE_CATEGORIES.join(', ')}`,
      });
    }

    // Create checkout record
    const [checkout] = await sql`
      INSERT INTO tool_checkouts (
        stock_item_id, serial_id, serial_number,
        checked_out_by, project_id, job_site_name,
        expected_return_date
      ) VALUES (
        ${serial.stock_item_id}, ${serialId}, ${serial.serial_number},
        ${user.id}, ${projectId || null}, ${jobSiteName || null},
        ${expectedReturnDate}
      )
      RETURNING *
    `;

    // Update serial status
    await sql`
      UPDATE stock_item_serials
      SET status = 'checked_out',
          current_checkout_id = ${checkout.id},
          updated_at = NOW()
      WHERE id = ${serialId}
    `;

    log.info('Tool checked out', {
      checkoutId: checkout.id,
      serialNumber: serial.serial_number,
      itemName: serial.item_name,
      checkedOutBy: user.name,
      projectId,
    }, 'StockCheckout');

    return res.status(201).json({
      data: {
        ...checkout,
        item_name: serial.item_name,
        item_code: serial.item_code,
        checked_out_by_name: user.name,
      },
    });
  } catch (error) {
    log.error('Failed to check out tool', { error }, 'StockCheckout');
    return res.status(500).json({ error: 'Failed to check out tool' });
  }
}

export default withAuth(handler);
