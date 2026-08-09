import { describe, it, expect } from 'vitest';

import { DEFAULT_STALE_AFTER_SECONDS, staleAfterSecondsFor } from '../staleness';

describe('staleAfterSecondsFor', () => {
  it('holds the fast REST feed to 15 minutes', () => {
    expect(staleAfterSecondsFor('cartrack', 'velocity')).toBe(15 * 60);
  });

  it('gives the 2-hourly portal feeds three hours', () => {
    // The bug: one flat 15-minute rule made these permanently stale. Netstar's
    // freshest fix on 2026-08-09 was 118 minutes old and Ituran's 76 — healthy
    // for a 2-hourly poll, but grey on the map every single time.
    expect(staleAfterSecondsFor('netstar', 'europcar')).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('ituran', 'avis')).toBe(DEFAULT_STALE_AFTER_SECONDS);
  });

  it('splits Cartrack by ACCOUNT, because the two ride different crons', () => {
    // urent is the fleetweb PORTAL on the 2-hourly cron; velocity is the REST
    // feed on the 2-minute one. Keying on provider alone would judge urent by
    // velocity's threshold and flag all 3 of its vehicles forever.
    expect(staleAfterSecondsFor('cartrack', 'urent')).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('cartrack', 'urent')).not.toBe(
      staleAfterSecondsFor('cartrack', 'velocity')
    );
  });

  it('is lenient for an unrecognised feed rather than alarming', () => {
    // A false "stale" is the failure being removed here; a late flag is not.
    expect(staleAfterSecondsFor('cartrack', 'some-new-account')).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('brand-new-provider', 'acct')).toBe(DEFAULT_STALE_AFTER_SECONDS);
  });

  it('falls back when either half is missing, instead of building a half key', () => {
    // 'cartrack:null' must never accidentally match anything.
    expect(staleAfterSecondsFor(null, 'velocity')).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('cartrack', null)).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor(null, null)).toBe(DEFAULT_STALE_AFTER_SECONDS);
  });

  it('never returns a threshold tighter than the fastest feed', () => {
    for (const [p, a] of [
      ['cartrack', 'velocity'],
      ['cartrack', 'urent'],
      ['netstar', 'europcar'],
      ['ituran', 'avis'],
      ['x', 'y'],
    ] as const) {
      expect(staleAfterSecondsFor(p, a)).toBeGreaterThanOrEqual(15 * 60);
    }
  });
});
