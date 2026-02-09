/**
 * API Route: /api/activate/import-pp-data
 *
 * Purpose: Query OES PP (Pre-Provision) data - ONT serials placed on network before activation
 * PP data is automatically imported during OES import (import-oes.ts).
 *
 * Methods:
 * - GET ?action=stats: Summary statistics
 * - GET ?action=list: Paginated list of PP data records
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth, withRole } from '@/lib/auth';
import pool from '@/lib/db';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. PP data is imported automatically via the OES import.' });
  }

  const action = req.query.action as string;

  if (action === 'stats') {
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE resolution_status != 'unresolved') as resolved,
        COUNT(*) FILTER (WHERE resolution_status = 'unresolved') as unresolved,
        COUNT(DISTINCT project) as projects
      FROM oes_pp_data
    `);

    const lastImportResult = await pool.query(`
      SELECT created_at, filename, total_rows
      FROM oes_pp_import_batches
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const stats = statsResult.rows[0];
    const lastImport = lastImportResult.rows[0] || null;

    return res.status(200).json({
      success: true,
      data: {
        total: parseInt(stats.total, 10),
        resolved: parseInt(stats.resolved, 10),
        unresolved: parseInt(stats.unresolved, 10),
        projects: parseInt(stats.projects, 10),
        lastImport: lastImport
          ? {
              date: lastImport.created_at,
              filename: lastImport.filename,
              totalRows: lastImport.total_rows,
            }
          : null,
      },
    });
  }

  if (action === 'list') {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const offset = (page - 1) * limit;
    const project = req.query.project as string;
    const status = req.query.status as string;

    let whereClause = '';
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (project) {
      whereClause += ` AND project = $${paramIndex++}`;
      params.push(project);
    }
    if (status) {
      whereClause += ` AND resolution_status = $${paramIndex++}`;
      params.push(status);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM oes_pp_data WHERE 1=1${whereClause}`,
      params
    );

    const dataResult = await pool.query(
      `SELECT * FROM oes_pp_data
       WHERE 1=1${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );

    return res.status(200).json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total: parseInt(countResult.rows[0].total, 10),
        totalPages: Math.ceil(parseInt(countResult.rows[0].total, 10) / limit),
      },
    });
  }

  return res.status(400).json({ error: 'Invalid action. Use "stats" or "list".' });
}

export default withAuth(withRole('manager')(handler));
