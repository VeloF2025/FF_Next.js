/**
 * One named case per disclosure the second blind review of PR #2604 reproduced.
 *
 * Each pins the seed the randomised sweep first failed on when the fix is taken
 * out again, so the test says which mechanism it defends rather than merely that
 * the sweep is green. The configurations come from the shared generator: a
 * transcribed copy of eighty groups would say nothing a reader could check, and
 * would drift from the generator the sweep actually runs.
 */
import { describe, expect, it } from 'vitest';
import { releaseAnonymousGroups } from '../suppression';
import { derivableLeaks } from './derivabilityOracle';
import { configurationFor } from './randomConfigurations';

const K = 5;

const leaksAt = (seed: number): string[] => {
  const groups = configurationFor(seed);
  return derivableLeaks(groups, releaseAnonymousGroups(groups, K), K);
};

describe('a relation with no known variable is still a constraint', () => {
  /**
   * The first version admitted a relation into the system only if one of its
   * variables was already known, which reads as harmless and is not. An
   * anchorless relation hands over no number BY ITSELF; added to an anchored one
   * it pins something neither could pin alone. Restore the filter and this seed
   * hands `incident.late` at project p0 over whole, to three people.
   *
   * The test belongs after elimination, on the reduced row, where "did the
   * published rows give this away" can actually be asked.
   */
  it('does not drop the constraint that closes the chain (seed 1)', () => {
    expect(leaksAt(1)).toEqual([]);
  });
});

describe('incidents nobody reviewed are a quantity with people behind them', () => {
  /**
   * `applyIncident` bumps `outcome.reviewed_total` only where an incident HAS an
   * outcome, and `incident.total` on every incident. The difference is the
   * unreviewed ones — no metric key, no partition, and until this was modelled,
   * no rule that could see it. Remove the pair and this seed leaves two withheld
   * incident cells whose sum is pinned, over four people.
   */
  it('models incident.total as a superset of outcome.reviewed_total (seed 19)', () => {
    expect(leaksAt(19)).toEqual([]);
  });
});

describe('a published row prints its denominator', () => {
  /**
   * A withheld population can be sitting in full in the `denominator` column of
   * a row that survived beside it — `input.requests_sent` inside the
   * `input.responses_received` row, `incident.total` inside
   * `reliability.recurrence`. Treat a variable as known only when its own row is
   * published and this seed hands over two complements outright, each describing
   * one person.
   *
   * The carrier map is derived from `metricCalculator`'s `DENOMINATOR_OF` rather
   * than restated, so a metric that acquires a denominator cannot slip past.
   */
  it('knows a population from the row that carries it (seed 37)', () => {
    expect(leaksAt(37)).toEqual([]);
  });
});
