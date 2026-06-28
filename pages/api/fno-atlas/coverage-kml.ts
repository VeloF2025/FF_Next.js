import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { query } from '@/lib/db-pool';
import { log } from '@/lib/logger';

type CoverageKmlRow = {
  operator_slug: string;
  operator_name: string;
  brand_color: string | null;
  area_name: string | null;
  rollout_status: string;
  network_type: string;
  confidence: string;
  kml_geometry: string;
};

const DEFAULT_FEATURE_LIMIT = 5000;
const MAX_FEATURE_LIMIT = 20000;

function requestedLimit(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'string' && raw.toLowerCase() === 'all') return MAX_FEATURE_LIMIT;
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

function requestedBbox(value: string | string[] | undefined): [number, number, number, number] | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function xmlEscape(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colorToKmlStyle(color: string | null): string {
  const hex = (color || '#2563eb').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '662563eb';
  const rr = hex.slice(0, 2);
  const gg = hex.slice(2, 4);
  const bb = hex.slice(4, 6);
  return `66${bb}${gg}${rr}`;
}

function buildKml(rows: CoverageKmlRow[], meta: { operatorSlug: string | null; limit: number; bbox: [number, number, number, number] | null }): string {
  const styleByOperator = new Map<string, { name: string; color: string }>();
  for (const row of rows) {
    if (!styleByOperator.has(row.operator_slug)) {
      styleByOperator.set(row.operator_slug, { name: row.operator_name, color: colorToKmlStyle(row.brand_color) });
    }
  }

  const styles = Array.from(styleByOperator.entries())
    .map(([slug, style]) => `
    <Style id="${xmlEscape(slug)}-coverage">
      <LineStyle><color>${style.color}</color><width>1.2</width></LineStyle>
      <PolyStyle><color>${style.color}</color><fill>1</fill><outline>1</outline></PolyStyle>
    </Style>`)
    .join('');

  const placemarks = rows
    .map((row) => `
    <Placemark>
      <name>${xmlEscape(row.area_name || row.operator_name)}</name>
      <styleUrl>#${xmlEscape(row.operator_slug)}-coverage</styleUrl>
      <ExtendedData>
        <Data name="operator"><value>${xmlEscape(row.operator_name)}</value></Data>
        <Data name="operatorSlug"><value>${xmlEscape(row.operator_slug)}</value></Data>
        <Data name="rolloutStatus"><value>${xmlEscape(row.rollout_status)}</value></Data>
        <Data name="networkType"><value>${xmlEscape(row.network_type)}</value></Data>
        <Data name="confidence"><value>${xmlEscape(row.confidence)}</value></Data>
      </ExtendedData>
      ${row.kml_geometry}
    </Placemark>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>FNO Atlas coverage${meta.operatorSlug ? ` - ${xmlEscape(meta.operatorSlug)}` : ''}</name>
    <description>Source-backed FibreFlow FNO Atlas coverage polygons. Returned features: ${rows.length}. Limit: ${meta.limit}.${meta.bbox ? ` BBOX: ${meta.bbox.join(',')}.` : ''}</description>${styles}${placemarks}
  </Document>
</kml>
`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const limit = requestedLimit(req.query.limit);
    const operatorSlug = requestedOperatorSlug(req.query.operatorSlug);
    const bbox = requestedBbox(req.query.bbox);
    const rows = await query<CoverageKmlRow>(
      `SELECT o.slug AS operator_slug,
        o.name AS operator_name,
        o.brand_color,
        ca.area_name,
        ca.rollout_status,
        ca.network_type,
        ca.confidence,
        ST_AsKML(ST_SimplifyPreserveTopology(ca.geom, 0.0005), 6) AS kml_geometry
       FROM fno_atlas_coverage_areas ca
       JOIN fno_atlas_operators o ON o.id = ca.operator_id
       WHERE ca.retired_at IS NULL
         AND ($1::text IS NULL OR o.slug = $1)
         AND ($2::double precision IS NULL OR ca.geom && ST_MakeEnvelope($2, $3, $4, $5, 4326))
       ORDER BY ST_Area(ca.geom::geography) DESC, o.name, ca.area_name NULLS LAST
       LIMIT $6`,
      [operatorSlug, bbox?.[0] ?? null, bbox?.[1] ?? null, bbox?.[2] ?? null, bbox?.[3] ?? null, limit],
    );

    const filename = `fno-atlas-coverage${operatorSlug ? `-${operatorSlug}` : ''}.kml`;
    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buildKml(rows, { operatorSlug, limit, bbox }));
  } catch (error) {
    log.error('Failed to export FNO Atlas coverage KML', { error }, 'FnoAtlasAPI');
    return apiResponse.internalError(res, error);
  }
}
