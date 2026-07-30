import { describe, expect, it } from 'vitest';
import type { PonMilestone } from '../../types/zoneDelivery.types';
import { calculatePonActions } from '../zoneDeliveryActionCalculator';

const gates: PonMilestone[] = [
  'civil_complete',
  'optical_complete',
  'testing_passed',
  'port_submitted',
  'port_approved',
  'technically_live',
];

const input = () => ({
  ponStageId: '47000000-0000-4000-8000-000000000001',
  ponNo: 1,
  scopeApproved: true,
  scopeStatus: 'included' as const,
  handedOver: false,
  milestones: {} as Partial<Record<PonMilestone, { effectiveAt: string }>>,
  civilQaApproved: false,
  opticalQaApproved: false,
  hasActiveTestPack: false,
  reconfirmationBlockers: [] as Array<{ gate: PonMilestone; status: string }>,
});

describe('calculatePonActions', () => {
  it('returns server-authoritative evidence blockers for civil, optical, and testing', () => {
    const civil = calculatePonActions(input());
    expect(civil.civil_complete).toEqual({
      action: 'confirm',
      enabled: false,
      blocker: expect.objectContaining({
        code: 'CIVIL_QA_INCOMPLETE',
        entityId: input().ponStageId,
      }),
    });

    const opticalInput = input();
    opticalInput.civilQaApproved = true;
    opticalInput.milestones.civil_complete = { effectiveAt: '2026-07-01T00:00:00.000Z' };
    const optical = calculatePonActions(opticalInput);
    expect(optical.optical_complete.blocker).toMatchObject({
      code: 'OPTICAL_QA_INCOMPLETE',
      entityId: input().ponStageId,
    });

    const testingInput = input();
    testingInput.civilQaApproved = true;
    testingInput.opticalQaApproved = true;
    testingInput.milestones.civil_complete = { effectiveAt: '2026-07-01T00:00:00.000Z' };
    testingInput.milestones.optical_complete = { effectiveAt: '2026-07-02T00:00:00.000Z' };
    const testing = calculatePonActions(testingInput);
    expect(testing.testing_passed.blocker).toMatchObject({
      code: 'TEST_PACK_MISSING',
      entityId: input().ponStageId,
    });
  });

  it('returns one action for every milestone without deriving gates in React', () => {
    const ready = input();
    ready.civilQaApproved = true;
    ready.opticalQaApproved = true;
    ready.hasActiveTestPack = true;
    for (const gate of gates) {
      const actions = calculatePonActions(ready);
      expect(Object.keys(actions)).toEqual(gates);
      const current = actions[gate];
      expect(current.action).toBe('confirm');
      if (current.enabled) {
        ready.milestones[gate] = { effectiveAt: '2026-07-01T00:00:00.000Z' };
      }
    }
    const completed = calculatePonActions(ready);
    expect(gates.every(gate =>
      completed[gate].action === 'reopen'
      && completed[gate].enabled
      && completed[gate].blocker === null)).toBe(true);
  });

  it('uses the same scope, prerequisite, and reconfirmation blockers as commands', () => {
    const pendingScope = input();
    pendingScope.scopeApproved = false;
    expect(calculatePonActions(pendingScope).civil_complete.blocker).toMatchObject({
      code: 'SCOPE_NOT_APPROVED',
    });

    const prerequisite = input();
    prerequisite.civilQaApproved = true;
    expect(calculatePonActions(prerequisite).optical_complete.blocker).toMatchObject({
      code: 'PON_CIVIL_INCOMPLETE',
    });

    const reconfirmation = input();
    reconfirmation.civilQaApproved = true;
    reconfirmation.reconfirmationBlockers = [{ gate: 'civil_complete', status: 'open' }];
    expect(calculatePonActions(reconfirmation).civil_complete.blocker).toMatchObject({
      code: 'SNAG_RECONFIRMATION_BLOCKED',
    });
  });
});
