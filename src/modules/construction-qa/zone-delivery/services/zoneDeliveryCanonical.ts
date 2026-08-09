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
 * Only zones that FibreFlow tracks NOWHERE are seeded. Adding the missing PONs
 * to a zone 1Map already covers would silently enlarge that zone's canonical
 * set, which `readZoneAggregate` treats as the denominator: Zone-QA eligibility
 * requires every included PON to be technically live, and `updateScope` demands
 * a scope covering every canonical PON exactly once. Growing the set behind an
 * approved scope regresses both, with no activity row explaining why. Seven
 * production zones (six in Mohadin, one in Lawley) have PONs in the pole data
 * that 1Map has not synced, so this is reachable, not theoretical. On those
 * zones 1Map stays the authority and an unknown PON is rejected by name.
 *
 * `sync_source` is stamped for provenance but is NOT durable: the 1Map sync
 * restamps it to '1map' in its own DO UPDATE (pages/api/onemap/sync-stages.ts),
 * so a row it later covers stops being identifiable as ours. `last_synced_at`
 * is left NULL deliberately — the Build Tracker publishes MAX(last_synced_at)
 * as a project's "last synced" KPI, and defaulting it to NOW() would report a
 * 1Map sync that never ran.
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
    INSERT INTO pon_stage_tracking (project_id, zone_no, pon_no, sync_source, last_synced_at)
    SELECT DISTINCT project_id, zone_no, pon_no, 'works-qa', NULL::timestamptz
    FROM (
      SELECT project_id, zone_no, pon_no
      FROM v_pole_planning
      WHERE project_id = $1::uuid AND zone_no = $2::integer AND pon_no IS NOT NULL
      UNION
      SELECT project_id, zone_no, pon_no
      FROM pole_qa_photos
      WHERE project_id = $1::uuid AND zone_no = $2::integer AND pon_no IS NOT NULL
    ) works_qa
    WHERE NOT EXISTS (
      SELECT 1 FROM pon_stage_tracking existing
      WHERE existing.project_id = $1::uuid AND existing.zone_no = $2::integer
    )
    ORDER BY pon_no
    ON CONFLICT (project_id, zone_no, pon_no) DO NOTHING
  `, [key.projectId, key.zoneNo]);
  // Materialising the projection changes what scope approval sees: it used
  // `row_version === 0` to mean "this PON has never been scoped", reading it
  // through COALESCE(s.row_version, 0) so an absent row reported 0. A created
  // row cannot report 0 — `pon_delivery_state_row_version_check` enforces
  // row_version > 0 — so `updateScope` no longer infers first-approval from the
  // version and asks the zone instead. Rows are created for the whole zone
  // because any of its PONs may be the next one acted on, and they carry no
  // delivery facts: every milestone column is NULL and scope_status is the
  // 'included' default.
  await client.query(`
    INSERT INTO pon_delivery_state (pon_stage_id)
    SELECT id FROM pon_stage_tracking
    WHERE project_id = $1::uuid AND zone_no = $2::integer
    ORDER BY id
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
