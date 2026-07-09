import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
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
  feature_kind: 'coverage' | 'presence' | 'route' | 'project_aoi';
  point_count: number | null;
  source_label: string | null;
  geometry: Record<string, unknown>;
};

const FEATURE_KINDS = ['coverage', 'presence', 'route', 'project_aoi'] as const;
type FeatureKind = (typeof FEATURE_KINDS)[number];

const DEFAULT_FEATURE_LIMIT = 5000;
const MAX_FEATURE_LIMIT = 15000;

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

function requestedFeatureKinds(value: string | string[] | undefined): FeatureKind[] | null {
  const raw = Array.isArray(value) ? value.join(',') : value;
  if (!raw) return null;
  const requested = raw
    .split(',')
    .map((kind) => kind.trim())
    .filter((kind): kind is FeatureKind => FEATURE_KINDS.includes(kind as FeatureKind));
  return requested.length > 0 ? requested : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const limit = requestedLimit(req.query.limit);
    const operatorSlug = requestedOperatorSlug(req.query.operatorSlug);
    const featureKinds = requestedFeatureKinds(req.query.featureKinds);
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
          NULL::integer AS point_count,
          'Official FNO coverage polygon'::text AS source_label,
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
          NULL::integer AS point_count,
          'Official FNO presence marker'::text AS source_label,
          ST_AsGeoJSON(pp.geom)::json AS geometry,
          0::double precision AS sort_area
        FROM fno_atlas_presence_points pp
        JOIN fno_atlas_operators o ON o.id = pp.operator_id
        WHERE ($1::text IS NULL OR o.slug = $1)
      ), routes AS (
        SELECT rl.id::text,
          o.slug AS operator_slug,
          o.name AS operator_name,
          o.brand_color,
          rl.route_name AS area_name,
          rl.route_type AS rollout_status,
          rl.network_type,
          rl.confidence,
          'route'::text AS feature_kind,
          NULL::integer AS point_count,
          'Imported FNO route/backhaul line'::text AS source_label,
          ST_AsGeoJSON(ST_SimplifyPreserveTopology(rl.geom, 0.0005))::json AS geometry,
          ST_Length(rl.geom::geography) AS sort_area
        FROM fno_atlas_route_lines rl
        JOIN fno_atlas_operators o ON o.id = rl.operator_id
        WHERE rl.retired_at IS NULL
          AND ($1::text IS NULL OR o.slug = $1)
      ), project_aois AS (
        SELECT aoi.id::text,
          o.slug AS operator_slug,
          o.name AS operator_name,
          o.brand_color,
          aoi.area_name,
          'velocity_aoi'::text AS rollout_status,
          'project_aoi'::text AS network_type,
          aoi.confidence,
          'project_aoi'::text AS feature_kind,
          aoi.point_count,
          'Velocity AOI - not official FNO coverage'::text AS source_label,
          ST_AsGeoJSON(ST_SimplifyPreserveTopology(aoi.geom, 0.0002))::json AS geometry,
          ST_Area(aoi.geom::geography) AS sort_area
        FROM fno_atlas_project_aois aoi
        LEFT JOIN fno_atlas_operators o ON o.id = aoi.operator_id
        WHERE aoi.retired_at IS NULL
          AND ($1::text IS NULL OR o.slug = $1)
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
        point_count,
        source_label,
        geometry
      FROM (
        SELECT * FROM coverage
        UNION ALL
        SELECT * FROM presence
        UNION ALL
        SELECT * FROM routes
        UNION ALL
        SELECT * FROM project_aois
      ) features
      WHERE ($3::text[] IS NULL OR feature_kind = ANY($3::text[]))
      ORDER BY CASE feature_kind WHEN 'coverage' THEN 0 WHEN 'project_aoi' THEN 1 WHEN 'route' THEN 2 WHEN 'presence' THEN 3 ELSE 4 END,
        sort_area DESC,
        operator_name,
        area_name NULLS LAST
      LIMIT $2`,
      [operatorSlug, limit, featureKinds],
    );

    return apiResponse.success(res, {
      type: 'FeatureCollection',
      meta: {
        featureLimit: limit,
        operatorSlug,
        featureKinds,
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
          pointCount: row.point_count,
          sourceLabel: row.source_label,
        },
        geometry: row.geometry,
      })),
    });
  } catch (error) {
    log.error('Failed to load FNO Atlas coverage geometry', { error }, 'FnoAtlasAPI');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
