import type { Pool } from 'pg';
import type {
  DeliveryActor,
  SubmitPonInput,
  ZoneDeliveryView,
} from '../types/zoneDelivery.types';
import { assertCanonicalZone, ensureCanonicalPons } from './zoneDeliveryCanonical';
import { deliveryError } from './zoneDeliveryErrors';
import { transaction } from './zoneDeliveryTransactions';
import type { ZoneDeliveryService } from './zoneDeliveryService';

interface ResolvedPon {
  pon_stage_id: string;
  row_version: number;
}

/**
 * Record a PON submission from the natural key the operator has in front of
 * him — site, zone, PON — rather than the pon_stage_id only the delivery
 * workspace knows.
 *
 * Works QA lists PONs from the pole data; the delivery tables are keyed on a
 * 1Map-synced row that may not exist. Resolving the id here is what lets the
 * button live on the screen where the work happens.
 *
 * The resolve commits before the milestone command runs, so the command keeps
 * its own transaction, its own permission check and its own row-version CAS
 * rather than a weakened copy of them. The rows left behind by a failed
 * submission are empty placeholders that the retry reuses.
 */
export async function submitPonByNumber(
  pool: Pool,
  service: ZoneDeliveryService,
  input: SubmitPonInput,
  actor: DeliveryActor,
): Promise<ZoneDeliveryView> {
  const resolved = await transaction(pool, async client => {
    await ensureCanonicalPons(client, input);
    await assertCanonicalZone(client, input);
    const { rows } = await client.query<ResolvedPon>(`
      SELECT t.id AS pon_stage_id, COALESCE(s.row_version, 0) AS row_version
      FROM pon_stage_tracking t
      LEFT JOIN pon_delivery_state s ON s.pon_stage_id = t.id
      WHERE t.project_id = $1::uuid AND t.zone_no = $2::integer AND t.pon_no = $3::integer
    `, [input.projectId, input.zoneNo, input.ponNo]);
    if (!rows[0]) {
      // Reachable on the zones 1Map already tracks: ensureCanonicalPons leaves
      // those alone, so a PON 1Map has not synced has no row here. Twelve PONs
      // across seven production zones are in exactly that state. Naming the
      // PONs the zone does have turns a dead end into something the operator
      // can act on — either he mistyped, or the zone needs a 1Map sync.
      const { rows: known } = await client.query<{ pon_no: number }>(`
        SELECT pon_no FROM pon_stage_tracking
        WHERE project_id = $1::uuid AND zone_no = $2::integer
        ORDER BY pon_no
      `, [input.projectId, input.zoneNo]);
      const listed = known.slice(0, 20).map(row => row.pon_no).join(', ');
      const suffix = known.length > 20 ? `, … (${known.length} total)` : '';
      deliveryError(
        'VALIDATION_ERROR',
        `Zone ${input.zoneNo} has no PON ${input.ponNo} on record. It currently lists: ${listed}${suffix}. `
          + 'If this PON is new, it reaches FibreFlow through the 1Map sync.',
      );
    }
    return rows[0]!;
  });

  return service.confirmPonMilestone({
    projectId: input.projectId,
    zoneNo: input.zoneNo,
    ponStageId: resolved.pon_stage_id,
    milestone: 'port_submitted',
    action: 'confirm',
    expectedRowVersion: resolved.row_version,
    effectiveAt: input.effectiveAt,
    source: input.source,
    ...(input.reason ? { reason: input.reason } : {}),
  }, actor);
}
