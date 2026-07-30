import { qfcQuery } from '../../../lib/qfieldcloud/qfcPool';
import type { LastStatus } from '@/modules/qfield-recon/types';

export interface QFieldDelta {
  id: string;
  featureKey: string;
  label: string | null;
  status: string | null;
  lastStatus: LastStatus;
  createdAt: string;
  dropNumber: string | null;
  cableId: string | null;
  cableLengthM: number | null;
  installationStatus: string | null;
  qcStatus: string | null;
  photoKeys: string[];
}

export interface QFieldDeltaSnapshot {
  lastUpdatedAt: string | null;
  deltas: QFieldDelta[];
}

export interface QFieldDeltaRepository {
  load(projectId: string): Promise<QFieldDeltaSnapshot>;
}

type DeltaRow = {
  id: string;
  feature_key: string | null;
  label: string | null;
  status: string | null;
  last_status: LastStatus;
  created_at: string;
  drop_number: string | null;
  cable_id: string | null;
  cable_length_m: string | number | null;
  installation_status: string | null;
  qc_status: string | null;
  photo_keys: string[];
};

function mapRow(row: DeltaRow): QFieldDelta | null {
  if (!row.feature_key) return null;
  const length = row.cable_length_m === null ? null : Number(row.cable_length_m);
  return {
    id: row.id,
    featureKey: row.feature_key,
    label: row.label,
    status: row.status?.trim() || null,
    lastStatus: row.last_status,
    createdAt: row.created_at,
    dropNumber: row.drop_number,
    cableId: row.cable_id,
    cableLengthM: Number.isFinite(length) ? length : null,
    installationStatus: row.installation_status?.trim() || null,
    qcStatus: row.qc_status?.trim() || null,
    photoKeys: row.photo_keys ?? [],
  };
}

export const qfieldDeltaRepo: QFieldDeltaRepository = {
  async load(projectId) {
    const [projectRows, deltaRows] = await Promise.all([
      qfcQuery<{ updated_at: string | null }>(
        `SELECT to_char(data_last_updated_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
           FROM core_project WHERE id = $1::uuid`,
        [projectId],
      ),
      qfcQuery<DeltaRow>(
        `SELECT
           d.id::text AS id,
           d.content->>'localPk' AS feature_key,
           COALESCE(d.content->'new'->'attributes'->>'label',
                    d.content->'old'->'attributes'->>'label') AS label,
           NULLIF(BTRIM(COALESCE(
             d.content->'new'->'attributes'->>'Status',
             d.content->'old'->'attributes'->>'Status'
           )), '') AS status,
           d.last_status,
           to_char(d.created_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           COALESCE(d.content->'new'->'attributes'->>'drop_number',
                    d.content->'old'->'attributes'->>'drop_number') AS drop_number,
           COALESCE(d.content->'new'->'attributes'->>'cable_id',
                    d.content->'new'->'attributes'->>'Cable_No',
                    d.content->'old'->'attributes'->>'cable_id',
                    d.content->'old'->'attributes'->>'Cable_No') AS cable_id,
           COALESCE(d.content->'new'->'attributes'->>'length',
                    d.content->'new'->'attributes'->>'Length',
                    d.content->'old'->'attributes'->>'length',
                    d.content->'old'->'attributes'->>'Length') AS cable_length_m,
           COALESCE(d.content->'new'->'attributes'->>'installation_status',
                    d.content->'new'->'attributes'->>'Installation Status',
                    d.content->'old'->'attributes'->>'installation_status',
                    d.content->'old'->'attributes'->>'Installation Status') AS installation_status,
           COALESCE(d.content->'new'->'attributes'->>'qc_status',
                    d.content->'new'->'attributes'->>'QC Status',
                    d.content->'old'->'attributes'->>'qc_status',
                    d.content->'old'->'attributes'->>'QC Status') AS qc_status,
           COALESCE(ARRAY(
             SELECT jsonb_object_keys(
               COALESCE(d.content->'new'->'files_sha256', '{}'::jsonb)
             )
           ), '{}') AS photo_keys
         FROM core_delta d
         WHERE d.project_id = $1::uuid
         ORDER BY d.created_at, d.id`,
        [projectId],
      ),
    ]);

    return {
      lastUpdatedAt: projectRows[0]?.updated_at ?? null,
      deltas: deltaRows.map(mapRow).filter((row): row is QFieldDelta => row !== null),
    };
  },
};
