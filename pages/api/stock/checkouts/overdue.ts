/**
 * Overdue Checkouts API
 *
 * GET - List overdue checkouts (status=checked_out AND expected_return_date < NOW())
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const DATABASE_URL = process.env.DATABASE_URL || '';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(DATABASE_URL);

  try {
    const checkouts = await sql`
      SELECT
        tc.id, tc.stock_item_id, tc.serial_id, tc.serial_number,
        tc.checked_out_by, tc.project_id, tc.job_site_name,
        tc.expected_return_date, tc.checked_out_at, tc.status,
        si.name AS item_name, si.item_code, si.category,
        u.first_name || ' ' || u.last_name AS checked_out_by_name,
        u.email AS checked_out_by_email,
        p.name AS project_name,
        CURRENT_DATE - tc.expected_return_date AS days_overdue
      FROM tool_checkouts tc
      JOIN stock_items si ON si.id = tc.stock_item_id
      JOIN users u ON u.id = tc.checked_out_by
      LEFT JOIN projects p ON p.id = tc.project_id
      WHERE tc.status = 'checked_out'
        AND tc.expected_return_date < CURRENT_DATE
      ORDER BY tc.expected_return_date ASC
    `;

    return res.status(200).json({ data: checkouts });
  } catch (error) {
    log.error('Failed to fetch overdue checkouts', { error }, 'StockCheckoutsOverdue');
    return res.status(500).json({ error: 'Failed to fetch overdue checkouts' });
  }
}

export default withAuth(handler);
