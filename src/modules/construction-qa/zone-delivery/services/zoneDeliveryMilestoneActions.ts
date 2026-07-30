import type { PoolClient } from 'pg';
import {
  constructionQaIsApproved,
  type DocumentRow,
  type PonStateRow,
  type SnagLinkRow,
  type ZoneAggregate,
  type ZoneStateRow,
} from '../repositories/zoneDeliveryReadRepository';
import type { ConfirmMilestoneInput } from '../types/zoneDelivery.types';
import { calculatePonActions } from './zoneDeliveryActionCalculator';
import { deliveryError } from './zoneDeliveryErrors';
import { milestoneState } from './zoneDeliveryHandover';

interface MilestoneDependencies {
  testPack: DocumentRow | undefined;
  reconfirmations: SnagLinkRow[];
}

export async function validateMilestoneConfirmation(
  client: PoolClient,
  input: ConfirmMilestoneInput,
  zone: ZoneStateRow | null,
  state: PonStateRow,
  canonical: PonStateRow,
  aggregate: ZoneAggregate,
  current: Date | string | null,
): Promise<MilestoneDependencies> {
  if (input.milestone === 'civil_complete' || input.milestone === 'optical_complete') {
    const discipline = input.milestone === 'civil_complete' ? 'civil' : 'optical';
    const approved = await constructionQaIsApproved(
      client,
      input,
      canonical.pon_no,
      discipline,
    );
    if (discipline === 'civil') canonical.civil_qa_approved = approved;
    else canonical.optical_qa_approved = approved;
  }
  const testPack = aggregate.documents.find(document =>
    document.document_type === 'test_pack'
      && document.pon_stage_id === input.ponStageId
      && !document.superseded_at);
  const reconfirmations = aggregate.snagLinks.filter(link =>
    link.pon_stage_id === input.ponStageId
      && link.affected_gate === input.milestone
      && link.requires_reconfirmation);
  if (!current) {
    const availability = calculatePonActions({
      ponStageId: input.ponStageId,
      ponNo: canonical.pon_no,
      scopeApproved: Boolean(zone?.scope_approved_at),
      scopeStatus: state.scope_status,
      handedOver: Boolean(zone?.handed_over_at),
      milestones: milestoneState(state),
      civilQaApproved: canonical.civil_qa_approved,
      opticalQaApproved: canonical.optical_qa_approved,
      hasActiveTestPack: Boolean(testPack),
      reconfirmationBlockers: reconfirmations.map(link => ({
        gate: input.milestone,
        status: link.status,
      })),
    })[input.milestone];
    if (!availability.enabled) {
      const evidenceBlockers = new Set([
        'CIVIL_QA_INCOMPLETE',
        'OPTICAL_QA_INCOMPLETE',
        'TEST_PACK_MISSING',
      ]);
      deliveryError(
        evidenceBlockers.has(availability.blocker!.code)
          ? 'EVIDENCE_REQUIRED'
          : 'PREREQUISITE_BLOCKED',
        availability.blocker!.message,
      );
    }
  }
  return { testPack, reconfirmations };
}
