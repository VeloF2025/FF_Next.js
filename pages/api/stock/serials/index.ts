/**
 * Stock Item Serials API
 *
 * GET  - List serials for a stock item (query param: stockItemId)
 * POST - Add a new serial to a stock item (manager+ only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, hasRole } from '@/lib/auth';
import { log } from '@/lib/logger';

const DATABASE_URL = process.env.DATABASE_URL || '';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sql = neon(DATABASE_URL);
  const user = (req as any).user;

  if (req.method === 'GET') {
    try {
      const { stockItemId } = req.query;

      if (!stockItemId || typeof stockItemId !== 'string') {
        return res.status(400).json({ error: 'stockItemId query parameter is required' });
      }

      const serials = await sql`
        SELECT
          s.id,
          s.stock_item_id,
          s.serial_number,
          s.status,
          s.current_checkout_id,
          s.notes,
          s.created_at,
          s.updated_at,
          tc.checked_out_by,
          tc.project_id,
          tc.job_site_name,
          tc.expected_return_date,
          tc.checked_out_at,
          u.first_name || ' ' || u.last_name AS checked_out_by_name,
          p.name AS project_name
        FROM stock_item_serials s
        LEFT JOIN tool_checkouts tc ON tc.id = s.current_checkout_id AND tc.status = 'checked_out'
        LEFT JOIN users u ON u.id = tc.checked_out_by
        LEFT JOIN projects p ON p.id = tc.project_id
        WHERE s.stock_item_id = ${stockItemId}
        ORDER BY s.serial_number ASC
      `;

      return res.status(200).json({ data: serials });
    } catch (error) {
      log.error('Failed to fetch serials', { error }, 'StockSerials');
      return res.status(500).json({ error: 'Failed to fetch serials' });
    }
  }

  if (req.method === 'POST') {
    if (!hasRole(user, 'manager')) {
      return res.status(403).json({ error: 'Manager role or higher required' });
    }

    try {
      const { stockItemId, serialNumber, notes } = req.body;

      if (!stockItemId || !serialNumber) {
        return res.status(400).json({ error: 'stockItemId and serialNumber are required' });
      }

      // Verify stock item exists
      const [item] = await sql`
        SELECT id, category FROM stock_items WHERE id = ${stockItemId}
      `;
      if (!item) {
        return res.status(404).json({ error: 'Stock item not found' });
      }

      const [serial] = await sql`
        INSERT INTO stock_item_serials (stock_item_id, serial_number, notes)
        VALUES (${stockItemId}, ${serialNumber.trim()}, ${notes || null})
        RETURNING *
      `;

      return res.status(201).json({ data: serial });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        return res.status(409).json({ error: 'Serial number already exists for this item' });
      }
      log.error('Failed to create serial', { error }, 'StockSerials');
      return res.status(500).json({ error: 'Failed to create serial' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
