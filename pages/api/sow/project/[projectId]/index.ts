import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

/**
 * SOW Project Data API Route
 * GET /api/sow/project/[projectId] - Get all SOW data for a project
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { projectId } = req.query;

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const userId = (req as AuthenticatedNextApiRequest).user?.id;
    if (!userId) {
      return apiResponse.unauthorized(res);
    }

    if (!projectId || typeof projectId !== 'string') {
      return apiResponse.badRequest(res, 'Project ID is required');
    }

    // Get SOW data from main tables
    const [polesResult, dropsResult, fibreResult] = await Promise.all([
      sql`SELECT * FROM poles WHERE project_id = ${projectId} ORDER BY pole_id LIMIT 1000`,
      sql`SELECT * FROM drops WHERE project_id = ${projectId} ORDER BY drop_id LIMIT 1000`,
      sql`SELECT * FROM fibre_segments WHERE project_id = ${projectId} ORDER BY segment_id LIMIT 1000`
    ]);

    // Get counts
    const [poleCount, dropCount, fibreCount] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM poles WHERE project_id = ${projectId}`,
      sql`SELECT COUNT(*) as count FROM drops WHERE project_id = ${projectId}`,
      sql`SELECT COUNT(*) as count FROM fibre_segments WHERE project_id = ${projectId}`
    ]);

    return res.status(200).json({
      success: true,
      data: {
        poles: polesResult,
        drops: dropsResult,
        fibre: fibreResult,
        summary: {
          totalPoles: parseInt(poleCount[0]?.count || '0'),
          totalDrops: parseInt(dropCount[0]?.count || '0'),
          totalFibre: parseInt(fibreCount[0]?.count || '0')
        }
      }
    });
  } catch (error) {
    log.error('SOW project data error', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch SOW data'
    });
  }
}

export default withAuth(handler);
