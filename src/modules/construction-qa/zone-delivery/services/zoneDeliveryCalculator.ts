import type {
  DeliveryBlocker,
  PonDeliveryView,
  PonMilestone,
  ZoneDeliveryCalculation,
  ZoneDeliveryInput,
  ZoneDeliveryStatus,
} from '../types/zoneDelivery.types';

const milestoneOrder: PonMilestone[] = [
  'civil_complete',
  'optical_complete',
  'testing_passed',
  'port_submitted',
  'port_approved',
  'technically_live',
];

const milestoneBlockers: Record<
  PonMilestone,
  { code: string; message: (ponNo: number) => string }
> = {
  civil_complete: {
    code: 'PON_CIVIL_INCOMPLETE',
    message: (ponNo) => `PON ${ponNo} civil completion is not confirmed`,
  },
  optical_complete: {
    code: 'PON_OPTICAL_INCOMPLETE',
    message: (ponNo) => `PON ${ponNo} optical completion is not confirmed`,
  },
  testing_passed: {
    code: 'PON_TESTING_INCOMPLETE',
    message: (ponNo) => `PON ${ponNo} testing is not passed`,
  },
  port_submitted: {
    code: 'PON_PORT_NOT_SUBMITTED',
    message: (ponNo) => `PON ${ponNo} is not submitted for port approval`,
  },
  port_approved: {
    code: 'PON_PORT_NOT_APPROVED',
    message: (ponNo) => `PON ${ponNo} port is not approved`,
  },
  technically_live: {
    code: 'PON_NOT_LIVE',
    message: (ponNo) => `PON ${ponNo} is not technically live`,
  },
};

function earliestMissingGate(pon: PonDeliveryView): PonMilestone | null {
  return milestoneOrder.find((milestone) => !pon.milestones[milestone]) ?? null;
}

function calculatePonBlockers(pons: PonDeliveryView[]): DeliveryBlocker[] {
  return pons.flatMap((pon) => {
    const milestone = earliestMissingGate(pon);

    if (!milestone) {
      return [];
    }

    const blocker = milestoneBlockers[milestone];
    return [
      {
        code: blocker.code,
        message: blocker.message(pon.ponNo),
        ponNo: pon.ponNo,
        entityId: pon.ponStageId,
      },
    ];
  });
}

function statusForPonProgress(pons: PonDeliveryView[]): ZoneDeliveryStatus {
  if (pons.every((pon) => pon.milestones.port_approved)) {
    return 'go_live_in_progress';
  }

  if (pons.every((pon) => pon.milestones.port_submitted)) {
    return 'awaiting_port_approval';
  }

  if (pons.every((pon) => pon.milestones.testing_passed)) {
    return 'ready_for_port_submission';
  }

  if (pons.every((pon) => pon.milestones.optical_complete)) {
    return 'testing_in_progress';
  }

  if (pons.every((pon) => pon.milestones.civil_complete)) {
    return 'optical_construction';
  }

  return 'civil_construction';
}

export function calculateZoneDelivery(input: ZoneDeliveryInput): ZoneDeliveryCalculation {
  if (input.handedOverAt !== null) {
    return {
      status: 'handed_over',
      earliestIncompleteGate: null,
      blockers: [],
      eligibleForZoneQa: false,
      eligibleForHandover: false,
    };
  }

  const includedPons = input.pons.filter((pon) => pon.scopeStatus === 'included');
  const scopeBlockers: DeliveryBlocker[] = [];

  if (!input.scopeApproved) {
    scopeBlockers.push({
      code: 'SCOPE_NOT_APPROVED',
      message: 'Zone scope is not approved',
    });
  }

  if (includedPons.length === 0) {
    scopeBlockers.push({
      code: 'EMPTY_INCLUDED_SCOPE',
      message: 'Zone has no included PONs',
    });
  }

  if (scopeBlockers.length > 0) {
    return {
      status: 'scope_pending',
      earliestIncompleteGate: null,
      blockers: scopeBlockers,
      eligibleForZoneQa: false,
      eligibleForHandover: false,
    };
  }

  const ponBlockers = calculatePonBlockers(includedPons);
  const earliestIncompleteGate =
    milestoneOrder.find((milestone) =>
      ponBlockers.some((blocker) => blocker.code === milestoneBlockers[milestone].code)
    ) ?? null;
  const eligibleForZoneQa = includedPons.every((pon) => pon.milestones.technically_live);

  if (!eligibleForZoneQa) {
    return {
      status: statusForPonProgress(includedPons),
      earliestIncompleteGate,
      blockers: ponBlockers,
      eligibleForZoneQa: false,
      eligibleForHandover: false,
    };
  }

  const qaBlockers: DeliveryBlocker[] = [];

  if (input.civilQa !== 'passed') {
    qaBlockers.push({
      code: 'CIVIL_ZONE_QA_NOT_PASSED',
      message: 'Civil Zone QA is not passed',
    });
  }

  if (input.opticalQa !== 'passed') {
    qaBlockers.push({
      code: 'OPTICAL_ZONE_QA_NOT_PASSED',
      message: 'Optical Zone QA is not passed',
    });
  }

  if (qaBlockers.length > 0) {
    const qaHasStarted = input.civilQa !== 'not_started' || input.opticalQa !== 'not_started';

    return {
      status: qaHasStarted ? 'zone_qa_in_progress' : 'ready_for_zone_qa',
      earliestIncompleteGate: null,
      blockers: qaBlockers,
      eligibleForZoneQa: true,
      eligibleForHandover: false,
    };
  }

  const handoverBlockers: DeliveryBlocker[] = [];

  if (!input.hasFac) {
    handoverBlockers.push({ code: 'FAC_MISSING', message: 'Active FAC is missing' });
  }

  if (!input.hasCac) {
    handoverBlockers.push({ code: 'CAC_MISSING', message: 'Active CAC is missing' });
  }

  if (input.openBlockingSnags > 0) {
    handoverBlockers.push({
      code: 'OPEN_HANDOVER_SNAGS',
      message: `${input.openBlockingSnags} open handover-blocking snag(s)`,
    });
  }

  if (handoverBlockers.length > 0) {
    return {
      status: 'handover_blocked',
      earliestIncompleteGate: null,
      blockers: handoverBlockers,
      eligibleForZoneQa: true,
      eligibleForHandover: false,
    };
  }

  return {
    status: 'zone_qa_in_progress',
    earliestIncompleteGate: null,
    blockers: [],
    eligibleForZoneQa: true,
    eligibleForHandover: true,
  };
}
