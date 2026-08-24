/**
 * `partitionSacrifices` as a unit, and the randomised property over the release
 * path as a whole.
 *
 * Split out of `partitionSuppression.test.ts`, which had grown past the file
 * limit. What stayed there are the named reproductions; what moved here is the
 * contract of the pure function and the search that keeps finding shapes nobody
 * thought to write down by hand.
 */
import { describe, expect, it } from 'vitest';
import { releaseAnonymousGroups } from '../suppression';
import { partitionSacrifices } from '../metricPartitions';
import type { CalculatedMetricGroup } from '../facts';
import type { OperationsMetricKey } from '../aggregateSchema';
import { derivableLeaks } from './derivabilityOracle';

const MONTH = '2026-07-01';
const K = 5;

function group(
  metricKey: OperationsMetricKey, projectId: string, operationalSiteId: string,
  contributors: string[], numerator: number, denominator: number | null = null,
): CalculatedMetricGroup {
  return {
    monthStart: MONTH, metricVersion: 1, projectId, operationalSiteId, metricKey,
    numerator, denominator, histogram: null, contributors: new Set(contributors),
  };
}

const people = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

/**
 * The presence-only search ran 20,000 configurations while it was the only
 * randomised sweep there was. `derivabilityProperty.test.ts` now covers every
 * relation-carrying family, over an oracle that solves the system exactly, so
 * this one is cut to 4,000 — enough to keep watching the presence partition
 * specifically, cheap enough that both can run on every change.
 *
 * `releaseAnonymousGroups` only ever publishes a cell whose support already
 * clears the threshold, so through that path one sacrifice always covers the
 * residual. `partitionSacrifices` makes no such assumption about its input —
 * it is a pure function over whatever candidates it is handed — so its own
 * contract is pinned here rather than only through its caller.
 */
describe('partitionSacrifices as a unit', () => {
  function candidate(metricKey: OperationsMetricKey, contributors: string[], published: boolean) {
    return { metricKey, contributors: new Set(contributors), published };
  }

  it('keeps sacrificing until the residual clears, not merely once', () => {
    const sacrifices = partitionSacrifices([
      candidate('presence.scheduled_days', people('t', 9), true),
      candidate('presence.confirmed_days', ['t-0', 't-1'], true),
      candidate('presence.vehicle_only_days', ['t-2', 't-3'], true),
      candidate('presence.unconfirmed_days', ['t-4'], false),
    ], K);
    // One sacrifice leaves a residual of three; both are needed to reach five.
    expect(sacrifices).toContain('presence.confirmed_days');
    expect(sacrifices).toContain('presence.vehicle_only_days');
  });

  it('sacrifices nothing when the total cannot be known', () => {
    expect(partitionSacrifices([
      candidate('outcome.confirmed', people('u', 9), false),
      candidate('outcome.duplicate', ['u-0'], false),
    ], K)).toEqual([]);
  });

  it('gives up the total itself when the members cannot cover the residual', () => {
    const sacrifices = partitionSacrifices([
      candidate('presence.scheduled_days', people('v', 9), true),
      candidate('presence.unconfirmed_days', ['v-0'], false),
    ], K);
    expect(sacrifices).toContain('presence.scheduled_days');
  });

  it('gives up a reliability carrier that would publish the incident total', () => {
    const sacrifices = partitionSacrifices([
      candidate('reliability.evidence_available', people('w', 9), true),
      candidate('incident.accident_sos', ['w-0'], false),
    ], K);
    expect(sacrifices).toContain('reliability.evidence_available');
  });
});

describe('the property over randomised configurations', () => {
  /** Deterministic PRNG — a seeded run is reproducible, unlike Math.random. */
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  it('never leaves a recoverable residual across 4000 random presence partitions', () => {
    const random = makeRandom(20260824);
    const members: OperationsMetricKey[] = [
      'presence.confirmed_days', 'presence.unconfirmed_days', 'presence.vehicle_only_days',
    ];
    let checked = 0;
    for (let iteration = 0; iteration < 4_000; iteration += 1) {
      const siteCount = 1 + Math.floor(random() * 3);
      const groups: CalculatedMetricGroup[] = [];
      for (let site = 0; site < siteCount; site += 1) {
        const roster = people(`s${site}`, 1 + Math.floor(random() * 8));
        groups.push(group('presence.scheduled_days', 'p1', `s${site}`, roster, roster.length * 20));
        for (const member of members) {
          const size = Math.floor(random() * (roster.length + 1));
          if (size === 0) continue;
          groups.push(group(member, 'p1', `s${site}`, roster.slice(0, size), size * 3, roster.length * 20));
        }
      }
      const violations = derivableLeaks(groups, releaseAnonymousGroups(groups, K), K);
      if (violations.length > 0) {
        throw new Error(`iteration ${iteration}: ${violations.join('; ')}`);
      }
      checked += 1;
    }
    expect(checked).toBe(4_000);
  });
});
