import { describe, it, expect } from 'vitest';
import { decideGapReason, type GapInput } from '../gapReason';

const HOUR = 3_600_000;
const base: GapInput = {
  granularity: 'snapshot',
  portalVehicleCount: 10,
  activeTrackers: 6,
  matchedNone: false,
  deactivationSuppressed: false,
  positionCount: 6,
  feedAgeMs: 30 * 60 * 1000,
  staleFeedMs: 6 * HOUR,
};
const reason = (over: Partial<GapInput> = {}) => decideGapReason({ ...base, ...over });

describe('decideGapReason', () => {
  it('is silent on a healthy tick', () => {
    expect(reason()).toBeNull();
  });

  // Nothing is mapped yet, so there is nothing to be missing.
  it('is silent when no trackers are mapped at all', () => {
    expect(reason({ activeTrackers: 0, portalVehicleCount: 0, positionCount: 0 })).toBeNull();
  });

  it('reports an empty vehicle list ahead of anything downstream of it', () => {
    // An empty list explains the zero positions too; naming the symptom instead
    // of the cause sends whoever reads the alert looking in the wrong place.
    expect(reason({ portalVehicleCount: 0, positionCount: 0, matchedNone: true }))
      .toMatch(/empty vehicle list/);
  });

  it('reports a list that matched nothing', () => {
    expect(reason({ matchedNone: true })).toMatch(/none could be mapped/);
  });

  it('reports the wholesale-unmapping brake', () => {
    expect(reason({ deactivationSuppressed: true })).toMatch(/refused to unmap/);
  });
});

/**
 * The distinction the whole module exists for. A snapshot provider hands back
 * the same stale fix forever, so absence of data cannot detect an outage;
 * staleness of the account can. For history providers it is the reverse.
 */
describe('decideGapReason — granularity decides what "no data" means', () => {
  it('a snapshot provider with zero positions is NOT a gap on that alone', () => {
    expect(reason({ granularity: 'snapshot', positionCount: 0 })).toBeNull();
  });

  it('a history provider with zero positions IS a gap', () => {
    expect(reason({ granularity: 'history', positionCount: 0, feedAgeMs: null }))
      .toMatch(/returned no positions/);
  });

  it('a stale account is a gap for a snapshot provider even while positions flow', () => {
    // The exact regression the old empty-array check could not see.
    expect(reason({ granularity: 'snapshot', positionCount: 6, feedAgeMs: 8 * HOUR }))
      .toMatch(/feed is stale/);
  });

  it('reports the staleness in hours so the alert is actionable', () => {
    expect(reason({ feedAgeMs: 30 * HOUR })).toContain('30h old');
  });

  it('is silent exactly at the threshold, and fires just past it', () => {
    expect(reason({ feedAgeMs: 6 * HOUR })).toBeNull();
    expect(reason({ feedAgeMs: 6 * HOUR + 1 })).toMatch(/feed is stale/);
  });

  it('ignores staleness when the provider offers no probe', () => {
    expect(reason({ feedAgeMs: null })).toBeNull();
  });
});
