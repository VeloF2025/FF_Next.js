import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

/**
 * SOW Project Summary API Route
 * GET /api/sow/project/[projectId]/summary - Get SOW summary statistics for a project
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { projectId } = req.query;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = (req as AuthenticatedNextApiRequest).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    // Get counts from main tables
    const [poleCount, dropCount, fibreCount] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM poles WHERE project_id = ${projectId}`,
      sql`SELECT COUNT(*) as count FROM drops WHERE project_id = ${projectId}`,
      sql`SELECT COUNT(*) as count FROM fibre_segments WHERE project_id = ${projectId}`
    ]);

    // Get activation count
    const activationCount = await sql`
      SELECT COUNT(*) as count
      FROM oes_activations oa
      INNER JOIN drops d ON d.id = oa.drop_id
      WHERE d.project_id = ${projectId}
    `;

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        totalPoles: parseInt(poleCount[0]?.count || '0'),
        totalDrops: parseInt(dropCount[0]?.count || '0'),
        totalFibre: parseInt(fibreCount[0]?.count || '0'),
        totalActivated: parseInt(activationCount[0]?.count || '0'),
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    log.error('SOW summary error', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch SOW summary'
    });
  }
}

export default withAuth(handler);
