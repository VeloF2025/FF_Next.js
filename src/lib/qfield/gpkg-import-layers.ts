/**
 * GPKG Import — Point layer UNNEST bulk upsert functions (poles, joints, drops).
 * Re-exports spatial layers from gpkg-import-spatial.ts for a single import point.
 *
 * Pattern mirrors pages/api/sow/drops.ts UNNEST approach:
 *   - Batch 1000 features per query
 *   - ON CONFLICT for merge, DELETE+INSERT for replace
 */

import { log } from '@/lib/logger';

export { importCableSpans, importZoneBoundaries, importPonBoundaries, importPops } from './gpkg-import-spatial';

const BATCH_SIZE = 1000;

/** Deduplicate features by key field — keeps last occurrence (latest wins) */
function dedup(features: any[], keyField: string): any[] {
  const map = new Map<string, any>();
  for (const f of features) {
    const key = String(f[keyField]);
    map.set(key, f);
  }
  return Array.from(map.values());
}

/** Safely parse a value to integer — handles comma-separated strings like "67,80,81" */
function safeInt(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).split(',')[0].trim();
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlFn = (strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>;

// ---------------------------------------------------------------------------
// Poles
// ---------------------------------------------------------------------------
export async function importPoles(sql: SqlFn, features: any[], projectId: string, mode: ImportMode): Promise<LayerResult> {
  if (mode === 'replace') {
    await sql`DELETE FROM poles WHERE project_id = ${projectId}::uuid AND source IN ('qfield', 'sow+qfield')`;
  }

  // Filter out features with null/empty pole_number (required field)
  const validFeatures = dedup(features.filter(f => f.pole_number), 'pole_number');

  let created = 0;
  let updated = 0;

  for (let i = 0; i < validFeatures.length; i += BATCH_SIZE) {
    const batch = validFeatures.slice(i, i + BATCH_SIZE);

    const projectIds     = batch.map(() => projectId);
    const poleNumbers    = batch.map(f => f.pole_number);
    const types          = batch.map(f => f.type || null);
    const latitudes      = batch.map(f => f.latitude != null ? Number(f.latitude) : null);
    const longitudes     = batch.map(f => f.longitude != null ? Number(f.longitude) : null);
    const domeJoints     = batch.map(f => f.dome_joint || null);
    const typeOfJoins    = batch.map(f => f.type_of_join || null);
    const splitters      = batch.map(f => f.splitter || null);
    const slacks         = batch.map(f => f.slack_on_pole || null);
    const fieldAgents    = batch.map(f => f.field_agent || null);
    const polePlanteds   = batch.map(f => f.pole_planted || null);
    const auditDates     = batch.map(f => f.audit_complete || null);
    const zoneNos        = batch.map(f => safeInt(f.zone_no));
    const ponNos         = batch.map(f => safeInt(f.pon_no));
    const sources        = batch.map(() => 'qfield');

    if (mode === 'merge') {
      const rows = await sql`
        INSERT INTO poles (project_id, pole_number, pole_type, latitude, longitude, dome_joint, type_of_join, splitter, slack_on_pole, field_agent, pole_planted, audit_complete, zone_no, pon_no, source)
        SELECT * FROM UNNEST(
          ${projectIds}::uuid[], ${poleNumbers}::varchar[], ${types}::varchar[],
          ${latitudes}::numeric[], ${longitudes}::numeric[],
          ${domeJoints}::varchar[], ${typeOfJoins}::varchar[], ${splitters}::varchar[],
          ${slacks}::varchar[], ${fieldAgents}::varchar[], ${polePlanteds}::varchar[],
          ${auditDates}::date[], ${zoneNos}::integer[], ${ponNos}::integer[],
          ${sources}::varchar[]
        )
        ON CONFLICT (project_id, pole_number) DO UPDATE SET
          dome_joint     = COALESCE(poles.dome_joint, EXCLUDED.dome_joint),
          type_of_join   = COALESCE(poles.type_of_join, EXCLUDED.type_of_join),
          splitter       = COALESCE(poles.splitter, EXCLUDED.splitter),
          slack_on_pole  = COALESCE(poles.slack_on_pole, EXCLUDED.slack_on_pole),
          field_agent    = COALESCE(poles.field_agent, EXCLUDED.field_agent),
          pole_planted   = COALESCE(poles.pole_planted, EXCLUDED.pole_planted),
          audit_complete = COALESCE(poles.audit_complete, EXCLUDED.audit_complete),
          zone_no        = COALESCE(EXCLUDED.zone_no, poles.zone_no),
          pon_no         = COALESCE(EXCLUDED.pon_no, poles.pon_no),
          latitude       = COALESCE(EXCLUDED.latitude, poles.latitude),
          longitude      = COALESCE(EXCLUDED.longitude, poles.longitude),
          source         = CASE WHEN poles.source = 'sow' THEN 'sow+qfield' ELSE EXCLUDED.source END,
          updated_at     = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted
      `;
      for (const r of rows) {
        if (r.inserted) created++; else updated++;
      }
    } else {
      await sql`
        INSERT INTO poles (project_id, pole_number, pole_type, latitude, longitude, dome_joint, type_of_join, splitter, slack_on_pole, field_agent, pole_planted, audit_complete, zone_no, pon_no, source)
        SELECT * FROM UNNEST(
          ${projectIds}::uuid[], ${poleNumbers}::varchar[], ${types}::varchar[],
          ${latitudes}::numeric[], ${longitudes}::numeric[],
          ${domeJoints}::varchar[], ${typeOfJoins}::varchar[], ${splitters}::varchar[],
          ${slacks}::varchar[], ${fieldAgents}::varchar[], ${polePlanteds}::varchar[],
          ${auditDates}::date[], ${zoneNos}::integer[], ${ponNos}::integer[],
          ${sources}::varchar[]
        )
      `;
      created += batch.length;
    }
  }

  log.info('gpkg-import: poles done', { created, updated }, 'GpkgImportLayers');
  return { created, updated, errors: [] };
}

// ---------------------------------------------------------------------------
// Joints
// ---------------------------------------------------------------------------
export async function importJoints(sql: SqlFn, features: any[], projectId: string, mode: ImportMode): Promise<LayerResult> {
  if (mode === 'replace') {
    await sql`DELETE FROM joints WHERE project_id = ${projectId}::uuid`;
  }

  const validFeatures = dedup(features.filter(f => f.joint_label), 'joint_label');

  let created = 0;
  let updated = 0;

  for (let i = 0; i < validFeatures.length; i += BATCH_SIZE) {
    const batch = validFeatures.slice(i, i + BATCH_SIZE);

    const projectIds      = batch.map(() => projectId);
    const jointLabels     = batch.map(f => f.joint_label);
    const jointTypes      = batch.map(f => f.joint_type || null);
    const cableCapacities = batch.map(f => f.cable_capacity || null);
    const latitudes       = batch.map(f => f.latitude != null ? Number(f.latitude) : null);
    const longitudes      = batch.map(f => f.longitude != null ? Number(f.longitude) : null);
    const ponNos          = batch.map(f => safeInt(f.pon_no));
    const zoneNos         = batch.map(f => safeInt(f.zone_no));
    const sources         = batch.map(() => 'qfield');

    if (mode === 'merge') {
      const rows = await sql`
        INSERT INTO joints (project_id, joint_label, joint_type, cable_capacity, latitude, longitude, pon_no, zone_no, source)
        SELECT * FROM UNNEST(
          ${projectIds}::uuid[], ${jointLabels}::varchar[], ${jointTypes}::varchar[],
          ${cableCapacities}::varchar[], ${latitudes}::numeric[], ${longitudes}::numeric[],
          ${ponNos}::integer[], ${zoneNos}::integer[], ${sources}::varchar[]
        )
        ON CONFLICT (project_id, joint_label) DO UPDATE SET
          joint_type      = COALESCE(EXCLUDED.joint_type, joints.joint_type),
          cable_capacity  = COALESCE(EXCLUDED.cable_capacity, joints.cable_capacity),
          latitude        = COALESCE(EXCLUDED.latitude, joints.latitude),
          longitude       = COALESCE(EXCLUDED.longitude, joints.longitude),
          pon_no          = COALESCE(EXCLUDED.pon_no, joints.pon_no),
          zone_no         = COALESCE(EXCLUDED.zone_no, joints.zone_no),
          updated_at      = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted
      `;
      for (const r of rows) {
        if (r.inserted) created++; else updated++;
      }
    } else {
      await sql`
        INSERT INTO joints (project_id, joint_label, joint_type, cable_capacity, latitude, longitude, pon_no, zone_no, source)
        SELECT * FROM UNNEST(
          ${projectIds}::uuid[], ${jointLabels}::varchar[], ${jointTypes}::varchar[],
          ${cableCapacities}::varchar[], ${latitudes}::numeric[], ${longitudes}::numeric[],
          ${ponNos}::integer[], ${zoneNos}::integer[], ${sources}::varchar[]
        )
      `;
      created += batch.length;
    }
  }

  log.info('gpkg-import: joints done', { created, updated }, 'GpkgImportLayers');
  return { created, updated, errors: [] };
}

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------
export async function importDrops(sql: SqlFn, features: any[], projectId: string, mode: ImportMode): Promise<LayerResult> {
  if (mode === 'replace') {
    await sql`DELETE FROM drops WHERE project_id = ${projectId}::uuid AND source IN ('qfield', 'sow+qfield')`;
  }

  const validFeatures = dedup(features.filter(f => f.drop_number), 'drop_number');

  let created = 0;
  let updated = 0;

  for (let i = 0; i < validFeatures.length; i += BATCH_SIZE) {
    const batch = validFeatures.slice(i, i + BATCH_SIZE);

    const projectIds      = batch.map(() => projectId);
    const dropNumbers     = batch.map(f => f.drop_number);
    const poleNumbers     = batch.map(f => f.pole_number || null);
    const cableCapacities = batch.map(f => f.cable_capacity || null);
    const ponNos          = batch.map(f => safeInt(f.pon_no));
    const zoneNos         = batch.map(f => safeInt(f.zone_no));
    const latitudes       = batch.map(f => f.latitude != null ? Number(f.latitude) : null);
    const longitudes      = batch.map(f => f.longitude != null ? Number(f.longitude) : null);
    const sources         = batch.map(() => 'qfield');

    if (mode === 'merge') {
      const rows = await sql`
        INSERT INTO drops (project_id, drop_number, pole_number, cable_capacity, pon_no, zone_no, latitude, longitude, source)
        SELECT * FROM UNNEST(
          ${projectIds}::uuid[], ${dropNumbers}::varchar[], ${poleNumbers}::varchar[],
          ${cableCapacities}::varchar[], ${ponNos}::integer[], ${zoneNos}::integer[],
          ${latitudes}::numeric[], ${longitudes}::numeric[], ${sources}::varchar[]
        )
        ON CONFLICT (project_id, drop_number) DO UPDATE SET
          pole_number    = COALESCE(drops.pole_number, EXCLUDED.pole_number),
          cable_capacity = COALESCE(drops.cable_capacity, EXCLUDED.cable_capacity),
          pon_no         = COALESCE(EXCLUDED.pon_no, drops.pon_no),
          zone_no        = COALESCE(EXCLUDED.zone_no, drops.zone_no),
          latitude       = COALESCE(EXCLUDED.latitude, drops.latitude),
          longitude      = COALESCE(EXCLUDED.longitude, drops.longitude),
          source         = CASE WHEN drops.source = 'sow' THEN 'sow+qfield' ELSE EXCLUDED.source END,
          updated_at     = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted
      `;
      for (const r of rows) {
        if (r.inserted) created++; else updated++;
      }
    } else {
      await sql`
        INSERT INTO drops (project_id, drop_number, pole_number, cable_capacity, pon_no, zone_no, latitude, longitude, source)
        SELECT * FROM UNNEST(
          ${projectIds}::uuid[], ${dropNumbers}::varchar[], ${poleNumbers}::varchar[],
          ${cableCapacities}::varchar[], ${ponNos}::integer[], ${zoneNos}::integer[],
          ${latitudes}::numeric[], ${longitudes}::numeric[], ${sources}::varchar[]
        )
      `;
      created += batch.length;
    }
  }

  log.info('gpkg-import: drops done', { created, updated }, 'GpkgImportLayers');
  return { created, updated, errors: [] };
}
