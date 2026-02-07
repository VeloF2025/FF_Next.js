import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: 'Project ID is required'
      });
    }

    try {
      // Use the mapping table if it exists, otherwise fall back to direct matching
      const properties = await sql`
        SELECT
          op.*,
          -- Try mapping table first
          COALESCE(
            map.sow_pole_number,
            sp.pole_number
          ) as sow_pole_number,
          -- Include match metadata
          COALESCE(
            map.match_type,
            CASE WHEN sp.pole_number IS NOT NULL THEN 'direct' END
          ) as match_type,
          map.confidence_score,
          sd.drop_number as sow_drop_number
        FROM onemap_properties op
        -- Try mapping table
        LEFT JOIN sow_onemap_mapping map
          ON op.pole_number = map.onemap_pole_number
          AND map.project_id = ${projectId as string}
        -- Direct match fallback
        LEFT JOIN sow_poles sp
          ON op.pole_number = sp.pole_number
          AND sp.project_id = ${projectId as string}
          AND map.sow_pole_number IS NULL
        -- Drop matching
        LEFT JOIN sow_drops sd
          ON op.drop_number = sd.drop_number
          AND sd.project_id = ${projectId as string}
        ORDER BY op.property_id ASC
      `;

      // Calculate statistics
      const stats = {
        total: properties.length,
        linked: properties.filter(p => p.sow_pole_number || p.sow_drop_number).length,
        unlinked: properties.filter(p => !p.sow_pole_number && !p.sow_drop_number).length,
        linkingRate: 0,
        matchTypes: {} as Record<string, number>
      };

      stats.linkingRate = stats.total > 0
        ? Math.round((stats.linked / stats.total) * 100)
        : 0;

      // Count match types
      properties.forEach((p: any) => {
        if (p.match_type) {
          stats.matchTypes[p.match_type] = (stats.matchTypes[p.match_type] || 0) + 1;
        }
      });

      return res.status(200).json({
        success: true,
        data: properties,
        count: properties.length,
        stats,
        usedMapping: true
      });

    } catch (error) {
      log.error('Error fetching OneMap data', { error });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch OneMap data'
      });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }
}

export default withAuth(handler);