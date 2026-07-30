import type {
  PonDeliveryView,
  ZoneDeliveryActivity,
  ZoneDeliveryView,
} from '../../types/zoneDelivery.types';

export const projectId = '11111111-1111-4111-8111-111111111111';
export const ponStageId = '22222222-2222-4222-8222-222222222222';
export const snagId = '33333333-3333-4333-8333-333333333333';
export const actionFixture = (completed = false): PonDeliveryView['actions'] => ({
  civil_complete: { action: completed ? 'reopen' : 'confirm', enabled: true, blocker: null },
  optical_complete: { action: completed ? 'reopen' : 'confirm', enabled: true, blocker: null },
  testing_passed: { action: completed ? 'reopen' : 'confirm', enabled: true, blocker: null },
  port_submitted: { action: completed ? 'reopen' : 'confirm', enabled: true, blocker: null },
  port_approved: { action: completed ? 'reopen' : 'confirm', enabled: true, blocker: null },
  technically_live: { action: completed ? 'reopen' : 'confirm', enabled: true, blocker: null },
});

export const zoneFixture: ZoneDeliveryView = {
  projectId,
  projectName: 'Etwatwa',
  zoneNo: 12,
  scopeApproved: true,
  pons: [
    {
      ponStageId,
      ponNo: 4,
      scopeStatus: 'included',
      scopeReason: null,
      rowVersion: 7,
      actions: actionFixture(true),
      milestones: {
        civil_complete: {
          effectiveAt: '2026-07-01T08:00:00.000Z',
          actorEmail: 'civil@example.com',
          source: 'Works QA inspection',
        },
        optical_complete: {
          effectiveAt: '2026-07-02T08:00:00.000Z',
          actorEmail: 'optical@example.com',
          source: 'Works QA inspection',
        },
        testing_passed: {
          effectiveAt: '2026-07-03T08:00:00.000Z',
          actorEmail: 'test@example.com',
          source: 'EXFO result',
        },
        port_submitted: {
          effectiveAt: '2026-07-04T08:00:00.000Z',
          actorEmail: 'ops@example.com',
          source: 'OES submission',
        },
        port_approved: {
          effectiveAt: '2026-07-05T08:00:00.000Z',
          actorEmail: 'ops@example.com',
          source: 'OES approval',
        },
        technically_live: {
          effectiveAt: '2026-07-06T08:00:00.000Z',
          actorEmail: 'ops@example.com',
          source: 'Operations confirmation',
        },
      },
    },
    {
      ponStageId: '44444444-4444-4444-8444-444444444444',
      ponNo: 5,
      scopeStatus: 'excluded',
      scopeReason: 'Not built',
      rowVersion: 3,
      actions: actionFixture(),
      milestones: {},
    },
    {
      ponStageId: '55555555-5555-4555-8555-555555555555',
      ponNo: 6,
      scopeStatus: 'cancelled',
      scopeReason: 'Removed',
      rowVersion: 2,
      actions: actionFixture(),
      milestones: {},
    },
  ],
  civilQa: {
    status: 'passed',
    effectiveAt: '2026-07-07T08:00:00.000Z',
    approverEmail: 'civil.qa@example.com',
    notes: 'Civil inspected',
  },
  opticalQa: {
    status: 'failed',
    effectiveAt: '2026-07-08T08:00:00.000Z',
    approverEmail: 'optical.qa@example.com',
    notes: 'Repair splice tray',
  },
  documents: [
    {
      id: 'fac-1',
      documentType: 'fac',
      sourceRef: '/storage/fac.pdf',
      url: '/storage/fac.pdf',
      checksumSha256: 'a'.repeat(64),
      active: true,
    },
    {
      id: 'cac-1',
      documentType: 'cac',
      sourceRef: '/storage/cac.pdf',
      url: '/storage/cac.pdf',
      checksumSha256: 'b'.repeat(64),
      active: true,
    },
    {
      id: 'test-1',
      documentType: 'test_pack',
      ponStageId,
      sourceRef: '/storage/test-pack.pdf',
      url: '/storage/test-pack.pdf',
      checksumSha256: 'c'.repeat(64),
      active: true,
    },
  ],
  status: 'handover_blocked',
  blockers: [
    {
      code: 'OPEN_HANDOVER_SNAGS',
      message: '1 open handover-blocking snag(s)',
      ponNo: 4,
      entityId: snagId,
    },
  ],
  eligibleForZoneQaAt: '2026-07-06T08:00:00.000Z',
  handedOverAt: null,
  rowVersion: 11,
};

export const activityFixture: ZoneDeliveryActivity[] = [
  {
    id: 'activity-1',
    action: 'scope_updated',
    effectiveAt: '2026-07-01T10:00:00.000Z',
    recordedAt: '2026-07-01T12:00:00.000Z',
    actorEmail: 'manager@example.com',
    permission: 'construction-qa.zone-delivery.scope-manage',
    source: 'Approved construction schedule',
    reason: 'Historical backfill',
    previousValue: { scopeStatus: 'included' },
    newValue: { scopeStatus: 'excluded', scopeReason: 'Wayleave withdrawn' },
  },
];
