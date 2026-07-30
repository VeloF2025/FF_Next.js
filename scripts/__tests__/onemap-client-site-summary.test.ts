import { describe, expect, it } from 'vitest';

import { summariseSites } from '../lib/onemap-client.mjs';

/**
 * The 2026-07-27 regression this guards: 1Map re-coded Mohadin's site value from
 * `Mohadin` to `MOA`, so the sweep's free-text `q=MOH` stopped reaching it and
 * returned only incidental matches from unrelated sites. The record count alone
 * read as "low"; the site histogram is what shows the query missed its target.
 */
describe('summariseSites', () => {
  it('orders sites by descending count', () => {
    const records = [
      { site: 'MOA' },
      { site: 'IVO' },
      { site: 'MOA' },
      { site: 'MOA' },
      { site: 'IVO' },
      { site: 'OLI' },
    ];

    expect(summariseSites(records)).toBe('MOA=3 IVO=2 OLI=1');
  });

  it('breaks count ties by site name so the line is stable across runs', () => {
    expect(summariseSites([{ site: 'NYA' }, { site: 'DIE' }, { site: 'KAT' }])).toBe(
      'DIE=1 KAT=1 NYA=1',
    );
  });

  it('makes a drifted site code visible: q=MOH reaching no Mohadin property', () => {
    // Shape of the real degraded 07-27 sweep — 1,613 records, none of them the
    // site being asked for.
    const degraded = [
      ...Array.from({ length: 693 }, () => ({ site: 'MOA' })),
      ...Array.from({ length: 208 }, () => ({ site: 'NYA' })),
      ...Array.from({ length: 114 }, () => ({ site: 'KAT' })),
    ];

    const summary = summariseSites(degraded);

    expect(summary).toBe('MOA=693 NYA=208 KAT=114');
    expect(summary).not.toMatch(/Mohadin|MOH=/);
  });

  it('reports missing and empty site values rather than dropping them', () => {
    expect(summariseSites([{ site: null }, { site: '' }, {}, { site: 'LAW' }])).toBe(
      '(blank)=3 LAW=1',
    );
  });

  it('returns an empty string for an empty batch', () => {
    expect(summariseSites([])).toBe('');
  });
});
