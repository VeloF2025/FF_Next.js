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
  validateMeta,
  versionConflict,
} from './zoneDeliveryErrors';
import { assertCanonicalZone } from './zoneDeliveryCanonical';
import { buildSnapshot, recalculateZone } from './zoneDeliveryHandover';
import { transaction } from './zoneDeliveryTransactions';

type Time = Date | string | null;
const iso = (value: Time): string | null =>
  value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

const hasActive = (
  documents: read.DocumentRow[],
  documentType: 'fac' | 'cac',
): boolean => documents.some(document =>
  document.document_type === documentType
    && document.pon_stage_id === null
    && !document.superseded_at);

/**
 * Record a zone handover on a date the operator chooses.
 *
 * This is an attestation, not a derived fact. Handover was previously stamped
 * automatically the moment every gate passed, which cannot express a zone that
 * was delivered before FibreFlow tracked the site, nor a FAC signed on one date
 * and uploaded on another. The operator performs the handover in the field and
 * records it here afterwards, so the earlier gates are deliberately NOT
 * preconditions — on legacy sites they were never captured and never will be,
 * and requiring them only stops the operator recording the truth.
 *
 * The FAC and CAC are required, because uploading them IS the handover action
 * rather than a gate upon it — the operator supplies both every time.
 *
 * The derived path (stampHandover) still runs for zones that complete inside
 * FibreFlow, and still refuses to overwrite a date declared here.
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
    // A zone with no delivery-state row yet is not a conflict — it is a zone
    // whose FAC and CAC have not been uploaded, because zone_delivery_documents
    // carries a foreign key to zone_delivery_state. Registering either document
    // creates the row, so by the time a handover can legitimately be declared it
    // always exists. The evidence check below therefore reports the real reason;
    // creating the row here would be pointless, since the same transaction
    // always rolls back on EVIDENCE_REQUIRED.
    const state = await write.lockZone(client, input);
    if (state && state.row_version !== input.expectedRowVersion) versionConflict();
    const previousHandover = iso(state?.handed_over_at ?? null);

    // Re-dating an existing handover is a correction, which forces a reason
    // even when the new date is today. Back-dating forces one regardless.
    validateMeta(input, now, previousHandover !== null);

    const aggregate = await read.readZoneAggregate(client, input);
    const missing = (['fac', 'cac'] as const)
      .filter(documentType => !hasActive(aggregate.documents, documentType));
    if (missing.length > 0) {
      deliveryError(
        'EVIDENCE_REQUIRED',
        `Zone handover requires an active ${missing.map(m => m.toUpperCase()).join(' and ')}`,
      );
    }

    // An active FAC or CAC cannot reference a zone with no state row, so
    // normally the evidence gate above has already rejected this case. It is
    // still reachable: lockZone takes no lock when there is no row, so under
    // READ COMMITTED another transaction can create the row and register both
    // documents between that read and readZoneAggregate. Reporting a version
    // conflict is right — the caller's view of the zone is stale.
    if (!state) versionConflict();

    const snapshot = buildSnapshot(aggregate);
    if (previousHandover !== null) {
      // Migration 470 makes handed_over_at immutable at the database level, and
      // 485 narrows that to "immutable unless this GUC is set". Opting in here,
      // per-transaction and only when actually correcting, keeps every other
      // path — the derived stamp, backfills, ad-hoc UPDATEs — still terminal.
      await client.query(`SET LOCAL ff.zone_handover_correction = 'true'`);
    }
    const saved = await write.declareHandover(
      client, input, snapshot, input.effectiveAt, state!.row_version,
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
      },
    });

    return recalculateZone(client, input, actor);
  });
}
