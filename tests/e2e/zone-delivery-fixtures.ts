import { calculatePonActions } from '../../src/modules/construction-qa/zone-delivery/services/zoneDeliveryActionCalculator';
import type {
  MilestoneEvidence,
  PonDeliveryView,
  PonMilestone,
  ZoneDeliveryActivity,
  ZoneDeliveryView,
  ZoneRegisterResult,
} from '../../src/modules/construction-qa/zone-delivery/types/zoneDelivery.types';

export const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
export const LIVE_PON_ID = '22222222-2222-4222-8222-222222222228';
export const PENDING_PON_ID = '22222222-2222-4222-8222-222222222229';
export const SNAG_ID = '44444444-4444-4444-8444-444444444449';
export const ZONE_PATH = `/field-ops/zone?project_id=${PROJECT_ID}&zone_no=12`;

const evidence = (day: number): MilestoneEvidence => ({
  effectiveAt: `2026-07-${String(day).padStart(2, '0')}T08:00:00.000Z`,
  actorEmail: 'supervisor@velocityfibre.co.za',
  source: 'field supervision',
});

const gateOrder: PonMilestone[] = [
  'civil_complete',
  'optical_complete',
  'testing_passed',
  'port_submitted',
  'port_approved',
  'technically_live',
];

const milestonesThrough = (lastGate: PonMilestone) =>
  Object.fromEntries(
    gateOrder.slice(0, gateOrder.indexOf(lastGate) + 1)
      .map((gate, index) => [gate, evidence(18 + index)]),
  );

function includedPon(
  ponStageId: string,
  ponNo: number,
  milestones: PonDeliveryView['milestones'],
  handedOver = false,
): PonDeliveryView {
  return {
    ponStageId,
    ponNo,
    scopeStatus: 'included',
    scopeReason: null,
    milestones,
    actions: calculatePonActions({
      ponStageId,
      ponNo,
      scopeApproved: true,
      scopeStatus: 'included',
      handedOver,
      milestones,
      civilQaApproved: true,
      opticalQaApproved: true,
      hasActiveTestPack: true,
      reconfirmationBlockers: [],
    }),
    rowVersion: 7,
  };
}

const livePon = includedPon(
  LIVE_PON_ID,
  8,
  milestonesThrough('technically_live'),
);
const pendingPon = includedPon(
  PENDING_PON_ID,
  9,
  milestonesThrough('port_submitted'),
);

export const registerResult: ZoneRegisterResult = {
  summary: {
    zones: 1,
    includedPons: 2,
    livePons: 1,
    readyForQa: 0,
    handedOver: 0,
  },
  rows: [{
    projectId: PROJECT_ID,
    projectName: 'Etwatwa',
    zoneNo: 12,
    scopeApproved: true,
    status: 'awaiting_port_approval',
    includedPons: 2,
    livePons: 1,
    earliestIncompleteGate: 'port_approved',
    blockerCount: 1,
    civilQa: 'not_started',
    opticalQa: 'not_started',
    handedOverAt: null,
  }],
};

export const emptyRegisterResult: ZoneRegisterResult = {
  summary: {
    zones: 0,
    includedPons: 0,
    livePons: 0,
    readyForQa: 0,
    handedOver: 0,
  },
  rows: [],
};

const documents: ZoneDeliveryView['documents'] = [
  {
    id: '33333333-3333-4333-8333-333333333339',
    documentType: 'test_pack',
    ponStageId: PENDING_PON_ID,
    sourceRef: 'zone-delivery/test-pack-pon-9.pdf',
    url: '/storage/zone-delivery/test-pack-pon-9.pdf',
    checksumSha256: 'a'.repeat(64),
    active: true,
  },
  {
    id: '33333333-3333-4333-8333-333333333341',
    documentType: 'fac',
    sourceRef: 'zone-delivery/fac-zone-12.pdf',
    url: '/storage/zone-delivery/fac-zone-12.pdf',
    checksumSha256: 'b'.repeat(64),
    active: true,
  },
  {
    id: '33333333-3333-4333-8333-333333333342',
    documentType: 'cac',
    sourceRef: 'zone-delivery/cac-zone-12.pdf',
    url: '/storage/zone-delivery/cac-zone-12.pdf',
    checksumSha256: 'c'.repeat(64),
    active: true,
  },
];

const openSnag: ZoneDeliveryView['snags'][number] = {
  snagId: SNAG_ID,
  status: 'open',
  closedAt: null,
  qaDiscipline: 'optical',
  ponStageId: PENDING_PON_ID,
  ponNo: 9,
  affectedGate: null,
  handoverBlocking: true,
  requiresReconfirmation: false,
  reconfirmedAt: null,
};

export const activeZone: ZoneDeliveryView = {
  projectId: PROJECT_ID,
  projectName: 'Etwatwa',
  zoneNo: 12,
  scopeApproved: true,
  pons: [livePon, pendingPon],
  civilQa: {
    status: 'not_started',
    effectiveAt: null,
    approverEmail: null,
    notes: '',
  },
  opticalQa: {
    status: 'not_started',
    effectiveAt: null,
    approverEmail: null,
    notes: '',
  },
  documents,
  snags: [openSnag],
  status: 'awaiting_port_approval',
  blockers: [{
    code: 'PON_PORT_NOT_APPROVED',
    message: 'PON 9 port is not approved',
    ponNo: 9,
    entityId: PENDING_PON_ID,
  }],
  eligibleForZoneQaAt: null,
  handedOverAt: null,
  rowVersion: 11,
};

const allLivePons = [
  livePon,
  includedPon(PENDING_PON_ID, 9, milestonesThrough('technically_live')),
];

export const zoneQaZone: ZoneDeliveryView = {
  ...activeZone,
  pons: allLivePons,
  civilQa: {
    status: 'passed',
    effectiveAt: '2026-07-24T08:00:00.000Z',
    approverEmail: 'civil.qa@velocityfibre.co.za',
    notes: 'Civil closeout accepted.',
  },
  opticalQa: {
    status: 'failed',
    effectiveAt: '2026-07-25T09:00:00.000Z',
    approverEmail: 'optical.qa@velocityfibre.co.za',
    notes: 'Repair and retest PON 9.',
  },
  status: 'zone_qa_in_progress',
  blockers: [{
    code: 'OPTICAL_ZONE_QA_NOT_PASSED',
    message: 'Optical Zone QA is not passed',
  }],
  eligibleForZoneQaAt: '2026-07-24T07:30:00.000Z',
  rowVersion: 13,
};

const handedOverPons = allLivePons.map(pon =>
  includedPon(pon.ponStageId, pon.ponNo, pon.milestones, true));

export const handedOverZone: ZoneDeliveryView = {
  ...zoneQaZone,
  pons: handedOverPons,
  opticalQa: {
    ...zoneQaZone.opticalQa,
    status: 'passed',
    effectiveAt: '2026-07-27T09:30:00.000Z',
    notes: 'Optical repair accepted.',
  },
  snags: [{
    ...openSnag,
    status: 'closed',
    closedAt: '2026-07-27T09:00:00.000Z',
  }],
  status: 'handed_over',
  blockers: [],
  handedOverAt: '2026-07-28T10:15:00.000Z',
  rowVersion: 14,
};

export const activity: ZoneDeliveryActivity[] = [{
  id: '55555555-5555-4555-8555-555555555551',
  action: 'port_approved_reopened',
  effectiveAt: '2026-07-25T10:00:00.000Z',
  recordedAt: '2026-07-25T10:12:00.000Z',
  actorEmail: 'operations@velocityfibre.co.za',
  permission: 'construction-qa.zone-delivery.operations-confirm',
  source: 'site instruction SI-204',
  reason: 'Port label mismatch found during audit.',
  previousValue: { port_approved: evidence(22), technically_live: evidence(23) },
  newValue: {},
}];

export const handedOverActivity: ZoneDeliveryActivity[] = [{
  id: '55555555-5555-4555-8555-555555555552',
  action: 'maintenance_linked',
  effectiveAt: '2026-07-29T06:00:00.000Z',
  recordedAt: '2026-07-29T06:05:00.000Z',
  actorEmail: 'operations@velocityfibre.co.za',
  permission: 'construction-qa.zone-delivery.operations-confirm',
  source: 'maintenance inspection',
  reason: 'Non-blocking maintenance observation.',
  previousValue: null,
  newValue: { affectedGate: 'optical_complete', handoverBlocking: false },
}];
