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
      // Enhanced matching: try multiple strategies
      const properties = await sql`
        WITH pole_matches AS (
          -- Strategy 1: Exact match
          SELECT
            op.property_id,
            sp.pole_number as matched_pole,
            'exact' as match_type
          FROM onemap_properties op
          INNER JOIN sow_poles sp
            ON op.pole_number = sp.pole_number
            AND sp.project_id = ${projectId as string}

          UNION

          -- Strategy 2: Match by numeric suffix (e.g., LAW.P.A001 matches LAW.P.D001)
          SELECT
            op.property_id,
            sp.pole_number as matched_pole,
            'suffix' as match_type
          FROM onemap_properties op
          INNER JOIN sow_poles sp
            ON substring(op.pole_number from '\\d+$') = substring(sp.pole_number from '\\d+$')
            AND sp.project_id = ${projectId as string}
            AND substring(op.pole_number from '\\d+$') IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM sow_poles sp2
              WHERE op.pole_number = sp2.pole_number
              AND sp2.project_id = ${projectId as string}
            )

          UNION

          -- Strategy 3: Use mapping table if exists
          SELECT
            op.property_id,
            map.sow_pole_number as matched_pole,
            map.match_type
          FROM onemap_properties op
          INNER JOIN sow_onemap_mapping map
            ON op.pole_number = map.onemap_pole_number
            AND map.project_id = ${projectId as string}
            AND map.confidence_score >= 0.7
        )
        SELECT
          op.*,
          pm.matched_pole as sow_pole_number,
          pm.match_type,
          sd.drop_number as sow_drop_number
        FROM onemap_properties op
        LEFT JOIN pole_matches pm ON op.property_id = pm.property_id
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
        linkingRate: 0
      };

      stats.linkingRate = stats.total > 0
        ? Math.round((stats.linked / stats.total) * 100)
        : 0;

      return res.status(200).json({
        success: true,
        data: properties,
        count: properties.length,
        stats
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