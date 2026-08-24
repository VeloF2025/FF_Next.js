/**
 * The whole release path, over randomised configurations, judged by the
 * independent oracle.
 *
 * Every finding this module has had — five across three reviews — was a shape
 * nobody wrote down by hand: a relation that was not modelled, a filter that
 * dropped the relation carrying the leak, a denominator column publishing a
 * withheld value. A hand-written fixture only ever defends the attack you
 * already know about, so this sweep is what actually holds the line.
 *
 * The generator covers every family that carries a relation: presence, incident
 * types and their outcomes, driver input, and the reliability ratios. Numerators
 * are plausible but immaterial — both the release path and the oracle reason
 * about SUPPORT, never about the numbers.
 */
import { describe, expect, it } from 'vitest';
import { releaseAnonymousGroups } from '../suppression';
import { derivableLeaks } from './derivabilityOracle';
import { configurationFor } from './randomConfigurations';

const K = 5;

describe('nothing below the threshold is derivable, over randomised configurations', () => {
  it('holds across 450 seeds of every relation-carrying metric family', () => {
    let checked = 0;
    for (let seed = 1; seed <= 450; seed += 1) {
      const groups = configurationFor(seed);
      const leaks = derivableLeaks(groups, releaseAnonymousGroups(groups, K), K);
      if (leaks.length > 0) throw new Error(`seed ${seed}: ${leaks.join('; ')}`);
      checked += 1;
    }
    expect(checked).toBe(450);
  });
});
