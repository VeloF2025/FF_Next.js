import { qfcQuery } from '@/lib/qfieldcloud/qfcPool';
import type { AuditDelta, LastStatus } from '../types';

export interface QfcProject { id: string; name: string; dataLastUpdatedAt: string | null; }

export async function getProjects(): Promise<QfcProject[]> {
  const rows = await qfcQuery<{ id: string; name: string; d: string | null }>(
    `SELECT id::text AS id, name,
            to_char(data_last_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS d
       FROM core_project ORDER BY name`);
  return rows.map(r => ({ id: r.id, name: r.name, dataLastUpdatedAt: r.d }));
}

type DeltaRow = {
  id: string; feature_key: string | null; label: string | null; status: string | null;
  last_status: string; pon_no: number | null; zone: string | null;
  created_at: string; photo_keys: string[];
};

/** Kind from the field Status value; null => not an optical/civil audit (skip). */
function kindOf(status: string | null): AuditDelta['kind'] | null {
  if (!status) return null;
  if (status === 'Optical Complete') return 'optical';
  if (status.startsWith('Pole ')) return 'civil';
  return null;
}

export async function getAuditDeltas(projectId: string): Promise<AuditDelta[]> {
  const rows = await qfcQuery<DeltaRow>(
    `SELECT
        d.id::text AS id,
        d.content->>'localPk' AS feature_key,
        COALESCE(d.content->'old'->'attributes'->>'label',
                 d.content->'new'->'attributes'->>'label') AS label,
        d.content->'new'->'attributes'->>'Status' AS status,
        d.last_status,
        NULLIF(d.content->'old'->'attributes'->>'pon_no','')::int AS pon_no,
        COALESCE(d.content->'old'->'attributes'->>'zone_no',
                 d.content->'old'->'attributes'->>'zone') AS zone,
        to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
        COALESCE(ARRAY(SELECT jsonb_object_keys(
                 COALESCE(d.content->'new'->'files_sha256','{}'::jsonb))), '{}') AS photo_keys
     FROM core_delta d
     WHERE d.project_id = $1::uuid
       AND d.content->'new'->'attributes'->>'Status' IS NOT NULL`,
    [projectId]);

  const out: AuditDelta[] = [];
  for (const r of rows) {
    const kind = kindOf(r.status);
    if (!kind || !r.feature_key) continue;
    out.push({
      id: r.id, featureKey: r.feature_key, label: r.label, kind,
      status: r.status as string, lastStatus: r.last_status as LastStatus,
      ponNo: r.pon_no, zone: r.zone, createdAt: r.created_at, photoKeys: r.photo_keys,
    });
  }
  return out;
}

/** Latest MOAPons+MOAPoles version key, or null if the project has no design layer. */
export async function getDesignGpkgVersion(projectId: string): Promise<string | null> {
  const rows = await qfcQuery<{ name: string; v: string }>(
    `SELECT f.name,
            to_char(max(fv.created_at),'YYYYMMDDHH24MISS') AS v
       FROM filestorage_file f
       JOIN filestorage_fileversion fv ON fv.file_id = f.id
      WHERE f.project_id = $1::uuid
        AND (f.name ILIKE '%MOAPons.gpkg' OR f.name ILIKE '%MOAPoles.gpkg')
      GROUP BY f.name`,
    [projectId]);
  const pons = rows.find(r => r.name.toLowerCase().endsWith('moapons.gpkg'));
  const poles = rows.find(r => r.name.toLowerCase().endsWith('moapoles.gpkg'));
  if (!pons || !poles) return null;
  return `MOAPons:${pons.v}|MOAPoles:${poles.v}`;
}
