/**
 * Serial Unit History API
 *
 * GET - Checkout history for a serial unit (by serial id query param)
 * Returns all checkouts regardless of status
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
    const { serialId } = req.query;

    if (!serialId || typeof serialId !== 'string') {
      return res.status(400).json({ error: 'serialId query parameter is required' });
    }

    // Verify serial exists
    const [serial] = await sql`
      SELECT s.id, s.serial_number, s.status, si.name AS item_name, si.item_code
      FROM stock_item_serials s
      JOIN stock_items si ON si.id = s.stock_item_id
      WHERE s.id = ${serialId}
    `;

    if (!serial) {
      return res.status(404).json({ error: 'Serial unit not found' });
    }

    const history = await sql`
      SELECT
        tc.id, tc.serial_number, tc.status,
        tc.checked_out_at, tc.checked_in_at,
        tc.expected_return_date, tc.condition_notes,
        tc.project_id, tc.job_site_name,
        co.first_name || ' ' || co.last_name AS checked_out_by_name,
        ci.first_name || ' ' || ci.last_name AS checked_in_by_name,
        p.name AS project_name
      FROM tool_checkouts tc
      JOIN users co ON co.id = tc.checked_out_by
      LEFT JOIN users ci ON ci.id = tc.checked_in_by
      LEFT JOIN projects p ON p.id = tc.project_id
      WHERE tc.serial_id = ${serialId}
      ORDER BY tc.checked_out_at DESC
    `;

    return res.status(200).json({
      data: {
        serial,
        history,
      },
    });
  } catch (error) {
    log.error('Failed to fetch serial history', { error }, 'StockSerialHistory');
    return res.status(500).json({ error: 'Failed to fetch serial history' });
  }
}

export default withAuth(handler);
