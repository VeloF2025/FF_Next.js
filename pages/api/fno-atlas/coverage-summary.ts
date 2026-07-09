import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { query } from '@/lib/db-pool';
import { log } from '@/lib/logger';

type OperatorCoverageSummary = {
  operator_slug: string;
  operator_name: string;
  brand_color: string | null;
  coverage_polygons: number;
  coverage_km2: string | null;
  presence_points: number;
  last_seen_at: string | null;
};

type OverlaySummary = {
  match_type: string;
  count: number;
};

type ProjectOverlay = {
  project_code: string | null;
  project_name: string | null;
  operator_slug: string;
  operator_name: string;
  match_type: string;
  distance_m: string | null;
  fit_score: string;
  evidence: Record<string, unknown>;
};

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const operatorCoverage = await query<OperatorCoverageSummary>(
      `WITH coverage AS (
        SELECT operator_id,
          COUNT(*)::int AS coverage_polygons,
          ROUND((COALESCE(SUM(ST_Area(geom::geography)), 0) / 1000000)::numeric, 2)::text AS coverage_km2,
          MAX(last_seen_at) AS last_seen_at
        FROM fno_atlas_coverage_areas
        WHERE retired_at IS NULL
        GROUP BY operator_id
      ), presence AS (
        SELECT operator_id,
          COUNT(*)::int AS presence_points,
          MAX(last_seen_at) AS last_seen_at
        FROM fno_atlas_presence_points
        GROUP BY operator_id
      )
      SELECT o.slug AS operator_slug,
        o.name AS operator_name,
        o.brand_color,
        COALESCE(c.coverage_polygons, 0)::int AS coverage_polygons,
        COALESCE(c.coverage_km2, '0.00') AS coverage_km2,
        COALESCE(p.presence_points, 0)::int AS presence_points,
        GREATEST(c.last_seen_at, p.last_seen_at)::text AS last_seen_at
      FROM fno_atlas_operators o
      LEFT JOIN coverage c ON c.operator_id = o.id
      LEFT JOIN presence p ON p.operator_id = o.id
      ORDER BY coverage_polygons DESC, presence_points DESC, o.name`,
    );

    const overlaySummary = await query<OverlaySummary>(
      `SELECT match_type, COUNT(*)::int AS count
       FROM fno_atlas_project_overlays
       GROUP BY match_type
       ORDER BY match_type`,
    );

    const projectOverlays = await query<ProjectOverlay>(
      `SELECT po.project_code,
        p.project_name,
        o.slug AS operator_slug,
        o.name AS operator_name,
        po.match_type,
        ROUND(po.distance_m, 0)::text AS distance_m,
        ROUND(po.fit_score, 2)::text AS fit_score,
        po.evidence
       FROM fno_atlas_project_overlays po
       JOIN fno_atlas_operators o ON o.id = po.operator_id
       LEFT JOIN projects p ON p.id = po.project_id
       ORDER BY po.fit_score DESC, po.distance_m ASC NULLS LAST
       LIMIT 30`,
    );

    return apiResponse.success(res, { operatorCoverage, overlaySummary, projectOverlays });
  } catch (error) {
    log.error('Failed to load FNO Atlas coverage summary', { error }, 'FnoAtlasAPI');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
