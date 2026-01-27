/**
 * API Route: /api/qfield/projects/[id]
 * GET    - Single project details with links
 * PUT    - Update project (name, active, default, links)
 * DELETE - Soft-delete (set is_active = false)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'Project ID is required' });
  }

  if (req.method === 'GET') return handleGet(id, res);
  if (req.method === 'PUT') return handlePut(id, req, res);
  if (req.method === 'DELETE') return handleDelete(id, res);
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

async function handleGet(id: string, res: NextApiResponse) {
  try {
    const result = await pool.query(`
      SELECT
        qp.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', p.id,
              'project_name', p.project_name,
              'project_code', p.project_code
            )
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
        ) AS linked_projects
      FROM qfield_projects qp
      LEFT JOIN qfield_project_links qpl ON qpl.qfield_project_id = qp.id
      LEFT JOIN projects p ON p.id = qpl.fibreflow_project_id
      WHERE qp.id = $1
      GROUP BY qp.id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'QField project not found' });
    }

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    log.error('QFieldProjectAPI', 'Failed to get project', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function handlePut(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { name, description, qfield_url, is_active, is_default, sync_enabled, linked_project_ids } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // If setting as default, unset others
      if (is_default) {
        await client.query('UPDATE qfield_projects SET is_default = false WHERE is_default = true AND id != $1', [id]);
      }

      const updateResult = await client.query(`
        UPDATE qfield_projects SET
          name = COALESCE($2, name),
          description = COALESCE($3, description),
          qfield_url = COALESCE($4, qfield_url),
          is_active = COALESCE($5, is_active),
          is_default = COALESCE($6, is_default),
          sync_enabled = COALESCE($7, sync_enabled),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, name, description, qfield_url, is_active, is_default, sync_enabled]);

      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'QField project not found' });
      }

      // Update links if provided
      if (linked_project_ids !== undefined && Array.isArray(linked_project_ids)) {
        await client.query('DELETE FROM qfield_project_links WHERE qfield_project_id = $1', [id]);
        if (linked_project_ids.length > 0) {
          const linkValues = linked_project_ids
            .map((_: string, i: number) => `($1, $${i + 2})`)
            .join(', ');
          await client.query(
            `INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id) VALUES ${linkValues}
             ON CONFLICT DO NOTHING`,
            [id, ...linked_project_ids]
          );
        }
      }

      await client.query('COMMIT');
      log.info('QFieldProjectAPI', `Updated QField project: ${id}`);
      return res.status(200).json({ success: true, data: updateResult.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    log.error('QFieldProjectAPI', 'Failed to update project', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function handleDelete(id: string, res: NextApiResponse) {
  try {
    const result = await pool.query(
      'UPDATE qfield_projects SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'QField project not found' });
    }

    log.info('QFieldProjectAPI', `Deactivated QField project: ${id}`);
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    log.error('QFieldProjectAPI', 'Failed to delete project', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default withAuth(withRole('admin')(handler));
