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

const DEFAULT_FEATURE_LIMIT = 5000;
const MAX_FEATURE_LIMIT = 5000;

function requestedLimit(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw || DEFAULT_FEATURE_LIMIT);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_FEATURE_LIMIT;
  return Math.min(Math.floor(parsed), MAX_FEATURE_LIMIT);
}

function requestedOperatorSlug(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return slug || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const limit = requestedLimit(req.query.limit);
    const operatorSlug = requestedOperatorSlug(req.query.operatorSlug);
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
         AND ($1::text IS NULL OR o.slug = $1)
       ORDER BY ST_Area(ca.geom::geography) DESC, o.name, ca.area_name NULLS LAST
       LIMIT $2`,
      [operatorSlug, limit],
    );

    return apiResponse.success(res, {
      type: 'FeatureCollection',
      meta: {
        featureLimit: limit,
        operatorSlug,
        returnedFeatures: rows.length,
      },
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
