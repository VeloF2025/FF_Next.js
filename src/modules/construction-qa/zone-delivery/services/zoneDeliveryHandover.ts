import type { PoolClient } from 'pg';
import type {
  DeliveryActor,
  ZoneDeliveryView,
} from '../types/zoneDelivery.types';
import {
  readTransactionTime,
  readZoneAggregate,
  type DocumentRow,
  type ZoneAggregate,
} from '../repositories/zoneDeliveryReadRepository';
import {
  appendActivity,
  lockZone,
  stampEligibility,
  stampHandover,
} from '../repositories/zoneDeliveryWriteRepository';
import {
  buildZoneView,
  calculateAggregate,
  milestones,
  qaView,
} from './zoneDeliveryView';

export {
  buildZoneView,
  calculateAggregate,
  milestones,
  milestoneState,
} from './zoneDeliveryView';

type Time = Date | string | null;
const iso = (value: Time): string | null => {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
};
function snapshotDocument(doc: DocumentRow) {
  return {
    id: doc.id, ponStageId: doc.pon_stage_id, documentType: doc.document_type,
    documentSource: doc.document_source, sourceRef: doc.source_ref,
    filename: doc.filename, mimeType: doc.mime_type, sizeBytes: Number(doc.size_bytes),
    checksumSha256: doc.checksum_sha256, uploadedBy: doc.uploaded_by,
    uploadedAt: iso(doc.uploaded_at),
  };
}

function buildSnapshot(aggregate: ZoneAggregate) {
  const scope = aggregate.pons.map(pon => ({
    ponStageId: pon.pon_stage_id,
    ponNo: pon.pon_no,
    scopeStatus: pon.scope_status,
    scopeReason: pon.scope_reason,
  }));
  const milestoneSnapshot = aggregate.pons.map(pon => {
    const evidence: Record<string, unknown> = {
      ponStageId: pon.pon_stage_id,
      ponNo: pon.pon_no,
    };
    for (const { gate, at, by } of milestones) {
      const effectiveAt = iso(pon[at] as Time);
      if (effectiveAt) {
        const testPack = gate === 'testing_passed'
          ? aggregate.documents.find(doc => doc.id === pon.testing_test_pack_document_id)
          : undefined;
        evidence[gate] = {
          effectiveAt,
          actorUserId: pon[by],
          ...(gate === 'testing_passed'
            ? {
              testPackDocumentId: pon.testing_test_pack_document_id,
              testPackDocument: testPack ? snapshotDocument(testPack) : null,
            }
            : {}),
        };
      }
    }
    return evidence;
  });
  const qa = (discipline: 'civil' | 'optical') => ({
    status: aggregate.zone?.[`${discipline}_qa_status`],
    effectiveAt: iso(aggregate.zone?.[`${discipline}_qa_effective_at`] as Time),
    approverUserId: aggregate.zone?.[`${discipline}_qa_approved_by`],
    approverEmail: qaView(aggregate, discipline).approverEmail,
  });
  return {
    scope,
    milestones: milestoneSnapshot,
    zoneQa: { civil: qa('civil'), optical: qa('optical') },
    documents: aggregate.documents
      .filter(doc => doc.superseded_at === null)
      .map(snapshotDocument),
    snags: aggregate.snagLinks.map(link => ({
      snagId: link.snag_id,
      status: link.status,
      closedAt: iso(link.closed_at),
      qaDiscipline: link.qa_discipline,
      ponStageId: link.pon_stage_id,
      affectedGate: link.affected_gate,
      handoverBlocking: link.handover_blocking,
      requiresReconfirmation: link.requires_reconfirmation,
      reconfirmedAt: iso(link.reconfirmed_at),
    })).sort((left, right) => left.snagId.localeCompare(right.snagId)),
  };
}

export async function recalculateZone(
  client: PoolClient,
  key: ZoneAggregate['key'],
  actor: DeliveryActor,
): Promise<ZoneDeliveryView> {
  const locked = await lockZone(client, key);
  let aggregate = await readZoneAggregate(client, key, true);
  if (!locked) return buildZoneView(aggregate);
  let calculation = calculateAggregate(aggregate);
  if (calculation.eligibleForZoneQa && !aggregate.zone?.eligible_for_zone_qa_at) {
    await stampEligibility(client, key);
    aggregate = await readZoneAggregate(client, key, true);
    calculation = calculateAggregate(aggregate);
  }
  if (calculation.eligibleForHandover && !aggregate.zone?.handed_over_at) {
    const snapshot = buildSnapshot(aggregate);
    // One clock for both writes: the stamped date and the activity row used to
    // be read separately (NOW() vs the transaction time) and could disagree.
    const effectiveAt = await readTransactionTime(client);
    const stamped = await stampHandover(client, key, snapshot, effectiveAt);
    if (stamped) {
      await appendActivity(client, {
        key,
        entityType: 'zone',
        entityId: stamped.id,
        action: 'zone_handed_over',
        effectiveAt,
        actor,
        source: 'automatic-handover',
        previousValue: null,
        newValue: { handedOverAt: iso(stamped.handed_over_at), snapshot },
      });
    }
    aggregate = await readZoneAggregate(client, key, true);
  }
  return buildZoneView(aggregate);
}
