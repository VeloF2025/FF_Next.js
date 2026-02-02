import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    switch (req.method) {
      case 'GET': {
        // Get SOW summary for the project - query main tables
        const [poles, drops, fibre] = await Promise.all([
          sql`SELECT COUNT(*) as count FROM poles WHERE project_id = ${projectId}`,
          sql`SELECT COUNT(*) as count FROM drops WHERE project_id = ${projectId}`,
          sql`SELECT COUNT(*) as count FROM fibre_segments WHERE project_id = ${projectId}`
        ]);

        return res.status(200).json({
          success: true,
          data: {
            projectId,
            poles: {
              count: parseInt(poles[0]?.count || '0')
            },
            drops: {
              count: parseInt(drops[0]?.count || '0')
            },
            fibre: {
              count: parseInt(fibre[0]?.count || '0')
            },
            lastUpdated: new Date().toISOString()
          }
        });
      }

      default:
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }
  } catch (error) {
    console.error('SOW Project API error:', error);
    return res.status(500).json({
      error: 'Failed to fetch SOW project data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withAuth(handler);
