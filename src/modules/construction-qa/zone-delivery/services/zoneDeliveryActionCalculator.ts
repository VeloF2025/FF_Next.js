import type {
  DeliveryBlocker,
  MilestoneActionAvailability,
  PonMilestone,
  ScopeStatus,
} from '../types/zoneDelivery.types';

export interface PonActionInput {
  ponStageId: string;
  ponNo: number;
  scopeApproved: boolean;
  scopeStatus: ScopeStatus;
  handedOver: boolean;
  milestones: Partial<Record<PonMilestone, unknown>>;
  civilQaApproved: boolean;
  opticalQaApproved: boolean;
  hasActiveTestPack: boolean;
  reconfirmationBlockers: Array<{ gate: PonMilestone; status: string }>;
}

const gates: PonMilestone[] = [
  'civil_complete',
  'optical_complete',
  'testing_passed',
  'port_submitted',
  'port_approved',
  'technically_live',
];

const prerequisiteBlockers: Record<PonMilestone, { code: string; message: string }> = {
  civil_complete: {
    code: 'PON_CIVIL_INCOMPLETE',
    message: 'Civil completion is required first',
  },
  optical_complete: {
    code: 'PON_CIVIL_INCOMPLETE',
    message: 'Civil completion is required first',
  },
  testing_passed: {
    code: 'PON_OPTICAL_INCOMPLETE',
    message: 'Optical completion is required first',
  },
  port_submitted: {
    code: 'PON_TESTING_INCOMPLETE',
    message: 'Testing must pass first',
  },
  port_approved: {
    code: 'PON_PORT_NOT_SUBMITTED',
    message: 'Port submission is required first',
  },
  technically_live: {
    code: 'PON_PORT_NOT_APPROVED',
    message: 'Port approval is required first',
  },
};

const blocker = (
  input: PonActionInput,
  code: string,
  message: string,
): DeliveryBlocker => ({
  code,
  message: `PON ${input.ponNo} ${message}`,
  ponNo: input.ponNo,
  entityId: input.ponStageId,
});

function confirmBlocker(
  input: PonActionInput,
  gate: PonMilestone,
  index: number,
): DeliveryBlocker | null {
  if (!input.scopeApproved) {
    return blocker(input, 'SCOPE_NOT_APPROVED', 'zone scope is not approved');
  }
  if (input.scopeStatus !== 'included') {
    return blocker(input, 'PON_NOT_INCLUDED', 'is not included in approved scope');
  }
  if (input.handedOver) {
    return blocker(input, 'HANDOVER_LOCKED', 'zone handover is terminal');
  }
  const previousGate = gates[index - 1];
  // port_submitted is an attestation, not a derived fact: it records that the
  // operator uploaded the PON's optical pack to the FNO's SharePoint, which
  // happens entirely outside FibreFlow and which FibreFlow cannot verify. On
  // legacy sites the earlier gates were never recorded here at all, so
  // requiring them only stops the operator from telling us the truth. The
  // gates it feeds (port_approved, technically_live) stay sequenced.
  if (previousGate && gate !== 'port_submitted' && !input.milestones[previousGate]) {
    const prerequisite = prerequisiteBlockers[gate];
    return blocker(input, prerequisite.code, prerequisite.message.toLowerCase());
  }
  if (gate === 'civil_complete' && !input.civilQaApproved) {
    return blocker(input, 'CIVIL_QA_INCOMPLETE', 'civil construction QA is incomplete');
  }
  if (gate === 'optical_complete' && !input.opticalQaApproved) {
    return blocker(input, 'OPTICAL_QA_INCOMPLETE', 'optical construction QA is incomplete');
  }
  if (gate === 'testing_passed' && !input.hasActiveTestPack) {
    return blocker(input, 'TEST_PACK_MISSING', 'active test pack is missing');
  }
  const openReconfirmation = input.reconfirmationBlockers.some(item =>
    item.gate === gate && item.status !== 'closed');
  if (openReconfirmation) {
    return blocker(input, 'SNAG_RECONFIRMATION_BLOCKED', 'affected snag must be closed first');
  }
  return null;
}

export function calculatePonActions(
  input: PonActionInput,
): Record<PonMilestone, MilestoneActionAvailability> {
  return Object.fromEntries(gates.map((gate, index) => {
    const action = input.milestones[gate] ? 'reopen' : 'confirm';
    const reason = action === 'reopen'
      ? (input.handedOver
        ? blocker(input, 'HANDOVER_LOCKED', 'zone handover is terminal')
        : null)
      : confirmBlocker(input, gate, index);
    return [gate, {
      action,
      enabled: reason === null,
      blocker: reason,
    }];
  })) as Record<PonMilestone, MilestoneActionAvailability>;
}
