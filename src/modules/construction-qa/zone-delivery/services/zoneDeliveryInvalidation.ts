import type { PoolClient } from 'pg';
import type { ZoneStateRow } from '../repositories/zoneDeliveryReadRepository';
import {
  appendActivity,
  invalidateZoneQa,
} from '../repositories/zoneDeliveryWriteRepository';
import type {
  CommandMeta,
  DeliveryActor,
  ZoneKey,
} from '../types/zoneDelivery.types';

type InvalidationMeta = ZoneKey & CommandMeta;
type Time = Date | string | null;

const iso = (value: Time): string | null =>
  value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

export async function invalidateZoneEvidence(
  client: PoolClient,
  input: InvalidationMeta,
  actor: DeliveryActor,
  previous: ZoneStateRow,
): Promise<ZoneStateRow> {
  const updated = await invalidateZoneQa(client, input, previous.row_version);
  if (!updated) return previous;
  const activity = {
    key: input,
    entityType: 'zone' as const,
    entityId: previous.id,
    effectiveAt: input.effectiveAt,
    actor,
    source: input.source,
    reason: input.reason,
  };
  for (const discipline of ['civil', 'optical'] as const) {
    if (previous[`${discipline}_qa_status`] === 'not_started') continue;
    await appendActivity(client, {
      ...activity,
      action: `${discipline}_zone_qa_invalidated`,
      previousValue: {
        status: previous[`${discipline}_qa_status`],
        notes: previous[`${discipline}_qa_notes`],
        effectiveAt: iso(previous[`${discipline}_qa_effective_at`]),
        approverUserId: previous[`${discipline}_qa_approved_by`],
      },
      newValue: {
        status: 'not_started',
        notes: '',
        effectiveAt: null,
        approverUserId: null,
      },
    });
  }
  if (previous.eligible_for_zone_qa_at) {
    await appendActivity(client, {
      ...activity,
      action: 'zone_qa_eligibility_invalidated',
      previousValue: { eligibleForZoneQaAt: iso(previous.eligible_for_zone_qa_at) },
      newValue: { eligibleForZoneQaAt: null },
    });
  }
  return updated;
}
