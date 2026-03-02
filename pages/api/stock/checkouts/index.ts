/**
 * Active Checkouts API
 *
 * GET - List all active checkouts (status=checked_out)
 * Filters: stockItemId, managerId, projectId
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
    const { stockItemId, managerId, projectId } = req.query;

    // Use separate query branches to avoid conditional SQL fragments
    let checkouts;

    if (stockItemId && managerId && projectId) {
      checkouts = await sql`
        SELECT
          tc.id, tc.stock_item_id, tc.serial_id, tc.serial_number,
          tc.checked_out_by, tc.project_id, tc.job_site_name,
          tc.expected_return_date, tc.checked_out_at, tc.status,
          si.name AS item_name, si.item_code, si.category,
          u.first_name || ' ' || u.last_name AS checked_out_by_name,
          p.name AS project_name,
          tc.expected_return_date < CURRENT_DATE AS is_overdue
        FROM tool_checkouts tc
        JOIN stock_items si ON si.id = tc.stock_item_id
        JOIN users u ON u.id = tc.checked_out_by
        LEFT JOIN projects p ON p.id = tc.project_id
        WHERE tc.status = 'checked_out'
          AND tc.stock_item_id = ${stockItemId}
          AND tc.checked_out_by = ${managerId}
          AND tc.project_id = ${projectId}
        ORDER BY tc.checked_out_at DESC
      `;
    } else if (stockItemId && managerId) {
      checkouts = await sql`
        SELECT
          tc.id, tc.stock_item_id, tc.serial_id, tc.serial_number,
          tc.checked_out_by, tc.project_id, tc.job_site_name,
          tc.expected_return_date, tc.checked_out_at, tc.status,
          si.name AS item_name, si.item_code, si.category,
          u.first_name || ' ' || u.last_name AS checked_out_by_name,
          p.name AS project_name,
          tc.expected_return_date < CURRENT_DATE AS is_overdue
        FROM tool_checkouts tc
        JOIN stock_items si ON si.id = tc.stock_item_id
        JOIN users u ON u.id = tc.checked_out_by
        LEFT JOIN projects p ON p.id = tc.project_id
        WHERE tc.status = 'checked_out'
          AND tc.stock_item_id = ${stockItemId}
          AND tc.checked_out_by = ${managerId}
        ORDER BY tc.checked_out_at DESC
      `;
    } else if (stockItemId && projectId) {
      checkouts = await sql`
        SELECT
          tc.id, tc.stock_item_id, tc.serial_id, tc.serial_number,
          tc.checked_out_by, tc.project_id, tc.job_site_name,
          tc.expected_return_date, tc.checked_out_at, tc.status,
          si.name AS item_name, si.item_code, si.category,
          u.first_name || ' ' || u.last_name AS checked_out_by_name,
          p.name AS project_name,
          tc.expected_return_date < CURRENT_DATE AS is_overdue
        FROM tool_checkouts tc
        JOIN stock_items si ON si.id = tc.stock_item_id
        JOIN users u ON u.id = tc.checked_out_by
        LEFT JOIN projects p ON p.id = tc.project_id
        WHERE tc.status = 'checked_out'
          AND tc.stock_item_id = ${stockItemId}
          AND tc.project_id = ${projectId}
        ORDER BY tc.checked_out_at DESC
      `;
    } else if (managerId && projectId) {
      checkouts = await sql`
        SELECT
          tc.id, tc.stock_item_id, tc.serial_id, tc.serial_number,
          tc.checked_out_by, tc.project_id, tc.job_site_name,
          tc.expected_return_date, tc.checked_out_at, tc.status,
          si.name AS item_name, si.item_code, si.category,
          u.first_name || ' ' || u.last_name AS checked_out_by_name,
          p.name AS project_name,
          tc.expected_return_date < CURRENT_DATE AS is_overdue
        FROM tool_checkouts tc
        JOIN stock_items si ON si.id = tc.stock_item_id
        JOIN users u ON u.id = tc.checked_out_by
        LEFT JOIN projects p ON p.id = tc.project_id
        WHERE tc.status = 'checked_out'
          AND tc.checked_out_by = ${managerId}
          AND tc.project_id = ${projectId}
        ORDER BY tc.checked_out_at DESC
      `;
    } else if (stockItemId) {
      checkouts = await sql`
        SELECT
          tc.id, tc.stock_item_id, tc.serial_id, tc.serial_number,
          tc.checked_out_by, tc.project_id, tc.job_site_name,
          tc.expected_return_date, tc.checked_out_at, tc.status,
          si.name AS item_name, si.item_code, si.category,
          u.first_name || ' ' || u.last_name AS checked_out_by_name,
          p.name AS project_name,
          tc.expected_return_date < CURRENT_DATE AS is_overdue
        FROM tool_checkouts tc
        JOIN stock_items si ON si.id = tc.stock_item_id
        JOIN users u ON u.id = tc.checked_out_by
        LEFT JOIN projects p ON p.id = tc.project_id
        WHERE tc.status = 'checked_out'
          AND tc.stock_item_id = ${stockItemId}
        ORDER BY tc.checked_out_at DESC
      `;
    } else if (managerId) {
      checkouts = await sql`
        SELECT
          tc.id, tc.stock_item_id, tc.serial_id, tc.serial_number,
          tc.checked_out_by, tc.project_id, tc.job_site_name,
          tc.expected_return_date, tc.checked_out_at, tc.status,
          si.name AS item_name, si.item_code, si.category,
          u.first_name || ' ' || u.last_name AS checked_out_by_name,
          p.name AS project_name,
          tc.expected_return_date < CURRENT_DATE AS is_overdue
        FROM tool_checkouts tc
        JOIN stock_items si ON si.id = tc.stock_item_id
        JOIN users u ON u.id = tc.checked_out_by
        LEFT JOIN projects p ON p.id = tc.project_id
        WHERE tc.status = 'checked_out'
          AND tc.checked_out_by = ${managerId}
        ORDER BY tc.checked_out_at DESC
      `;
    } else if (projectId) {
      checkouts = await sql`
        SELECT
          tc.id, tc.stock_item_id, tc.serial_id, tc.serial_number,
          tc.checked_out_by, tc.project_id, tc.job_site_name,
          tc.expected_return_date, tc.checked_out_at, tc.status,
          si.name AS item_name, si.item_code, si.category,
          u.first_name || ' ' || u.last_name AS checked_out_by_name,
          p.name AS project_name,
          tc.expected_return_date < CURRENT_DATE AS is_overdue
        FROM tool_checkouts tc
        JOIN stock_items si ON si.id = tc.stock_item_id
        JOIN users u ON u.id = tc.checked_out_by
        LEFT JOIN projects p ON p.id = tc.project_id
        WHERE tc.status = 'checked_out'
          AND tc.project_id = ${projectId}
        ORDER BY tc.checked_out_at DESC
      `;
    } else {
      checkouts = await sql`
        SELECT
          tc.id, tc.stock_item_id, tc.serial_id, tc.serial_number,
          tc.checked_out_by, tc.project_id, tc.job_site_name,
          tc.expected_return_date, tc.checked_out_at, tc.status,
          si.name AS item_name, si.item_code, si.category,
          u.first_name || ' ' || u.last_name AS checked_out_by_name,
          p.name AS project_name,
          tc.expected_return_date < CURRENT_DATE AS is_overdue
        FROM tool_checkouts tc
        JOIN stock_items si ON si.id = tc.stock_item_id
        JOIN users u ON u.id = tc.checked_out_by
        LEFT JOIN projects p ON p.id = tc.project_id
        WHERE tc.status = 'checked_out'
        ORDER BY tc.checked_out_at DESC
      `;
    }

    return res.status(200).json({ data: checkouts });
  } catch (error) {
    log.error('Failed to fetch active checkouts', { error }, 'StockCheckouts');
    return res.status(500).json({ error: 'Failed to fetch active checkouts' });
  }
}

export default withAuth(handler);
