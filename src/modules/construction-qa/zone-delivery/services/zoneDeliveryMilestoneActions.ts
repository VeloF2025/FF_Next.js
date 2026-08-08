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
import { blockerIgnoringSequence, calculatePonActions } from './zoneDeliveryActionCalculator';

/** Missing proof, as opposed to a violated ordering assumption. Never overridable. */
const EVIDENCE_BLOCKERS: ReadonlySet<string> = new Set([
  'CIVIL_QA_INCOMPLETE',
  'OPTICAL_QA_INCOMPLETE',
  'TEST_PACK_MISSING',
]);
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
  overrideAllowed = false,
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
    const actionInput = {
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
    };
    const availability = calculatePonActions(actionInput)[input.milestone];
    if (!availability.enabled) {
      // A sequencing prerequisite may be overridden by an authorised actor with
      // a reason: legacy zones were delivered before FibreFlow knew the site
      // existed, so their earlier gates will never be recorded. Evidence is
      // never overridable — that is missing proof, not a violated ordering
      // assumption.
      //
      // The residual check matters: confirmBlocker returns only the FIRST
      // blocker and evaluates sequence before evidence, so waving the sequence
      // through without re-testing would smuggle past a missing test pack or QA
      // approval that was never reached.
      const residual = overrideAllowed
        ? blockerIgnoringSequence(actionInput, input.milestone)
        : availability.blocker;
      if (residual) {
        deliveryError(
          EVIDENCE_BLOCKERS.has(residual.code) ? 'EVIDENCE_REQUIRED' : 'PREREQUISITE_BLOCKED',
          residual.message,
        );
      }
    }
  }
  return { testPack, reconfirmations };
}
