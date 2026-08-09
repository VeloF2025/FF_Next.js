import type { PoolClient } from 'pg';
import type { ZoneKey } from '../types/zoneDelivery.types';
import { deliveryError } from './zoneDeliveryErrors';

/**
 * Create the canonical rows a zone needs before anything can be recorded
 * against it, from the PON list Works QA already shows the operator.
 *
 * Two tables gate every zone-level command, and neither is populated on the
 * path the operator actually walks. `pon_stage_tracking` is written only by the
 * 1Map sync, which covers three of eleven projects — the other eight have no
 * rows at all, so `assertCanonicalZone` reports that a zone he is looking at
 * does not exist. `pon_delivery_state` is created only by scope approval, which
 * has never been performed on any zone in production, so `lockPon` finds
 * nothing and the command reports a version conflict against a row that was
 * never there.
 *
 * Rows are created empty and never updated. ON CONFLICT DO NOTHING keeps 1Map
 * authoritative wherever it has already spoken, and a later sync enriches these
 * rows in place rather than duplicating them, because it conflicts on the same
 * unique key and preserves `id` — which `pon_delivery_state` references.
 *
 * This runs before `assertCanonicalZone`, which stays as the backstop: if
 * Works QA has no PONs for the zone either, then nothing in FibreFlow knows
 * about it and ZONE_NOT_FOUND is the truthful answer.
 */
export async function ensureCanonicalPons(
  client: PoolClient,
  key: ZoneKey,
): Promise<void> {
  await client.query(`
    INSERT INTO pon_stage_tracking (project_id, zone_no, pon_no, sync_source)
    SELECT DISTINCT project_id, zone_no, pon_no, 'works-qa'
    FROM (
      SELECT project_id, zone_no, pon_no
      FROM v_pole_planning
      WHERE project_id = $1::uuid AND zone_no = $2::integer AND pon_no IS NOT NULL
      UNION
      SELECT project_id, zone_no, pon_no
      FROM pole_qa_photos
      WHERE project_id = $1::uuid AND zone_no = $2::integer AND pon_no IS NOT NULL
    ) works_qa
    ON CONFLICT (project_id, zone_no, pon_no) DO NOTHING
  `, [key.projectId, key.zoneNo]);
  await client.query(`
    INSERT INTO pon_delivery_state (pon_stage_id)
    SELECT id FROM pon_stage_tracking
    WHERE project_id = $1::uuid AND zone_no = $2::integer
    ON CONFLICT (pon_stage_id) DO NOTHING
  `, [key.projectId, key.zoneNo]);
}

export async function assertCanonicalZone(
  client: PoolClient,
  key: ZoneKey,
): Promise<void> {
  const { rowCount } = await client.query(`
    SELECT 1
    FROM pon_stage_tracking
    WHERE project_id = $1 AND zone_no = $2
    LIMIT 1
  `, [key.projectId, key.zoneNo]);
  if (!rowCount) {
    deliveryError('ZONE_NOT_FOUND', 'Zone has no canonical PON tracking rows');
  }
}
