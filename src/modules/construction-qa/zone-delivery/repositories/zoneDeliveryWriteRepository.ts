import type { PoolClient } from 'pg';
import type {
  PonMilestone,
  ScopeStatus,
  ZoneKey,
  ZoneQaDiscipline,
  ZoneQaStatus,
} from '../types/zoneDelivery.types';
import type { PonStateRow, ZoneStateRow } from './zoneDeliveryReadRepository';

export {
  appendActivity,
  insertDocument,
  linkSnag,
  markGateReconfirmed,
  supersedeActiveDocument,
} from './zoneDeliveryEvidenceWriteRepository';
const milestoneColumns: Record<PonMilestone, { at: string; by: string }> = {
  civil_complete: { at: 'civil_complete_at', by: 'civil_confirmed_by' },
  optical_complete: { at: 'optical_complete_at', by: 'optical_confirmed_by' },
  testing_passed: { at: 'testing_passed_at', by: 'testing_confirmed_by' },
  port_submitted: { at: 'port_submitted_at', by: 'port_submitted_by' },
  port_approved: { at: 'port_approved_at', by: 'port_approved_by' },
  technically_live: { at: 'technically_live_at', by: 'technically_live_by' },
};
const milestoneOrder = Object.keys(milestoneColumns) as PonMilestone[];
export async function lockZone(client: PoolClient, key: ZoneKey): Promise<ZoneStateRow | null> {
  const { rows } = await client.query<ZoneStateRow>(`
    SELECT * FROM zone_delivery_state
    WHERE project_id = $1 AND zone_no = $2 FOR UPDATE
  `, [key.projectId, key.zoneNo]);
  return rows[0] ?? null;
}
export async function lockPon(client: PoolClient, ponStageId: string): Promise<PonStateRow | null> {
  const { rows } = await client.query<PonStateRow>(`
    SELECT s.*, p.pon_no FROM pon_delivery_state s
    JOIN pon_stage_tracking p ON p.id = s.pon_stage_id
    WHERE s.pon_stage_id = $1 FOR UPDATE OF s
  `, [ponStageId]);
  return rows[0] ?? null;
}
export async function insertZone(client: PoolClient, key: ZoneKey): Promise<ZoneStateRow | null> {
  const { rows } = await client.query<ZoneStateRow>(`
    INSERT INTO zone_delivery_state (project_id, zone_no)
    VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *
  `, [key.projectId, key.zoneNo]);
  return rows[0] ?? null;
}
export async function writeScopeApproval(
  client: PoolClient,
  key: ZoneKey,
  expected: number,
  effectiveAt: string,
  actorId: string,
): Promise<ZoneStateRow | null> {
  if (expected === 0) {
    const { rows } = await client.query<ZoneStateRow>(`
      INSERT INTO zone_delivery_state (
        project_id, zone_no, scope_approved_at, scope_approved_by
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING RETURNING *
    `, [key.projectId, key.zoneNo, effectiveAt, actorId]);
    return rows[0] ?? null;
  }
  const { rows } = await client.query<ZoneStateRow>(`
    UPDATE zone_delivery_state
    SET scope_approved_at = $3, scope_approved_by = $4,
      row_version = row_version + 1, updated_at = NOW()
    WHERE project_id = $1 AND zone_no = $2 AND row_version = $5
    RETURNING *
  `, [key.projectId, key.zoneNo, effectiveAt, actorId, expected]);
  return rows[0] ?? null;
}
export async function writePonScope(
  client: PoolClient,
  ponStageId: string,
  status: ScopeStatus,
  reason?: string,
): Promise<PonStateRow> {
  const { rows } = await client.query<PonStateRow>(`
    INSERT INTO pon_delivery_state (pon_stage_id, scope_status, scope_reason)
    VALUES ($1, $2, $3)
    ON CONFLICT (pon_stage_id) DO UPDATE SET
      scope_status = EXCLUDED.scope_status,
      scope_reason = EXCLUDED.scope_reason,
      row_version = pon_delivery_state.row_version + 1,
      updated_at = NOW()
    RETURNING *
  `, [ponStageId, status, reason?.trim() || null]);
  return rows[0]!;
}
export async function confirmMilestone(
  client: PoolClient,
  ponStageId: string,
  milestone: PonMilestone,
  expected: number,
  effectiveAt: string,
  actorId: string,
  testPackId?: string,
): Promise<PonStateRow | null> {
  const columns = milestoneColumns[milestone];
  const testing = milestone === 'testing_passed'
    ? `, testing_test_pack_document_id = $5`
    : '';
  const values = milestone === 'testing_passed'
    ? [ponStageId, effectiveAt, actorId, expected, testPackId ?? null]
    : [ponStageId, effectiveAt, actorId, expected];
  const { rows } = await client.query<PonStateRow>(`
    UPDATE pon_delivery_state
    SET ${columns.at} = $2, ${columns.by} = $3 ${testing},
      row_version = row_version + 1, updated_at = NOW()
    WHERE pon_stage_id = $1 AND row_version = $4
    RETURNING *
  `, values);
  return rows[0] ?? null;
}
export async function reopenMilestone(
  client: PoolClient,
  ponStageId: string,
  milestone: PonMilestone,
  expected: number,
): Promise<PonStateRow | null> {
  const cleared = milestoneOrder.slice(milestoneOrder.indexOf(milestone));
  const assignments = cleared.flatMap(gate => {
    const columns = milestoneColumns[gate];
    return [`${columns.at} = NULL`, `${columns.by} = NULL`];
  });
  if (cleared.includes('testing_passed')) {
    assignments.push('testing_test_pack_document_id = NULL');
  }
  const { rows } = await client.query<PonStateRow>(`
    UPDATE pon_delivery_state SET ${assignments.join(', ')},
      row_version = row_version + 1, updated_at = NOW()
    WHERE pon_stage_id = $1 AND row_version = $2 RETURNING *
  `, [ponStageId, expected]);
  return rows[0] ?? null;
}
export async function touchPon(
  client: PoolClient, ponStageId: string, expected: number,
): Promise<PonStateRow | null> {
  const { rows } = await client.query<PonStateRow>(`
    UPDATE pon_delivery_state
    SET row_version = row_version + 1, updated_at = NOW()
    WHERE pon_stage_id = $1 AND row_version = $2 RETURNING *
  `, [ponStageId, expected]);
  return rows[0] ?? null;
}
export async function writeZoneQa(
  client: PoolClient,
  key: ZoneKey,
  discipline: ZoneQaDiscipline,
  status: Exclude<ZoneQaStatus, 'not_started'>,
  notes: string,
  effectiveAt: string,
  actorId: string,
  expected: number,
): Promise<ZoneStateRow | null> {
  const prefix = discipline === 'civil' ? 'civil' : 'optical';
  const { rows } = await client.query<ZoneStateRow>(`
    UPDATE zone_delivery_state SET
      ${prefix}_qa_status = $3, ${prefix}_qa_notes = $4,
      ${prefix}_qa_effective_at = $5, ${prefix}_qa_approved_by = $6,
      row_version = row_version + 1, updated_at = NOW()
    WHERE project_id = $1 AND zone_no = $2 AND row_version = $7
    RETURNING *
  `, [key.projectId, key.zoneNo, status, notes, effectiveAt, actorId, expected]);
  return rows[0] ?? null;
}
export async function touchZone(
  client: PoolClient, key: ZoneKey, expected: number,
): Promise<ZoneStateRow | null> {
  const { rows } = await client.query<ZoneStateRow>(`
    UPDATE zone_delivery_state SET row_version = row_version + 1, updated_at = NOW()
    WHERE project_id = $1 AND zone_no = $2 AND row_version = $3 RETURNING *
  `, [key.projectId, key.zoneNo, expected]);
  return rows[0] ?? null;
}

export async function invalidateZoneQa(
  client: PoolClient,
  key: ZoneKey,
  expected: number,
): Promise<ZoneStateRow | null> {
  const { rows } = await client.query<ZoneStateRow>(`
    UPDATE zone_delivery_state SET
      eligible_for_zone_qa_at = NULL,
      civil_qa_status = 'not_started', civil_qa_notes = '',
      civil_qa_effective_at = NULL, civil_qa_approved_by = NULL,
      optical_qa_status = 'not_started', optical_qa_notes = '',
      optical_qa_effective_at = NULL, optical_qa_approved_by = NULL,
      row_version = row_version + 1, updated_at = NOW()
    WHERE project_id = $1 AND zone_no = $2 AND row_version = $3
      AND (eligible_for_zone_qa_at IS NOT NULL
        OR civil_qa_status <> 'not_started'
        OR optical_qa_status <> 'not_started')
    RETURNING *
  `, [key.projectId, key.zoneNo, expected]);
  return rows[0] ?? null;
}

export async function stampEligibility(client: PoolClient, key: ZoneKey): Promise<void> {
  await client.query(`
    UPDATE zone_delivery_state SET eligible_for_zone_qa_at = NOW(),
      row_version = row_version + 1, updated_at = NOW()
    WHERE project_id = $1 AND zone_no = $2 AND eligible_for_zone_qa_at IS NULL
  `, [key.projectId, key.zoneNo]);
}
export async function stampHandover(
  client: PoolClient,
  key: ZoneKey,
  snapshot: unknown,
): Promise<ZoneStateRow | null> {
  const { rows } = await client.query<ZoneStateRow>(`
    UPDATE zone_delivery_state SET handed_over_at = NOW(), handover_snapshot = $3,
      row_version = row_version + 1, updated_at = NOW()
    WHERE project_id = $1 AND zone_no = $2 AND handed_over_at IS NULL
    RETURNING *
  `, [key.projectId, key.zoneNo, JSON.stringify(snapshot)]);
  return rows[0] ?? null;
}
