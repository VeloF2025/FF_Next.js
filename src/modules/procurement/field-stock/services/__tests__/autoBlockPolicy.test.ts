/**
 * Unit tests for autoBlockPolicy (pure threshold logic, Tier 3.2 / SOP-4.4).
 * No DB — exercises the decision + reason-formatting in isolation.
 */
import { describe, it, expect } from 'vitest';
import {
  type AutoBlockPolicy,
  DEFAULT_AUTO_BLOCK_POLICY,
  evaluateAutoBlock,
  formatBlockReason,
} from '../autoBlockPolicy';

const ENABLED: AutoBlockPolicy = {
  enabled: true,
  agedCountThreshold: 3,
  agedValueThreshold: 5000,
};

describe('DEFAULT_AUTO_BLOCK_POLICY', () => {
  it('ships disabled (feature is off until deliberately armed)', () => {
    expect(DEFAULT_AUTO_BLOCK_POLICY.enabled).toBe(false);
  });
});

describe('evaluateAutoBlock', () => {
  it('never blocks when the policy is disabled, even far over threshold', () => {
    const decision = evaluateAutoBlock(
      { ...ENABLED, enabled: false },
      { agedCount: 99, agedValue: 999999 },
    );
    expect(decision.block).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it('does not block below both thresholds', () => {
    const decision = evaluateAutoBlock(ENABLED, { agedCount: 2, agedValue: 4999.99 });
    expect(decision.block).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it('blocks on count threshold (inclusive >=)', () => {
    const decision = evaluateAutoBlock(ENABLED, { agedCount: 3, agedValue: 0 });
    expect(decision.block).toBe(true);
    expect(decision.reasons).toHaveLength(1);
    expect(decision.reasons[0]).toContain('aged count 3 ≥ 3');
  });

  it('blocks on value threshold (inclusive >=) independently of count', () => {
    const decision = evaluateAutoBlock(ENABLED, { agedCount: 1, agedValue: 5000 });
    expect(decision.block).toBe(true);
    expect(decision.reasons).toHaveLength(1);
    expect(decision.reasons[0]).toContain('aged value R5000.00 ≥ R5000.00');
  });

  it('reports BOTH reasons when count and value both trip', () => {
    const decision = evaluateAutoBlock(ENABLED, { agedCount: 5, agedValue: 7200 });
    expect(decision.block).toBe(true);
    expect(decision.reasons).toHaveLength(2);
  });
});

describe('formatBlockReason', () => {
  it('encodes the metrics and tripped thresholds', () => {
    const metrics = { agedCount: 4, agedValue: 5200 };
    const decision = evaluateAutoBlock(ENABLED, metrics);
    const reason = formatBlockReason(metrics, decision);
    expect(reason).toContain('Auto-blocked (SOP-4.4)');
    expect(reason).toContain('4 aged unaccounted serial(s)');
    expect(reason).toContain('R5200.00');
    expect(reason).toContain('aged count 4 ≥ 3');
  });
});
