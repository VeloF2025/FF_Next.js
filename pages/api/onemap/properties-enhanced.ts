import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

// Normalize pole numbers for matching
// Handles formats like LAW.P.A001, LAW.P.D524, etc.
function normalizePoleNumber(poleNumber: string | null): string | null {
  if (!poleNumber) return null;

  // Extract the base pattern and number, ignoring the middle letter
  // LAW.P.A001 -> LAW.P.001
  // LAW.P.D524 -> LAW.P.524
  const match = poleNumber.match(/^(.*\.P\.)([A-Z])(\d+)$/);
  if (match) {
    return `${match[1]}${match[3]}`;
  }

  return poleNumber;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { projectId, matchingMode = 'enhanced' } = req.query;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: 'Project ID is required'
      });
    }

    try {
      let properties;

      if (matchingMode === 'enhanced') {
        // Enhanced matching with multiple strategies
        properties = await sql`
          WITH normalized_sow AS (
            SELECT
              *,
              -- Normalize pole numbers by removing the letter prefix
              CASE
                WHEN pole_number ~ '^.*\.P\.[A-Z]\d+$'
                THEN regexp_replace(pole_number, '^(.*\.P\.)[A-Z](\d+)$', '\1\2')
                ELSE pole_number
              END as normalized_pole,
              -- Also extract just the numeric part for fuzzy matching
              CASE
                WHEN pole_number ~ '\d+$'
                THEN regexp_replace(pole_number, '^.*?(\d+)$', '\1')::integer
                ELSE NULL
              END as pole_numeric
            FROM sow_poles
            WHERE project_id = ${projectId as string}
          ),
          normalized_onemap AS (
            SELECT
              *,
              -- Normalize OneMap pole numbers
              CASE
                WHEN pole_number ~ '^.*\.P\.[A-Z]\d+$'
                THEN regexp_replace(pole_number, '^(.*\.P\.)[A-Z](\d+)$', '\1\2')
                ELSE pole_number
              END as normalized_pole,
              -- Extract numeric part
              CASE
                WHEN pole_number ~ '\d+$'
                THEN regexp_replace(pole_number, '^.*?(\d+)$', '\1')::integer
                ELSE NULL
              END as pole_numeric
            FROM onemap_properties
          )
          SELECT
            op.*,
            -- Primary match: exact pole number
            COALESCE(sp1.pole_number, sp2.pole_number, sp3.pole_number) as sow_pole_number,
            -- Match type for debugging
            CASE
              WHEN sp1.pole_number IS NOT NULL THEN 'exact'
              WHEN sp2.pole_number IS NOT NULL THEN 'normalized'
              WHEN sp3.pole_number IS NOT NULL THEN 'proximity'
              ELSE NULL
            END as match_type,
            -- Drop matching (unchanged)
            sd.drop_number as sow_drop_number,
            -- Additional SOW data for context
            COALESCE(sp1.status, sp2.status, sp3.status) as sow_status,
            COALESCE(sp1.latitude, sp2.latitude, sp3.latitude) as sow_lat,
            COALESCE(sp1.longitude, sp2.longitude, sp3.longitude) as sow_lng
          FROM normalized_onemap op
          -- Strategy 1: Exact match
          LEFT JOIN sow_poles sp1
            ON op.pole_number = sp1.pole_number
            AND sp1.project_id = ${projectId}
          -- Strategy 2: Normalized match (ignore letter prefix)
          LEFT JOIN normalized_sow sp2
            ON op.normalized_pole = sp2.normalized_pole
            AND sp2.project_id = ${projectId}
            AND sp1.pole_number IS NULL
          -- Strategy 3: Location proximity match (within ~10 meters)
          LEFT JOIN sow_poles sp3
            ON op.latitude IS NOT NULL
            AND sp3.latitude IS NOT NULL
            AND ABS(op.latitude - sp3.latitude) < 0.0001
            AND ABS(op.longitude - sp3.longitude) < 0.0001
            AND sp3.project_id = ${projectId}
            AND sp1.pole_number IS NULL
            AND sp2.pole_number IS NULL
          -- Drop matching
          LEFT JOIN sow_drops sd
            ON op.drop_number = sd.drop_number
            AND sd.project_id = ${projectId}
          ORDER BY op.property_id ASC
        `;
      } else {
        // Original exact matching only
        properties = await sql`
          SELECT
            op.*,
            sp.pole_number as sow_pole_number,
            sd.drop_number as sow_drop_number
          FROM onemap_properties op
          LEFT JOIN sow_poles sp ON op.pole_number = sp.pole_number
            AND sp.project_id = ${projectId}
          LEFT JOIN sow_drops sd ON op.drop_number = sd.drop_number
            AND sd.project_id = ${projectId}
          ORDER BY op.property_id ASC
        `;
      }

      // Calculate statistics
      const stats: { total: number; linked: number; unlinked: number; linkingRate: number; matchTypes?: Record<string, number> } = {
        total: properties.length,
        linked: properties.filter(p => p.sow_pole_number || p.sow_drop_number).length,
        unlinked: properties.filter(p => !p.sow_pole_number && !p.sow_drop_number).length,
        linkingRate: 0
      };

      stats.linkingRate = stats.total > 0
        ? Math.round((stats.linked / stats.total) * 100)
        : 0;

      // Add match type breakdown if enhanced mode
      if (matchingMode === 'enhanced') {
        const matchTypes = properties.reduce((acc: Record<string, number>, p: any) => {
          if (p.match_type) {
            acc[p.match_type] = (acc[p.match_type] || 0) + 1;
          }
          return acc;
        }, {});
        stats.matchTypes = matchTypes;
      }

      return res.status(200).json({
        success: true,
        data: properties,
        count: properties.length,
        stats,
        matchingMode
      });

    } catch (error) {
      log.error('Error fetching OneMap data', { error });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch OneMap data'
      });
    }
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }
}

export default withAuth(handler);