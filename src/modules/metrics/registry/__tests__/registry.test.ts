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

describe('metrics restored from the deleted Cortex catalogue', () => {
  const RESTORED = ['activations', 'open_snags', 'open_tickets'];

  it('registers all three, so numeric questions stop falling through to prose', () => {
    // These answered precisely until Cortex #164 deleted its in-code catalogue. The
    // regression was silent: the question still parsed as numeric, matched nothing,
    // and was answered from RAG.
    for (const key of RESTORED) {
      expect(findMetric(key), `${key} is not registered`).toBeDefined();
    }
  });

  it('gives current-state metrics a null dateColumn and a periodic grain', () => {
    // dateColumn null makes buildMetricQuery emit no WHERE date filter and
    // `NULL::text AS period`, so the requested window is ignored — which is correct
    // for "how many are open right now". But 'range' is rejected for any non-additive
    // measure, so an unused periodic grain must still be declared or every query 400s.
    for (const key of ['open_snags', 'open_tickets']) {
      const m = findMetric(key)!;
      expect(m.dateColumn, `${key} must be current-state`).toBeNull();
      expect(m.additivity, `${key} is a stock`).toBe('semi-additive');
      expect(m.grains, `${key} needs a periodic grain`).not.toEqual([]);
      expect(m.grains, `${key} must not offer range`).not.toContain('range');
    }
  });

  it('does NOT register a pre-provision event count', () => {
    // dr_activity_log re-logs an unresolved item ~daily rather than once: for July it
    // yields 1,107 against 219 first-ever additions, a ~5x overcount. Restoring that SQL
    // would ship a confidently wrong number where today the question honestly falls
    // through to prose. A correct version needs a first-occurrence or DISTINCT basis and
    // a business decision about which number is meant — scheduled as `pp_new` in Plan 2.
    expect(findMetric('preprovisions')).toBeUndefined();
    // And no metric may claim the bare alias, or backlog questions misroute to it.
    for (const m of METRICS) {
      expect(m.aliases, `${m.key} claims the ambiguous bare alias`).not.toContain('pre-provisions');
    }
  });
});
