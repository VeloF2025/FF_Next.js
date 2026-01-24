import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { projectId } = req.query;

  try {
    let data;
    if (projectId) {
      // Get specific project summary
      const result = await sql`
        SELECT 
          p.*,
          c.name as client_name,
          COUNT(DISTINCT sp.id) as pole_count,
          COUNT(DISTINCT sd.id) as drop_count,
          COALESCE(SUM(sf.length), 0) as total_fiber
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN sow_poles sp ON p.id = sp.project_id
        LEFT JOIN sow_drops sd ON p.id = sd.project_id
        LEFT JOIN sow_fibre sf ON p.id = sf.project_id
        WHERE p.id = ${projectId}
        GROUP BY p.id, c.name
      `;
      data = result[0] || null;
    } else {
      // Get all projects summary
      const result = await sql`
        SELECT 
          COUNT(*) as total_projects,
          COUNT(CASE WHEN status = 'active' OR status = 'in_progress' THEN 1 END) as active_projects,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_projects,
          COUNT(CASE WHEN status = 'on_hold' THEN 1 END) as on_hold_projects,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_projects,
          COALESCE(SUM(budget), 0) as total_budget,
          COALESCE(AVG(budget), 0) as average_budget,
          COUNT(DISTINCT client_id) as unique_clients
        FROM projects
      `;
      data = result[0] || {
        total_projects: 0,
        active_projects: 0,
        completed_projects: 0,
        on_hold_projects: 0,
        cancelled_projects: 0,
        total_budget: 0,
        average_budget: 0,
        unique_clients: 0
      };
    }

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Project summary error:', error);
    return res.status(200).json({
      success: true,
      data: projectId ? null : {
        total_projects: 0,
        active_projects: 0,
        completed_projects: 0,
        on_hold_projects: 0,
        cancelled_projects: 0,
        total_budget: 0,
        average_budget: 0,
        unique_clients: 0
      }
    });
  }
}

export default withAuth(withRole('manager')(handler));