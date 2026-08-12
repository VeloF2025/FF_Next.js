/**
 * These tests are the reporting layer's whole point. Every case here is a real project
 * shape measured on the production database, and each one is a way a naive count would
 * have told a PM something false.
 */
import { describe, expect, it } from 'vitest';

import { measure, ratio, throughput } from '../coverage';

describe('ratio — refusing to invent a denominator', () => {
  it('withholds a percentage when that scope was never imported', () => {
    // Grabouw has 122 poles captured and no drops at all. Reporting 0% activation would
    // say the opposite of the truth — the import is missing, not the work.
    const r = ratio(122, 0, 'active');
    expect(r.percent).toBeNull();
    expect(r.absent).toBe('no-scope-recorded');
    expect(r.note).toContain('missing import, not zero progress');
  });

  it('reports a real percentage when scope exists', () => {
    // Etwatwa build: 1,493 poles captured of 4,538 in scope. NOT 1,493/21,008 drops —
    // poles and drops are different scopes, and confusing them understated this by ~4x.
    expect(ratio(1493, 4538, 'active').percent).toBe(32.9);
    expect(ratio(1493, 4538, 'active').of).toBe(4538);
  });

  it('distinguishes "not started" from "not captured" using project status', () => {
    // Thembisa POP 2: 30,682 in scope, 0 poles, status planning → not started.
    const planning = ratio(0, 0, 'planning');
    expect(planning.absent).toBe('not-started');
    // Same counts on an ACTIVE project cannot be read that way.
    const active = ratio(0, 0, 'active');
    expect(active.absent).toBe('no-data-in-store');
    expect(active.note).toContain('Cannot distinguish');
  });

  it('never returns a percentage of zero for an absent denominator', () => {
    // The single most dangerous output this module could produce.
    for (const status of ['active', 'planning', null]) {
      expect(ratio(5, 0, status).percent).not.toBe(0);
      expect(ratio(5, 0, status).percent).toBeNull();
    }
  });
});

describe('throughput — a rate, never a date', () => {
  it('reports week-on-week movement', () => {
    // Mohadin: 120 last week against 133 the week before.
    const t = throughput(120, 133, 5000);
    expect(t.changePercent).toBe(-9.8);
    expect(t.weeksRemainingAtCurrentRate).toBe(42);
  });

  it('withholds a projection when the rate is too low to project from', () => {
    // Etwatwa measured 2 poles in 7 days against 3,045 remaining poles — 1,523 weeks,
    // or 29 years. Printing that gets the whole report dismissed.
    const t = throughput(2, 7, 3045);
    expect(t.weeksRemainingAtCurrentRate).toBeNull();
    expect(t.note).toContain('too little movement to project');
  });

  it('withholds a projection when nothing moved at all', () => {
    const t = throughput(0, 0, 5000);
    expect(t.weeksRemainingAtCurrentRate).toBeNull();
    expect(t.note).toContain('Nothing recorded in the last 7 days');
  });

  it('says the work is finished rather than that it cannot project', () => {
    // remaining === 0 is completion, not an unprojectable rate.
    const t = throughput(0, 12, 0);
    expect(t.note).toContain('Everything in scope is captured');
    expect(t.note).not.toContain('no completion estimate is possible');
  });

  it('withholds week-on-week change when the prior week has no baseline', () => {
    // Middelburg: 50 last week, 1 the week before, is a real +4900%. Zero prior is not.
    expect(throughput(50, 1, null).changePercent).toBe(4900);
    const t = throughput(27, 0, null);
    expect(t.changePercent).toBeNull();
    expect(t.note).toContain('no baseline');
  });

  it('always says that no schedule exists to compare against', () => {
    // The caveat must survive every branch — a PM reading "42 weeks" must not take it
    // as a plan variance.
    for (const t of [throughput(120, 133, 5000), throughput(0, 0, null), throughput(2, 7, 19515)]) {
      expect(t.note).toContain('no maintained schedule');
    }
  });
});

describe('measure', () => {
  it('flags an empty store so a zero is never read as a measured zero', () => {
    expect(measure(0).storeEmpty).toBe(true);
    expect(measure(1).storeEmpty).toBe(false);
  });
});
