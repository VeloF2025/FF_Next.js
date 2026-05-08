/**
 * GPKG Import — Spatial layer UNNEST bulk upsert functions.
 * Handles cable_spans, zone_boundaries, pon_boundaries, and pops.
 * Imported by gpkg-import-layers.ts and re-exported.
 */

import { log } from '@/lib/logger';

const BATCH_SIZE = 1000;

type GpkgFeature = Record<string, unknown>;

/** Deduplicate features by key field — keeps last occurrence (latest wins) */
function dedup(features: GpkgFeature[], keyField: string): GpkgFeature[] {
  const map = new Map<string, GpkgFeature>();
  for (const f of features) {
    const key = String(f[keyField]);
    map.set(key, f);
  }
  return Array.from(map.values());
}

/** Safely parse a value to integer — handles comma-separated strings like "67,80,81" */
function safeInt(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).split(',')[0]!.trim();
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export interface LayerResult {
  created: number;
  updated: number;
  errors: string[];
}

type ImportMode = 'merge' | 'replace';

/** Accept any neon sql tagged-template function */
type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

/** Tagged-template sql extended with a parameterised query method (db-pool compatible) */
type SqlFnWithQuery = SqlFn & {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<T[]>;
};

// ---------------------------------------------------------------------------
// Pure SQL builders — testable without a live DB
// ---------------------------------------------------------------------------

/**
 * Builds the INSERT SQL for zone_boundaries that writes both the geojson
 * JSONB column and the derived PostGIS geom column.
 *
 * Parameters: $1::uuid[], $2::integer[], $3::jsonb[]
 *   (project_ids, zone_nos, geojsons)
 */
export function buildZoneBoundariesInsertSql(mode: ImportMode): string {
  const onConflict =
    mode === 'merge'
      ? `ON CONFLICT (project_id, zone_no) DO UPDATE SET
           geojson = EXCLUDED.geojson,
           geom    = EXCLUDED.geom`
      : '';
  return `
    INSERT INTO zone_boundaries (project_id, zone_no, geojson, geom)
    SELECT
      project_id,
      zone_no,
      geojson,
      ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geojson::text), 4326)))
    FROM UNNEST($1::uuid[], $2::integer[], $3::jsonb[])
      AS t(project_id, zone_no, geojson)
    ${onConflict}
  `;
}

/**
 * Builds the INSERT SQL for pon_boundaries that writes both the geojson
 * JSONB column and the derived PostGIS geom column.
 *
 * Parameters: $1::uuid[], $2::integer[], $3::integer[], $4::varchar[], $5::jsonb[]
 *   (project_ids, pon_nos, zone_nos, pon_labels, geojsons)
 */
export function buildPonBoundariesInsertSql(mode: ImportMode): string {
  const onConflict =
    mode === 'merge'
      ? `ON CONFLICT (project_id, pon_no) DO UPDATE SET
           zone_no   = COALESCE(EXCLUDED.zone_no, pon_boundaries.zone_no),
           pon_label = COALESCE(EXCLUDED.pon_label, pon_boundaries.pon_label),
           geojson   = EXCLUDED.geojson,
           geom      = EXCLUDED.geom`
      : '';
  return `
    INSERT INTO pon_boundaries (project_id, pon_no, zone_no, pon_label, geojson, geom)
    SELECT
      project_id,
      pon_no,
      zone_no,
      pon_label,
      geojson,
      ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geojson::text), 4326)))
    FROM UNNEST($1::uuid[], $2::integer[], $3::integer[], $4::varchar[], $5::jsonb[])
      AS t(project_id, pon_no, zone_no, pon_label, geojson)
    ${onConflict}
  `;
}

// ---------------------------------------------------------------------------
// Cable Spans
// ---------------------------------------------------------------------------
export async function importCableSpans(sql: SqlFn, features: GpkgFeature[], projectId: string, mode: ImportMode): Promise<LayerResult> {
  if (mode === 'replace') {
    await sql`DELETE FROM cable_spans WHERE project_id = ${projectId}::uuid`;
  }

  const validFeatures = dedup(features.filter(f => f.span_label), 'span_label');

  let created = 0;
  let updated = 0;

  for (let i = 0; i < validFeatures.length; i += BATCH_SIZE) {
    const batch = validFeatures.slice(i, i + BATCH_SIZE);

    const projectIds   = batch.map(() => projectId);
    const spanLabels   = batch.map(f => f.span_label);
    const cableSizes   = batch.map(f => f.cable_size || null);
    const spanTypes    = batch.map(f => f.span_type || null);
    const ponNos       = batch.map(f => safeInt(f.pon_no));
    const zoneNos      = batch.map(f => safeInt(f.zone_no));
    const lengths      = batch.map(f => f.length_meters != null ? Number(f.length_meters) : null);
    const geojsons     = batch.map(f => f.geojson ? JSON.stringify(f.geojson) : null);
    const sources      = batch.map(() => 'qfield');

    if (mode === 'merge') {
      const rows = await sql`
        INSERT INTO cable_spans (project_id, span_label, cable_size, span_type, pon_no, zone_no, length_meters, geojson, source)
        SELECT * FROM UNNEST(
          ${projectIds}::uuid[], ${spanLabels}::varchar[], ${cableSizes}::varchar[],
          ${spanTypes}::varchar[], ${ponNos}::integer[], ${zoneNos}::integer[],
          ${lengths}::numeric[], ${geojsons}::jsonb[], ${sources}::varchar[]
        )
        ON CONFLICT (project_id, span_label) DO UPDATE SET
          cable_size    = COALESCE(EXCLUDED.cable_size, cable_spans.cable_size),
          span_type     = COALESCE(EXCLUDED.span_type, cable_spans.span_type),
          pon_no        = COALESCE(EXCLUDED.pon_no, cable_spans.pon_no),
          zone_no       = COALESCE(EXCLUDED.zone_no, cable_spans.zone_no),
          length_meters = COALESCE(EXCLUDED.length_meters, cable_spans.length_meters),
          geojson       = COALESCE(EXCLUDED.geojson, cable_spans.geojson),
          updated_at    = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted
      `;
      for (const r of rows) {
        if (r.inserted) created++; else updated++;
      }
    } else {
      await sql`
        INSERT INTO cable_spans (project_id, span_label, cable_size, span_type, pon_no, zone_no, length_meters, geojson, source)
        SELECT * FROM UNNEST(
          ${projectIds}::uuid[], ${spanLabels}::varchar[], ${cableSizes}::varchar[],
          ${spanTypes}::varchar[], ${ponNos}::integer[], ${zoneNos}::integer[],
          ${lengths}::numeric[], ${geojsons}::jsonb[], ${sources}::varchar[]
        )
      `;
      created += batch.length;
    }
  }

  log.info('gpkg-import: cable_spans done', { created, updated }, 'GpkgImportSpatial');
  return { created, updated, errors: [] };
}

// ---------------------------------------------------------------------------
// Zone Boundaries
// ---------------------------------------------------------------------------
export async function importZoneBoundaries(sql: SqlFnWithQuery, features: GpkgFeature[], projectId: string, mode: ImportMode): Promise<LayerResult> {
  if (mode === 'replace') {
    await sql`DELETE FROM zone_boundaries WHERE project_id = ${projectId}::uuid`;
  }

  // Filter out features with null zone_no (required field) and deduplicate
  const validFeatures = dedup(features.filter(f => f.zone_no != null), 'zone_no');

  let created = 0;
  let updated = 0;

  for (let i = 0; i < validFeatures.length; i += BATCH_SIZE) {
    const batch = validFeatures.slice(i, i + BATCH_SIZE);

    const projectIds = batch.map(() => projectId);
    const zoneNos    = batch.map(f => safeInt(f.zone_no));
    const geojsons   = batch.map(f => JSON.stringify(f.geojson));

    if (mode === 'merge') {
      const insertSql = buildZoneBoundariesInsertSql('merge') + '\n    RETURNING (xmax = 0) AS inserted';
      const rows = await sql.query<{ inserted: boolean }>(insertSql, [projectIds, zoneNos, geojsons]);
      for (const r of rows) {
        if (r.inserted) created++; else updated++;
      }
    } else {
      const insertSql = buildZoneBoundariesInsertSql('replace');
      await sql.query(insertSql, [projectIds, zoneNos, geojsons]);
      created += batch.length;
    }
  }

  log.info('gpkg-import: zone_boundaries done', { created, updated }, 'GpkgImportSpatial');
  return { created, updated, errors: [] };
}

// ---------------------------------------------------------------------------
// PON Boundaries
// ---------------------------------------------------------------------------
export async function importPonBoundaries(sql: SqlFnWithQuery, features: GpkgFeature[], projectId: string, mode: ImportMode): Promise<LayerResult> {
  if (mode === 'replace') {
    await sql`DELETE FROM pon_boundaries WHERE project_id = ${projectId}::uuid`;
  }

  // Filter out features with null pon_no (required field) and deduplicate
  const validFeatures = dedup(features.filter(f => f.pon_no != null), 'pon_no');

  let created = 0;
  let updated = 0;

  for (let i = 0; i < validFeatures.length; i += BATCH_SIZE) {
    const batch = validFeatures.slice(i, i + BATCH_SIZE);

    const projectIds = batch.map(() => projectId);
    const ponNos     = batch.map(f => safeInt(f.pon_no));
    const zoneNos    = batch.map(f => safeInt(f.zone_no));
    const ponLabels  = batch.map(f => f.pon_label || null);
    const geojsons   = batch.map(f => JSON.stringify(f.geojson));

    if (mode === 'merge') {
      const insertSql = buildPonBoundariesInsertSql('merge') + '\n    RETURNING (xmax = 0) AS inserted';
      const rows = await sql.query<{ inserted: boolean }>(insertSql, [projectIds, ponNos, zoneNos, ponLabels, geojsons]);
      for (const r of rows) {
        if (r.inserted) created++; else updated++;
      }
    } else {
      const insertSql = buildPonBoundariesInsertSql('replace');
      await sql.query(insertSql, [projectIds, ponNos, zoneNos, ponLabels, geojsons]);
      created += batch.length;
    }
  }

  log.info('gpkg-import: pon_boundaries done', { created, updated }, 'GpkgImportSpatial');
  return { created, updated, errors: [] };
}

// ---------------------------------------------------------------------------
// POPs
// ---------------------------------------------------------------------------
export async function importPops(sql: SqlFn, features: GpkgFeature[], projectId: string, mode: ImportMode): Promise<LayerResult> {
  if (mode === 'replace') {
    await sql`DELETE FROM pops WHERE project_id = ${projectId}::uuid`;
  }

  let created = 0;
  let updated = 0;

  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    const batch = features.slice(i, i + BATCH_SIZE);

    const projectIds = batch.map(() => projectId);
    const popLabels  = batch.map(f => f.pop_label || null);
    const geojsons   = batch.map(f => JSON.stringify(f.geojson));

    if (mode === 'merge') {
      const rows = await sql`
        INSERT INTO pops (project_id, pop_label, geojson)
        SELECT * FROM UNNEST(${projectIds}::uuid[], ${popLabels}::varchar[], ${geojsons}::jsonb[])
        ON CONFLICT (project_id, pop_label) DO UPDATE SET
          geojson = EXCLUDED.geojson
        RETURNING (xmax = 0) AS inserted
      `;
      for (const r of rows) {
        if (r.inserted) created++; else updated++;
      }
    } else {
      await sql`
        INSERT INTO pops (project_id, pop_label, geojson)
        SELECT * FROM UNNEST(${projectIds}::uuid[], ${popLabels}::varchar[], ${geojsons}::jsonb[])
      `;
      created += batch.length;
    }
  }

  log.info('gpkg-import: pops done', { created, updated }, 'GpkgImportSpatial');
  return { created, updated, errors: [] };
}
