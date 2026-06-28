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
  feature_kind: 'coverage' | 'presence';
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
      `WITH coverage AS (
        SELECT ca.id::text,
          o.slug AS operator_slug,
          o.name AS operator_name,
          o.brand_color,
          ca.area_name,
          ca.rollout_status,
          ca.network_type,
          ca.confidence,
          'coverage'::text AS feature_kind,
          ST_AsGeoJSON(ST_SimplifyPreserveTopology(ca.geom, 0.001))::json AS geometry,
          ST_Area(ca.geom::geography) AS sort_area
        FROM fno_atlas_coverage_areas ca
        JOIN fno_atlas_operators o ON o.id = ca.operator_id
        WHERE ca.retired_at IS NULL
          AND ($1::text IS NULL OR o.slug = $1)
      ), presence AS (
        SELECT pp.id::text,
          o.slug AS operator_slug,
          o.name AS operator_name,
          o.brand_color,
          pp.point_name AS area_name,
          pp.service_status AS rollout_status,
          pp.network_type,
          pp.confidence,
          'presence'::text AS feature_kind,
          ST_AsGeoJSON(pp.geom)::json AS geometry,
          0::double precision AS sort_area
        FROM fno_atlas_presence_points pp
        JOIN fno_atlas_operators o ON o.id = pp.operator_id
        WHERE ($1::text IS NULL OR o.slug = $1)
      )
      SELECT id,
        operator_slug,
        operator_name,
        brand_color,
        area_name,
        rollout_status,
        network_type,
        confidence,
        feature_kind,
        geometry
      FROM (
        SELECT * FROM coverage
        UNION ALL
        SELECT * FROM presence
      ) features
      ORDER BY sort_area DESC, operator_name, area_name NULLS LAST
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
          featureKind: row.feature_kind,
        },
        geometry: row.geometry,
      })),
    });
  } catch (error) {
    log.error('Failed to load FNO Atlas coverage geometry', { error }, 'FnoAtlasAPI');
    return apiResponse.internalError(res, error);
  }
}
