import type { Pool } from 'pg';
import type {
  DeclareHandoverInput,
  DeliveryActor,
  ZoneDeliveryView,
} from '../types/zoneDelivery.types';
import * as read from '../repositories/zoneDeliveryReadRepository';
import * as write from '../repositories/zoneDeliveryWriteRepository';
import {
  deliveryError,
  requirePermission,
  requirePrerequisiteOverride,
  validateMeta,
  versionConflict,
} from './zoneDeliveryErrors';
import { assertCanonicalZone } from './zoneDeliveryCanonical';
import { buildSnapshot, calculateAggregate, recalculateZone } from './zoneDeliveryHandover';
import { transaction } from './zoneDeliveryTransactions';

type Time = Date | string | null;
const iso = (value: Time): string | null =>
  value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

/**
 * Handover blockers an override may never waive.
 *
 * A missing FAC or CAC is absent evidence, and an open handover-blocking snag
 * is a live defect — neither is "the workflow predates FibreFlow", which is the
 * only thing the override exists to forgive.
 */
const NON_WAIVABLE: ReadonlySet<string> = new Set([
  'FAC_MISSING',
  'CAC_MISSING',
  'OPEN_HANDOVER_SNAGS',
]);

/**
 * Record a zone handover with an operator-chosen date.
 *
 * The register previously derived handover automatically the moment every gate
 * passed, which cannot express a legacy zone that was handed over months before
 * FibreFlow tracked the site, nor a FAC signed on one date and uploaded on
 * another. This is the declared counterpart; the derived path still runs and
 * still refuses to overwrite a declared date.
 *
 * Gated on zone-qa-approve because handover is a zone-level act, matching the
 * other zone-level command rather than the per-PON confirm permissions.
 */
export function declareZoneHandoverCommand(
  pool: Pool,
  input: DeclareHandoverInput,
  actor: DeliveryActor,
): Promise<ZoneDeliveryView> {
  return transaction(pool, async client => {
    requirePermission(actor, 'zone-qa-approve');
    await assertCanonicalZone(client, input);
    const now = await read.readTransactionTime(client);
    const zone = await write.lockZone(client, input);
    if (!zone || zone.row_version !== input.expectedRowVersion) versionConflict();
    const state = zone!;
    const previousHandover = iso(state.handed_over_at);

    // Re-dating an existing handover is a correction, which forces a reason
    // even when the new date is today. Back-dating forces one regardless.
    validateMeta(input, now, previousHandover !== null);

    const aggregate = await read.readZoneAggregate(client, input);
    const calculation = calculateAggregate(aggregate);
    if (!calculation.eligibleForHandover) {
      const blocking = calculation.blockers.filter(item => NON_WAIVABLE.has(item.code));
      if (blocking.length > 0) {
        deliveryError('EVIDENCE_REQUIRED', blocking.map(item => item.message).join('; '));
      }
      if (!requirePrerequisiteOverride(input, actor)) {
        deliveryError(
          'PREREQUISITE_BLOCKED',
          calculation.blockers.map(item => item.message).join('; ')
            || 'Zone is not eligible for handover',
        );
      }
    }

    const snapshot = buildSnapshot(aggregate);
    const saved = await write.declareHandover(
      client, input, snapshot, input.effectiveAt, input.expectedRowVersion,
    );
    if (!saved) versionConflict();

    await write.appendActivity(client, {
      key: input,
      entityType: 'zone',
      entityId: saved!.id,
      action: 'zone_handed_over',
      effectiveAt: input.effectiveAt,
      actor,
      source: input.source,
      reason: input.reason,
      previousValue: previousHandover === null ? null : { handedOverAt: previousHandover },
      newValue: {
        handedOverAt: iso(saved!.handed_over_at),
        snapshot,
        declared: true,
        ...(previousHandover === null ? {} : { corrected: true }),
        ...(input.overridePrerequisite ? { overrodePrerequisite: true } : {}),
      },
    });

    return recalculateZone(client, input, actor);
  });
}
