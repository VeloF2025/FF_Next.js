import type { Pool } from 'pg';
import type {
  DeliveryActor,
  RecordZoneQaInput,
  ZoneDeliveryView,
} from '../types/zoneDelivery.types';
import * as read from '../repositories/zoneDeliveryReadRepository';
import * as write from '../repositories/zoneDeliveryWriteRepository';
import {
  deliveryError,
  handoverLocked,
  requirePermission,
  validateMeta,
  versionConflict,
} from './zoneDeliveryErrors';
import { assertCanonicalZone } from './zoneDeliveryCanonical';
import { calculateAggregate, recalculateZone } from './zoneDeliveryHandover';
import { transaction } from './zoneDeliveryTransactions';

type Time = Date | string | null;
const iso = (value: Time): string | null =>
  value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

export function recordZoneQaCommand(
  pool: Pool,
  input: RecordZoneQaInput,
  actor: DeliveryActor,
): Promise<ZoneDeliveryView> {
  return transaction(pool, async client => {
    requirePermission(actor, 'zone-qa-approve');
    await assertCanonicalZone(client, input);
    const now = await read.readTransactionTime(client);
    const zone = await write.lockZone(client, input);
    if (!zone || zone.row_version !== input.expectedRowVersion) versionConflict();
    const state = zone!;
    if (state.handed_over_at) handoverLocked();
    const aggregate = await read.readZoneAggregate(client, input);
    if (!calculateAggregate(aggregate).eligibleForZoneQa)
      deliveryError('PREREQUISITE_BLOCKED', 'Every included PON must be technically live');
    const previousStatus = input.discipline === 'civil'
      ? state.civil_qa_status : state.optical_qa_status;
    validateMeta(input, now, previousStatus !== 'not_started');
    if (input.status === 'failed' && input.snagIds.length === 0)
      deliveryError('VALIDATION_ERROR', 'Failed Zone QA requires existing snag IDs');
    for (const snagId of [...new Set(input.snagIds)]) {
      if (!(await read.readSnag(client, input.projectId, snagId)))
        deliveryError('VALIDATION_ERROR', `Snag ${snagId} does not belong to the project`);
      await write.linkSnag(client, input, snagId, actor.userId, {
        qaDiscipline: input.discipline,
        blocking: true,
        reconfirmation: false,
      });
    }
    const saved = await write.writeZoneQa(
      client, input, input.discipline, input.status, input.notes,
      input.effectiveAt, actor.userId, input.expectedRowVersion,
    );
    if (!saved) versionConflict();
    const prefix = input.discipline === 'civil' ? 'civil' : 'optical';
    await write.appendActivity(client, {
      key: input,
      entityType: 'zone',
      entityId: state.id,
      action: `${input.discipline}_zone_qa_recorded`,
      effectiveAt: input.effectiveAt,
      actor,
      source: input.source,
      reason: input.reason,
      previousValue: {
        status: previousStatus,
        notes: state[`${prefix}_qa_notes`],
        effectiveAt: iso(state[`${prefix}_qa_effective_at`] as Time),
        approverUserId: state[`${prefix}_qa_approved_by`],
      },
      newValue: {
        status: input.status,
        notes: input.notes,
        effectiveAt: input.effectiveAt,
        approverUserId: actor.userId,
      },
    });
    return recalculateZone(client, input, actor);
  });
}
