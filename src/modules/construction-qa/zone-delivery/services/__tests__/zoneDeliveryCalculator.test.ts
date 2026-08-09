import { describe, expect, it } from 'vitest';

import { calculateZoneDelivery } from '../zoneDeliveryCalculator';
import type {
  PonDeliveryView,
  PonMilestone,
  ZoneDeliveryInput,
} from '../../types/zoneDelivery.types';

const milestoneOrder: PonMilestone[] = [
  'civil_complete',
  'optical_complete',
  'testing_passed',
  'port_submitted',
  'port_approved',
  'technically_live',
];

function createPon(
  ponNo: number,
  completedMilestones: PonMilestone[] = [],
  scopeStatus: PonDeliveryView['scopeStatus'] = 'included'
): PonDeliveryView {
  return {
    ponStageId: `pon-${ponNo}`,
    ponNo,
    scopeStatus,
    milestones: Object.fromEntries(
      completedMilestones.map((milestone) => [
        milestone,
        {
          effectiveAt: '2026-07-30T10:00:00.000Z',
          actorEmail: 'qa@fibreflow.app',
          source: 'test',
        },
      ])
    ),
    rowVersion: 1,
  };
}

function createInput(overrides: Partial<ZoneDeliveryInput> = {}): ZoneDeliveryInput {
  return {
    scopeApproved: true,
    pons: [createPon(1)],
    civilQa: 'not_started',
    opticalQa: 'not_started',
    hasFac: false,
    hasCac: false,
    openBlockingSnags: 0,
    handedOverAt: null,
    ...overrides,
  };
}

describe('calculateZoneDelivery', () => {
  it.each([
    {
      name: 'an unapproved scope',
      input: createInput({ scopeApproved: false }),
      status: 'scope_pending',
      gate: null,
      blockerCodes: ['SCOPE_NOT_APPROVED'],
      eligibleForZoneQa: false,
    },
    {
      name: 'an approved scope with no included PONs',
      input: createInput({ pons: [] }),
      status: 'scope_pending',
      gate: null,
      blockerCodes: ['EMPTY_INCLUDED_SCOPE'],
      eligibleForZoneQa: false,
    },
    {
      name: 'a scope containing only excluded and cancelled PONs',
      input: createInput({
        pons: [createPon(1, milestoneOrder, 'excluded'), createPon(2, [], 'cancelled')],
      }),
      status: 'scope_pending',
      gate: null,
      blockerCodes: ['EMPTY_INCLUDED_SCOPE'],
      eligibleForZoneQa: false,
    },
  ])(
    'returns scope pending for $name',
    ({ input, status, gate, blockerCodes, eligibleForZoneQa }) => {
      const result = calculateZoneDelivery(input);

      expect(result).toMatchObject({
        status,
        earliestIncompleteGate: gate,
        eligibleForZoneQa,
        eligibleForHandover: false,
      });
      expect(result.blockers.map((blocker) => blocker.code)).toEqual(blockerCodes);
    }
  );

  it.each([
    ['civil construction', [], 'civil_complete', 'civil_construction', 'PON_CIVIL_INCOMPLETE'],
    [
      'optical construction',
      ['civil_complete'],
      'optical_complete',
      'optical_construction',
      'PON_OPTICAL_INCOMPLETE',
    ],
    [
      'testing',
      ['civil_complete', 'optical_complete'],
      'testing_passed',
      'testing_in_progress',
      'PON_TESTING_INCOMPLETE',
    ],
    [
      'port submission',
      ['civil_complete', 'optical_complete', 'testing_passed'],
      'port_submitted',
      'ready_for_port_submission',
      'PON_PORT_NOT_SUBMITTED',
    ],
    [
      'port approval',
      ['civil_complete', 'optical_complete', 'testing_passed', 'port_submitted'],
      'port_approved',
      'awaiting_port_approval',
      'PON_PORT_NOT_APPROVED',
    ],
    [
      'go live',
      ['civil_complete', 'optical_complete', 'testing_passed', 'port_submitted', 'port_approved'],
      'technically_live',
      'go_live_in_progress',
      'PON_NOT_LIVE',
    ],
  ] as const)(
    'returns the actionable %s stage for the first missing PON gate',
    (_name, completedMilestones, earliestIncompleteGate, status, blockerCode) => {
      const result = calculateZoneDelivery(
        createInput({
          pons: [createPon(12, [...completedMilestones])],
        })
      );

      expect(result).toMatchObject({
        status,
        earliestIncompleteGate,
        eligibleForZoneQa: false,
        eligibleForHandover: false,
      });
      expect(result.blockers).toEqual([expect.objectContaining({ code: blockerCode, ponNo: 12 })]);
    }
  );

  it('uses the earliest unfinished PON gate for mixed progress', () => {
    const result = calculateZoneDelivery(
      createInput({
        pons: [createPon(1, milestoneOrder), createPon(2, ['civil_complete'])],
      })
    );

    expect(result).toMatchObject({
      status: 'optical_construction',
      earliestIncompleteGate: 'optical_complete',
      eligibleForZoneQa: false,
    });
    expect(result.blockers).toEqual([
      expect.objectContaining({ code: 'PON_OPTICAL_INCOMPLETE', ponNo: 2 }),
    ]);
  });

  it.each([
    [
      'not started',
      'not_started',
      'not_started',
      'ready_for_zone_qa',
      ['CIVIL_ZONE_QA_NOT_PASSED', 'OPTICAL_ZONE_QA_NOT_PASSED'],
    ],
    [
      'in progress',
      'in_progress',
      'not_started',
      'zone_qa_in_progress',
      ['CIVIL_ZONE_QA_NOT_PASSED', 'OPTICAL_ZONE_QA_NOT_PASSED'],
    ],
    ['failed', 'passed', 'failed', 'zone_qa_in_progress', ['OPTICAL_ZONE_QA_NOT_PASSED']],
  ] as const)(
    'keeps the two QA disciplines separate when %s',
    (_name, civilQa, opticalQa, status, blockerCodes) => {
      const result = calculateZoneDelivery(
        createInput({
          pons: [createPon(3, milestoneOrder)],
          civilQa,
          opticalQa,
        })
      );

      expect(result).toMatchObject({
        status,
        earliestIncompleteGate: null,
        eligibleForZoneQa: true,
        eligibleForHandover: false,
      });
      expect(result.blockers.map((blocker) => blocker.code)).toEqual(blockerCodes);
    }
  );

  it('blocks handover on missing FAC, CAC, and open snags after both QA disciplines pass', () => {
    const result = calculateZoneDelivery(
      createInput({
        pons: [createPon(4, milestoneOrder)],
        civilQa: 'passed',
        opticalQa: 'passed',
        openBlockingSnags: 2,
      })
    );

    expect(result).toMatchObject({
      status: 'handover_blocked',
      earliestIncompleteGate: null,
      eligibleForZoneQa: true,
      eligibleForHandover: false,
    });
    expect(result.blockers).toEqual([
      expect.objectContaining({ code: 'FAC_MISSING', message: 'Active FAC is missing' }),
      expect.objectContaining({ code: 'CAC_MISSING', message: 'Active CAC is missing' }),
      expect.objectContaining({
        code: 'OPEN_HANDOVER_SNAGS',
        message: '2 open handover-blocking snag(s)',
      }),
    ]);
  });

  it('allows handover only at the transient all-clear state before the handover stamp', () => {
    const result = calculateZoneDelivery(
      createInput({
        pons: [createPon(5, milestoneOrder)],
        civilQa: 'passed',
        opticalQa: 'passed',
        hasFac: true,
        hasCac: true,
      })
    );

    expect(result).toEqual({
      status: 'zone_qa_in_progress',
      earliestIncompleteGate: null,
      blockers: [],
      eligibleForZoneQa: true,
      eligibleForHandover: true,
    });
  });

  it('makes a handover stamp terminal and clears obsolete blockers', () => {
    const result = calculateZoneDelivery(
      createInput({
        scopeApproved: false,
        pons: [],
        handedOverAt: '2026-07-30T12:00:00.000Z',
      })
    );

    expect(result).toEqual({
      status: 'handed_over',
      earliestIncompleteGate: null,
      blockers: [],
      eligibleForZoneQa: false,
      eligibleForHandover: false,
    });
  });
});

describe('an attested port_submitted does not report its predecessors as blockers', () => {
  const pon = (milestones: Record<string, unknown>) => ({
    ponStageId: '47000000-0000-4000-8000-000000000009',
    ponNo: 191,
    scopeStatus: 'included' as const,
    scopeReason: null,
    milestones,
    actions: {} as never,
    rowVersion: 1,
  });

  const zone = (pons: ReturnType<typeof pon>[]) => calculateZoneDelivery({
    scopeApproved: true,
    pons: pons as never,
    civilQa: 'not_started' as const,
    opticalQa: 'not_started' as const,
    hasFac: false,
    hasCac: false,
    openBlockingSnags: 0,
    handedOverAt: null,
  });

  it('reports the next outstanding gate, not a gap left behind an attested one', () => {
    // Johan submits a legacy PON whose testing was never captured. Saying
    // "testing is not passed" is a record-keeping gap, not work outstanding —
    // and it is rendered to operators as the zone's blocker.
    const result = zone([pon({ port_submitted: { effectiveAt: '2026-08-05T00:00:00Z' } })]);

    expect(result.blockers.map(b => b.code)).toEqual(['PON_PORT_NOT_APPROVED']);
    expect(result.earliestIncompleteGate).toBe('port_approved');
  });

  it('still reports the first gate for a PON with nothing recorded', () => {
    const result = zone([pon({})]);

    expect(result.blockers.map(b => b.code)).toEqual(['PON_CIVIL_INCOMPLETE']);
  });

  it('reports no PON blocker once technically live', () => {
    const result = zone([pon({
      technically_live: { effectiveAt: '2026-08-05T00:00:00Z' },
    })]);

    expect(result.blockers.map(b => b.code)).not.toContain('PON_NOT_LIVE');
  });
});
