import { describe, it, expect } from 'vitest';
import { METRICS, findMetric } from '../index';

describe('metric registry', () => {
  it('exposes every metric with a unique key', () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('requires a citation source on every metric', () => {
    for (const m of METRICS) expect(m.cite, `${m.key} missing cite`).toBeTruthy();
  });

  it('requires at least one alias so intent matching can work', () => {
    for (const m of METRICS) expect(m.aliases.length, `${m.key} has no aliases`).toBeGreaterThan(0);
  });

  it('declares only dimensions that exist in the dimension registry', async () => {
    const { DIMENSIONS } = await import('../../dimensions/canonical');
    const known = new Set(DIMENSIONS.map((d) => d.key));
    for (const m of METRICS) {
      for (const d of m.dimensions) {
        expect(known.has(d), `${m.key} declares unknown dim ${d}`).toBe(true);
      }
    }
  });

  it('declares an explicit additivity on every metric', () => {
    // There is no default: the whole point of the field is that guessing is what
    // produced the 91,296-vs-23,732 bug. A metric added without one must fail here
    // rather than inherit a silent 'additive'.
    for (const m of METRICS) {
      expect(['additive', 'semi-additive', 'non-additive'], `${m.key}`).toContain(m.additivity);
    }
  });

  it('never offers the range grain on a metric that cannot be summed over time', () => {
    // Declaring 'range' on a semi-additive metric would be a contradiction the
    // builder then has to reject at request time; catch it at registration.
    for (const m of METRICS) {
      if (m.additivity !== 'additive') {
        expect(m.grains, `${m.key} is ${m.additivity} but offers 'range'`).not.toContain('range');
      }
    }
  });

  it('finds a metric by key and returns undefined otherwise', () => {
    expect(findMetric('zone_uptake')?.key).toBe('zone_uptake');
    expect(findMetric('nope')).toBeUndefined();
  });
});
