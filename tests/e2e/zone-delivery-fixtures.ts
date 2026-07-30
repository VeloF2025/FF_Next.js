import type {
  PonDeliveryView,
  ZoneDeliveryActivity,
  ZoneDeliveryView,
  ZoneRegisterResult,
} from '../../src/modules/construction-qa/zone-delivery/types/zoneDelivery.types';

export const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
export const ZONE_PATH = `/field-ops/zone?project_id=${PROJECT_ID}&zone_no=12`;

const evidence = (day: number) => ({
  effectiveAt: `2026-07-${String(day).padStart(2, '0')}T08:00:00.000Z`,
  actorEmail: 'supervisor@velocityfibre.co.za',
  source: 'field supervision',
});

const livePon: PonDeliveryView = {
  ponStageId: 'pon-stage-8',
  ponNo: 8,
  scopeStatus: 'included',
  rowVersion: 7,
  milestones: {
    civil_complete: evidence(18),
    optical_complete: evidence(19),
    testing_passed: evidence(20),
    port_submitted: evidence(21),
    port_approved: evidence(22),
    technically_live: evidence(23),
  },
};

const pendingPon: PonDeliveryView = {
  ponStageId: 'pon-stage-9',
  ponNo: 9,
  scopeStatus: 'included',
  rowVersion: 5,
  milestones: {
    civil_complete: evidence(18),
    optical_complete: evidence(19),
    testing_passed: evidence(20),
    port_submitted: evidence(21),
  },
};

export const registerResult: ZoneRegisterResult = {
  summary: {
    zones: 4,
    includedPons: 14,
    livePons: 11,
    readyForQa: 2,
    handedOver: 1,
  },
  rows: [{
    projectId: PROJECT_ID,
    projectName: 'Etwatwa',
    zoneNo: 12,
    status: 'awaiting_port_approval',
    includedPons: 9,
    livePons: 8,
    earliestIncompleteGate: 'port_approved',
    blockerCount: 2,
    civilQa: 'passed',
    opticalQa: 'in_progress',
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
    id: 'doc-test-pack',
    documentType: 'test_pack',
    ponStageId: 'pon-stage-9',
    url: '/storage/zone-delivery/test-pack-pon-9.pdf',
    checksumSha256: 'test-pack-checksum-009',
    active: true,
  },
  {
    id: 'doc-fac',
    documentType: 'fac',
    url: '/storage/zone-delivery/fac-zone-12.pdf',
    checksumSha256: 'fac-checksum-zone-12',
    active: true,
  },
  {
    id: 'doc-cac',
    documentType: 'cac',
    url: '/storage/zone-delivery/cac-zone-12.pdf',
    checksumSha256: 'cac-checksum-zone-12',
    active: true,
  },
];

export const activeZone: ZoneDeliveryView = {
  projectId: PROJECT_ID,
  projectName: 'Etwatwa',
  zoneNo: 12,
  pons: [livePon, pendingPon],
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
  documents,
  status: 'handover_blocked',
  blockers: [
    {
      code: 'PON_PORT_NOT_APPROVED',
      message: 'PON 9 is waiting for supervised port approval.',
      ponNo: 9,
      entityId: 'pon-stage-9',
    },
    {
      code: 'OPEN_HANDOVER_SNAGS',
      message: 'Blocking snag SNAG-900 remains open.',
      ponNo: 9,
      entityId: 'snag-900',
    },
  ],
  eligibleForZoneQaAt: '2026-07-24T07:30:00.000Z',
  handedOverAt: null,
  rowVersion: 11,
};

const handedOverPons = [livePon, {
  ...pendingPon,
  milestones: {
    ...pendingPon.milestones,
    port_approved: evidence(26),
    technically_live: evidence(27),
  },
}];

export const handedOverZone: ZoneDeliveryView = {
  ...activeZone,
  pons: handedOverPons,
  civilQa: { ...activeZone.civilQa, status: 'passed' },
  opticalQa: {
    ...activeZone.opticalQa,
    status: 'passed',
    effectiveAt: '2026-07-27T09:30:00.000Z',
    notes: 'Optical repair accepted.',
  },
  status: 'handed_over',
  blockers: [],
  handedOverAt: '2026-07-28T10:15:00.000Z',
  rowVersion: 14,
};

export const activity: ZoneDeliveryActivity[] = [
  {
    id: 'activity-1',
    action: 'milestone_reopened',
    effectiveAt: '2026-07-25T10:00:00.000Z',
    recordedAt: '2026-07-25T10:12:00.000Z',
    actorEmail: 'operations@velocityfibre.co.za',
    permission: 'construction-qa.zone-delivery.operations-confirm',
    source: 'site instruction SI-204',
    reason: 'Port label mismatch found during audit.',
    previousValue: { portApproved: true },
    newValue: { portApproved: false, snagId: 'snag-900' },
  },
];

export const handedOverActivity: ZoneDeliveryActivity[] = [{
  ...activity[0],
  id: 'activity-2',
  action: 'post_handover_maintenance_linked',
  effectiveAt: '2026-07-29T06:00:00.000Z',
  recordedAt: '2026-07-29T06:05:00.000Z',
  reason: 'Non-blocking maintenance observation.',
  previousValue: null,
  newValue: { snagId: 'snag-maint-22', blocking: false },
}];
