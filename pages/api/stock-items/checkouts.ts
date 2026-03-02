/**
 * Stock Items API - List Checkouts
 *
 * GET - List active checkouts, with ?overdue=true for overdue items
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const DATABASE_URL = process.env.DATABASE_URL || '';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(DATABASE_URL);

  try {
    const { overdue, stockItemId } = req.query;

    if (overdue === 'true') {
      // List overdue checkouts (expected_return_date < today and still checked out)
      const items = await sql`
        SELECT
          tc.*,
          si.item_code, si.name as item_name, si.category,
          u.first_name || ' ' || u.last_name as checked_out_by_name,
          u.email as checked_out_by_email
        FROM tool_checkouts tc
        JOIN stock_items si ON si.id = tc.stock_item_id
        LEFT JOIN users u ON u.id = tc.checked_out_by
        WHERE tc.status = 'checked_out'
          AND tc.expected_return_date < CURRENT_DATE
        ORDER BY tc.expected_return_date ASC
      `;

      return res.status(200).json({
        data: items.map(mapCheckoutRow),
        total: items.length,
      });
    }

    if (stockItemId && typeof stockItemId === 'string') {
      // List checkouts for a specific stock item (history)
      const items = await sql`
        SELECT
          tc.*,
          si.item_code, si.name as item_name, si.category,
          u.first_name || ' ' || u.last_name as checked_out_by_name,
          u.email as checked_out_by_email,
          u2.first_name || ' ' || u2.last_name as checked_in_by_name
        FROM tool_checkouts tc
        JOIN stock_items si ON si.id = tc.stock_item_id
        LEFT JOIN users u ON u.id = tc.checked_out_by
        LEFT JOIN users u2 ON u2.id = tc.checked_in_by
        WHERE tc.stock_item_id = ${stockItemId}
        ORDER BY tc.checked_out_at DESC
      `;

      return res.status(200).json({
        data: items.map(mapCheckoutRow),
        total: items.length,
      });
    }

    // Default: list all active checkouts
    const items = await sql`
      SELECT
        tc.*,
        si.item_code, si.name as item_name, si.category,
        u.first_name || ' ' || u.last_name as checked_out_by_name,
        u.email as checked_out_by_email
      FROM tool_checkouts tc
      JOIN stock_items si ON si.id = tc.stock_item_id
      LEFT JOIN users u ON u.id = tc.checked_out_by
      WHERE tc.status = 'checked_out'
      ORDER BY tc.checked_out_at DESC
    `;

    return res.status(200).json({
      data: items.map(mapCheckoutRow),
      total: items.length,
    });
  } catch (error) {
    log.error('Error listing checkouts', { error }, 'ToolCheckout');
    return res.status(500).json({ error: 'Failed to list checkouts' });
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
    checkedOutByName: row.checked_out_by_name,
    checkedOutByEmail: row.checked_out_by_email,
    jobSiteId: row.job_site_id,
    jobSiteName: row.job_site_name,
    expectedReturnDate: row.expected_return_date,
    checkedOutAt: row.checked_out_at,
    checkedInAt: row.checked_in_at,
    checkedInBy: row.checked_in_by,
    checkedInByName: row.checked_in_by_name,
    conditionNotes: row.condition_notes,
    status: row.status,
    itemCode: row.item_code,
    itemName: row.item_name,
    category: row.category,
  };
}
