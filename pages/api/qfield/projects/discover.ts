/**
 * API Route: /api/qfield/projects/discover
 * GET - Fetch available projects from QFieldCloud that aren't already registered
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
import { getProjects } from '@/modules/qfield-sync/services/qfieldcloudApiService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Fetch all projects from QFieldCloud
    const qfieldProjects = await getProjects();

    // Fetch already registered project IDs
    const registered = await pool.query('SELECT qfield_project_id FROM qfield_projects');
    const registeredIds = new Set(registered.rows.map((r: any) => r.qfield_project_id));

    // Map and mark which are already registered
    const projects = qfieldProjects.map((p: any) => ({
      id: p.id,
      name: p.name,
      owner_id: p.owner_id,
      created_at: p.created_at,
      updated_at: p.updated_at,
      already_registered: registeredIds.has(p.id),
    }));

    return res.status(200).json({ success: true, data: projects });
  } catch (error: any) {
    log.error('QFieldDiscoverAPI', 'Failed to discover QFieldCloud projects', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default withAuth(withRole('admin')(handler));
