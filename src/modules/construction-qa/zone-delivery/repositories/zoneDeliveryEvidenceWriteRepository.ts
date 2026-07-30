import type { PoolClient } from 'pg';
import type {
  DeliveryActor,
  PonMilestone,
  RegisterDocumentInput,
  ZoneKey,
} from '../types/zoneDelivery.types';
import type { DocumentRow } from './zoneDeliveryReadRepository';

export interface ActivityWrite {
  key: ZoneKey;
  ponStageId?: string;
  entityType: 'zone' | 'pon' | 'document' | 'snag';
  entityId: string;
  action: string;
  effectiveAt: string | Date;
  actor: DeliveryActor;
  source: string;
  reason?: string;
  previousValue: unknown;
  newValue: unknown;
}

export async function supersedeActiveDocument(
  client: PoolClient,
  input: RegisterDocumentInput,
  actorId: string,
): Promise<DocumentRow | null> {
  const { rows } = await client.query<DocumentRow>(`
    UPDATE zone_delivery_documents
    SET superseded_at = NOW(), superseded_by = $4
    WHERE project_id = $1 AND zone_no = $2 AND document_type = $5
      AND (($5 = 'test_pack' AND pon_stage_id = $3)
        OR ($5 IN ('fac', 'cac') AND pon_stage_id IS NULL))
      AND superseded_at IS NULL
    RETURNING *
  `, [input.projectId, input.zoneNo, input.ponStageId ?? null, actorId, input.documentType]);
  return rows[0] ?? null;
}

export async function insertDocument(
  client: PoolClient,
  input: RegisterDocumentInput,
  actorId: string,
): Promise<DocumentRow> {
  const { rows } = await client.query<DocumentRow>(`
    INSERT INTO zone_delivery_documents (
      project_id, zone_no, pon_stage_id, document_type, document_source,
      source_ref, filename, mime_type, size_bytes, checksum_sha256, uploaded_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
  `, [
    input.projectId, input.zoneNo, input.ponStageId ?? null, input.documentType,
    input.documentSource, input.sourceRef, input.filename, input.mimeType,
    input.sizeBytes, input.checksumSha256, actorId,
  ]);
  return rows[0]!;
}

export async function linkSnag(
  client: PoolClient,
  key: ZoneKey,
  snagId: string,
  actorId: string,
  options: {
    ponStageId?: string;
    affectedGate?: PonMilestone;
    qaDiscipline?: 'civil' | 'optical';
    blocking: boolean;
    reconfirmation: boolean;
  },
): Promise<void> {
  await client.query(`
    INSERT INTO zone_delivery_snag_links (
      project_id, zone_no, snag_id, pon_stage_id, affected_gate,
      qa_discipline, handover_blocking, requires_reconfirmation, linked_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (snag_id, project_id, zone_no) DO UPDATE SET
      pon_stage_id = COALESCE(zone_delivery_snag_links.pon_stage_id, EXCLUDED.pon_stage_id),
      affected_gate = COALESCE(zone_delivery_snag_links.affected_gate, EXCLUDED.affected_gate),
      qa_discipline = COALESCE(zone_delivery_snag_links.qa_discipline, EXCLUDED.qa_discipline),
      handover_blocking = CASE WHEN NOT EXCLUDED.handover_blocking AND NOT EXCLUDED.requires_reconfirmation
        THEN FALSE ELSE zone_delivery_snag_links.handover_blocking OR EXCLUDED.handover_blocking END,
      requires_reconfirmation = CASE WHEN NOT EXCLUDED.handover_blocking AND NOT EXCLUDED.requires_reconfirmation
        THEN FALSE ELSE zone_delivery_snag_links.requires_reconfirmation OR EXCLUDED.requires_reconfirmation END
  `, [
    key.projectId, key.zoneNo, snagId, options.ponStageId ?? null,
    options.affectedGate ?? null, options.qaDiscipline ?? null,
    options.blocking, options.reconfirmation, actorId,
  ]);
}

export async function markGateReconfirmed(
  client: PoolClient,
  ponStageId: string,
  gate: PonMilestone,
  actorId: string,
): Promise<void> {
  await client.query(`
    UPDATE zone_delivery_snag_links
    SET requires_reconfirmation = FALSE, reconfirmed_at = NOW(), reconfirmed_by = $3
    WHERE pon_stage_id = $1 AND affected_gate = $2 AND requires_reconfirmation
  `, [ponStageId, gate, actorId]);
}

export async function appendActivity(
  client: PoolClient,
  activity: ActivityWrite,
): Promise<void> {
  await client.query(`
    INSERT INTO zone_delivery_activity (
      project_id, zone_no, pon_stage_id, entity_type, entity_id, action,
      effective_at, actor_user_id, actor_email, permission, source, reason,
      previous_value, new_value
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    activity.key.projectId, activity.key.zoneNo, activity.ponStageId ?? null,
    activity.entityType, activity.entityId, activity.action, activity.effectiveAt,
    activity.actor.userId, activity.actor.email, activity.actor.permission,
    activity.source, activity.reason?.trim() || null,
    JSON.stringify(activity.previousValue), JSON.stringify(activity.newValue),
  ]);
}
