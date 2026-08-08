import { describe, expect, it } from 'vitest';

import type { PonActionInput } from '../zoneDeliveryActionCalculator';
import { blockerIgnoringSequence, calculatePonActions } from '../zoneDeliveryActionCalculator';

const base = (over: Partial<PonActionInput> = {}): PonActionInput => ({
  ponStageId: '22222222-2222-4222-8222-222222222222',
  ponNo: 191,
  scopeApproved: true,
  scopeStatus: 'included',
  handedOver: false,
  milestones: {},
  civilQaApproved: false,
  opticalQaApproved: false,
  hasActiveTestPack: false,
  reconfirmationBlockers: [],
  ...over,
});

describe('blockerIgnoringSequence — what an authorised override may NOT bypass', () => {
  it('clears a pure sequencing gate (Johan: Submit PON on a legacy PON)', () => {
    // port_submitted's only obstacle is that testing_passed was never recorded.
    const input = base();
    expect(calculatePonActions(input).port_submitted.blocker?.code)
      .toBe('PON_TESTING_INCOMPLETE');

    expect(blockerIgnoringSequence(input, 'port_submitted')).toBeNull();
  });

  it('still reports a missing test pack once sequence is waived', () => {
    // Without this, overriding testing_passed's PON_OPTICAL_INCOMPLETE would
    // confirm testing with no test pack at all — the evidence check sits AFTER
    // the sequence check and would never have been reached.
    const input = base();
    expect(calculatePonActions(input).testing_passed.blocker?.code)
      .toBe('PON_OPTICAL_INCOMPLETE');

    expect(blockerIgnoringSequence(input, 'testing_passed')?.code).toBe('TEST_PACK_MISSING');
  });

  it('still reports missing optical QA once sequence is waived', () => {
    const input = base();
    expect(blockerIgnoringSequence(input, 'optical_complete')?.code)
      .toBe('OPTICAL_QA_INCOMPLETE');
  });

  it('still reports missing civil QA (first gate — no sequence involved)', () => {
    expect(blockerIgnoringSequence(base(), 'civil_complete')?.code).toBe('CIVIL_QA_INCOMPLETE');
  });

  it('never waives a terminal handover', () => {
    expect(blockerIgnoringSequence(base({ handedOver: true }), 'port_submitted')?.code)
      .toBe('HANDOVER_LOCKED');
  });

  it('never waives an unapproved scope', () => {
    expect(blockerIgnoringSequence(base({ scopeApproved: false }), 'port_submitted')?.code)
      .toBe('SCOPE_NOT_APPROVED');
  });

  it('never waives an open snag reconfirmation', () => {
    const input = base({
      reconfirmationBlockers: [{ gate: 'port_submitted', status: 'open' }],
    });
    expect(blockerIgnoringSequence(input, 'port_submitted')?.code)
      .toBe('SNAG_RECONFIRMATION_BLOCKED');
  });

  it('does not mutate the caller\'s milestone map', () => {
    const input = base();
    blockerIgnoringSequence(input, 'technically_live');
    expect(input.milestones).toEqual({});
  });
});
