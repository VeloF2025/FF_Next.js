import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { query } from '@/lib/db-pool';
import { log } from '@/lib/logger';

type CoverageGeometryRow = {
  id: string;
  operator_slug: string;
  operator_name: string;
  brand_color: string | null;
  area_name: string | null;
  rollout_status: string;
  network_type: string;
  confidence: string;
  geometry: Record<string, unknown>;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const rows = await query<CoverageGeometryRow>(
      `SELECT ca.id::text,
        o.slug AS operator_slug,
        o.name AS operator_name,
        o.brand_color,
        ca.area_name,
        ca.rollout_status,
        ca.network_type,
        ca.confidence,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(ca.geom, 0.001))::json AS geometry
       FROM fno_atlas_coverage_areas ca
       JOIN fno_atlas_operators o ON o.id = ca.operator_id
       WHERE ca.retired_at IS NULL
       ORDER BY o.name, ca.area_name NULLS LAST`,
    );

    return apiResponse.success(res, {
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        id: row.id,
        properties: {
          operatorSlug: row.operator_slug,
          operatorName: row.operator_name,
          brandColor: row.brand_color,
          areaName: row.area_name,
          rolloutStatus: row.rollout_status,
          networkType: row.network_type,
          confidence: row.confidence,
        },
        geometry: row.geometry,
      })),
    });
  } catch (error) {
    log.error('Failed to load FNO Atlas coverage geometry', { error }, 'FnoAtlasAPI');
    return apiResponse.internalError(res, error);
  }
}
