/**
 * API Route: /api/qfield/projects
 * GET  - List all registered QField projects with linked FibreFlow projects
 * POST - Register a new QField project with optional FF project links
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
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

async function handleGet(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const result = await pool.query(`
      SELECT
        qp.id,
        qp.qfield_project_id,
        qp.name,
        qp.description,
        qp.qfield_url,
        qp.is_active,
        qp.is_default,
        qp.sync_enabled,
        qp.last_synced_at,
        qp.created_at,
        qp.updated_at,
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
      GROUP BY qp.id
      ORDER BY qp.is_default DESC, qp.name ASC
    `);

    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    log.error('QFieldProjectsAPI', 'Failed to list projects', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { qfield_project_id, name, description, qfield_url, is_default, sync_enabled, linked_project_ids } = req.body;

    if (!qfield_project_id || !name) {
      return res.status(400).json({ success: false, error: 'qfield_project_id and name are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // If setting as default, unset any existing default
      if (is_default) {
        await client.query('UPDATE qfield_projects SET is_default = false WHERE is_default = true');
      }

      const insertResult = await client.query(`
        INSERT INTO qfield_projects (qfield_project_id, name, description, qfield_url, is_default, sync_enabled)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [qfield_project_id, name, description || null, qfield_url || null, is_default || false, sync_enabled !== false]);

      const newProject = insertResult.rows[0];

      // Insert links if provided
      if (linked_project_ids && Array.isArray(linked_project_ids) && linked_project_ids.length > 0) {
        const linkValues = linked_project_ids
          .map((_: string, i: number) => `($1, $${i + 2})`)
          .join(', ');
        await client.query(
          `INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id) VALUES ${linkValues}
           ON CONFLICT DO NOTHING`,
          [newProject.id, ...linked_project_ids]
        );
      }

      await client.query('COMMIT');
      log.info('QFieldProjectsAPI', `Created QField project: ${name}`, { qfield_project_id });
      return res.status(201).json({ success: true, data: newProject });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    log.error('QFieldProjectsAPI', 'Failed to create project', error);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'QField project with this ID already exists' });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default withAuth(withRole('admin')(handler));
