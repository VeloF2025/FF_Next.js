import type { PoolClient } from 'pg';
import type {
  ZoneDeliveryActivity,
  ZoneKey,
} from '../types/zoneDelivery.types';

type Timestamp = Date | string | null;

export interface ZoneStateRow {
  id: string;
  project_id: string;
  zone_no: number;
  scope_approved_at: Timestamp;
  scope_approved_by: string | null;
  eligible_for_zone_qa_at: Timestamp;
  civil_qa_status: string;
  civil_qa_notes: string;
  civil_qa_effective_at: Timestamp;
  civil_qa_approved_by: string | null;
  optical_qa_status: string;
  optical_qa_notes: string;
  optical_qa_effective_at: Timestamp;
  optical_qa_approved_by: string | null;
  handed_over_at: Timestamp;
  handover_snapshot: unknown;
  row_version: number;
}

export interface PonStateRow {
  pon_stage_id: string;
  pon_no: number;
  scope_status: 'included' | 'excluded' | 'cancelled';
  scope_reason: string | null;
  civil_qa_approved: boolean;
  optical_qa_approved: boolean;
  civil_complete_at: Timestamp;
  civil_confirmed_by: string | null;
  optical_complete_at: Timestamp;
  optical_confirmed_by: string | null;
  testing_passed_at: Timestamp;
  testing_confirmed_by: string | null;
  testing_test_pack_document_id: string | null;
  port_submitted_at: Timestamp;
  port_submitted_by: string | null;
  port_approved_at: Timestamp;
  port_approved_by: string | null;
  technically_live_at: Timestamp;
  technically_live_by: string | null;
  row_version: number;
}

export interface DocumentRow {
  id: string;
  pon_stage_id: string | null;
  document_type: 'test_pack' | 'fac' | 'cac';
  document_source: 'vf_storage' | 'exfo_result';
  source_ref: string;
  filename: string;
  mime_type: string;
  size_bytes: string;
  checksum_sha256: string;
  uploaded_by: string;
  uploaded_at: Timestamp;
  superseded_at: Timestamp;
}

export interface SnagLinkRow {
  snag_id: string;
  pon_stage_id: string | null;
  affected_gate: string | null;
  handover_blocking: boolean;
  requires_reconfirmation: boolean;
  reconfirmed_at: Timestamp;
  status: string;
}

export interface ActivityRow {
  id: string;
  action: string;
  effective_at: Timestamp;
  recorded_at: Timestamp;
  actor_user_id: string;
  actor_email: string;
  permission: string;
  source: string;
  reason: string | null;
  previous_value: unknown;
  new_value: unknown;
  pon_stage_id: string | null;
}

export interface ZoneAggregate {
  key: ZoneKey;
  projectName: string;
  zone: ZoneStateRow | null;
  pons: PonStateRow[];
  documents: DocumentRow[];
  snagLinks: SnagLinkRow[];
  activities: ActivityRow[];
}

const iso = (value: Timestamp): string =>
  (value instanceof Date ? value : new Date(value!)).toISOString();

export async function readZoneAggregate(
  client: PoolClient,
  key: ZoneKey,
  lockSnags = false,
): Promise<ZoneAggregate> {
  const [project, zone, pons, documents, snagLinks, activities] = await Promise.all([
    client.query<{ project_name: string }>(
      `SELECT project_name FROM projects WHERE id = $1`,
      [key.projectId],
    ),
    client.query<ZoneStateRow>(
      `SELECT * FROM zone_delivery_state WHERE project_id = $1 AND zone_no = $2`,
      [key.projectId, key.zoneNo],
    ),
    client.query<PonStateRow>(`
      SELECT p.id AS pon_stage_id, p.pon_no,
        COALESCE(s.scope_status, 'included') AS scope_status, s.scope_reason,
        EXISTS (
          SELECT 1 FROM construction_qa_reviews q
          WHERE q.project_id = p.project_id AND q.zone_no = p.zone_no
            AND q.pon_no = p.pon_no AND q.discipline = 'civil'
        ) AND NOT EXISTS (
          SELECT 1 FROM construction_qa_reviews q
          WHERE q.project_id = p.project_id AND q.zone_no = p.zone_no
            AND q.pon_no = p.pon_no AND q.discipline = 'civil'
            AND q.workflow_status <> 'approved'
        ) AS civil_qa_approved,
        EXISTS (
          SELECT 1 FROM construction_qa_reviews q
          WHERE q.project_id = p.project_id AND q.zone_no = p.zone_no
            AND q.pon_no = p.pon_no AND q.discipline = 'optical'
        ) AND NOT EXISTS (
          SELECT 1 FROM construction_qa_reviews q
          WHERE q.project_id = p.project_id AND q.zone_no = p.zone_no
            AND q.pon_no = p.pon_no AND q.discipline = 'optical'
            AND q.workflow_status <> 'approved'
        ) AS optical_qa_approved,
        s.civil_complete_at, s.civil_confirmed_by,
        s.optical_complete_at, s.optical_confirmed_by,
        s.testing_passed_at, s.testing_confirmed_by,
        s.testing_test_pack_document_id,
        s.port_submitted_at, s.port_submitted_by,
        s.port_approved_at, s.port_approved_by,
        s.technically_live_at, s.technically_live_by,
        COALESCE(s.row_version, 0) AS row_version
      FROM pon_stage_tracking p
      LEFT JOIN pon_delivery_state s ON s.pon_stage_id = p.id
      WHERE p.project_id = $1 AND p.zone_no = $2
      ORDER BY p.pon_no
    `, [key.projectId, key.zoneNo]),
    client.query<DocumentRow>(`
      SELECT * FROM zone_delivery_documents
      WHERE project_id = $1 AND zone_no = $2
      ORDER BY uploaded_at, id
    `, [key.projectId, key.zoneNo]),
    client.query<SnagLinkRow>(`
      SELECT l.snag_id, l.pon_stage_id, l.affected_gate,
        l.handover_blocking, l.requires_reconfirmation, l.reconfirmed_at, s.status
      FROM zone_delivery_snag_links l
      JOIN snags s ON s.id = l.snag_id
      WHERE l.project_id = $1 AND l.zone_no = $2
      ORDER BY l.linked_at, l.snag_id
      ${lockSnags ? 'FOR UPDATE OF s' : ''}
    `, [key.projectId, key.zoneNo]),
    client.query<ActivityRow>(`
      SELECT * FROM zone_delivery_activity
      WHERE project_id = $1 AND zone_no = $2
      ORDER BY recorded_at, (action = 'zone_handed_over'), id
    `, [key.projectId, key.zoneNo]),
  ]);
  if (!project.rows[0]) {
    throw new Error(`Project ${key.projectId} does not exist`);
  }
  return {
    key,
    projectName: project.rows[0].project_name,
    zone: zone.rows[0] ?? null,
    pons: pons.rows,
    documents: documents.rows,
    snagLinks: snagLinks.rows,
    activities: activities.rows,
  };
}

export async function listZoneKeys(
  client: PoolClient,
  projectId?: string,
  zoneNo?: number,
): Promise<ZoneKey[]> {
  const { rows } = await client.query<{ project_id: string; zone_no: number }>(`
    SELECT DISTINCT project_id, zone_no FROM pon_stage_tracking
    WHERE ($1::uuid IS NULL OR project_id = $1)
      AND ($2::integer IS NULL OR zone_no = $2)
    ORDER BY project_id, zone_no
  `, [projectId ?? null, zoneNo ?? null]);
  return rows.map(row => ({ projectId: row.project_id, zoneNo: row.zone_no }));
}

export async function readActivity(
  client: PoolClient,
  key: ZoneKey,
): Promise<ZoneDeliveryActivity[]> {
  const { rows } = await client.query<ActivityRow>(`
    SELECT * FROM zone_delivery_activity
    WHERE project_id = $1 AND zone_no = $2
    ORDER BY recorded_at, (action = 'zone_handed_over'), id
  `, [key.projectId, key.zoneNo]);
  return rows.map(row => ({
    id: row.id,
    action: row.action,
    effectiveAt: iso(row.effective_at),
    recordedAt: iso(row.recorded_at),
    actorEmail: row.actor_email,
    permission: row.permission,
    source: row.source,
    reason: row.reason,
    previousValue: row.previous_value,
    newValue: row.new_value,
  }));
}

export async function readTransactionTime(client: PoolClient): Promise<Date> {
  const { rows } = await client.query<{ now: Date }>(
    `SELECT transaction_timestamp() AS now`,
  );
  return rows[0]!.now;
}

export async function constructionQaIsApproved(
  client: PoolClient,
  key: ZoneKey,
  ponNo: number,
  discipline: 'civil' | 'optical',
): Promise<boolean> {
  const { rows } = await client.query<{ workflow_status: string }>(`
    SELECT workflow_status
    FROM construction_qa_reviews
    WHERE project_id = $1 AND zone_no = $2 AND pon_no = $3
      AND discipline = $4
    ORDER BY id FOR UPDATE
  `, [key.projectId, key.zoneNo, ponNo, discipline]);
  return rows.length > 0 && rows.every(row => row.workflow_status === 'approved');
}

export async function readSnag(
  client: PoolClient,
  projectId: string,
  snagId: string,
): Promise<{ id: string; status: string } | null> {
  const { rows } = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM snags WHERE id = $1 AND project_id = $2`,
    [snagId, projectId],
  );
  return rows[0] ?? null;
}

export async function listSnagZoneKeys(
  client: PoolClient,
  snagId: string,
): Promise<ZoneKey[]> {
  const { rows } = await client.query<{ project_id: string; zone_no: number }>(`
    SELECT project_id, zone_no FROM zone_delivery_snag_links
    WHERE snag_id = $1 ORDER BY project_id, zone_no
  `, [snagId]);
  return rows.map(row => ({ projectId: row.project_id, zoneNo: row.zone_no }));
}
