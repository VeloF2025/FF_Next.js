import { describe, it, expect } from 'vitest';

import {
  DEFAULT_STALE_AFTER_SECONDS,
  FAST_STALE_AFTER_SECONDS,
  staleAfterSecondsFor,
} from '../staleness';

describe('staleAfterSecondsFor', () => {
  it('holds the fast Cartrack REST feed to 15 minutes', () => {
    expect(staleAfterSecondsFor('cartrack', 'velocity')).toBe(FAST_STALE_AFTER_SECONDS);
  });

  it('gives the 2-hourly portal feeds three hours', () => {
    // The bug: one flat 15-minute rule made these permanently stale. Netstar's
    // freshest fix on 2026-08-09 was 118 minutes old and Ituran's 76 — healthy
    // for a 2-hourly poll, but grey on the map every single time.
    expect(staleAfterSecondsFor('netstar', 'europcar')).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('ituran', 'avis')).toBe(DEFAULT_STALE_AFTER_SECONDS);
  });

  it('splits Cartrack by ACCOUNT, because its two feeds ride different crons', () => {
    // urent is the fleetweb PORTAL on the 2-hourly cron; velocity is the REST
    // feed on the 2-minute one. Keying on provider alone would judge the
    // portal by the REST threshold and flag its vehicles forever.
    expect(staleAfterSecondsFor('cartrack', 'urent')).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('cartrack', 'urent')).not.toBe(
      staleAfterSecondsFor('cartrack', 'velocity')
    );
  });

  it("treats 'default' as the fast feed — the name production's ingest would write", () => {
    // CARTRACK_ACCOUNT_REF is set on dev and UNSET on production, where the
    // ingest falls back to 'default'. Naming the FAST account would stop
    // matching the moment the cron moved environments, and the fast feed would
    // silently inherit the lenient threshold. Identifying the PORTAL instead
    // means every other Cartrack account is fast by construction.
    expect(staleAfterSecondsFor('cartrack', 'default')).toBe(FAST_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('cartrack', 'some-future-rest-account')).toBe(
      FAST_STALE_AFTER_SECONDS
    );
  });

  it('follows CARTRACK_PORTAL_ACCOUNT_REF, so it cannot drift from the portal config', () => {
    const env = { CARTRACK_PORTAL_ACCOUNT_REF: 'renamed-portal' } as NodeJS.ProcessEnv;
    expect(staleAfterSecondsFor('cartrack', 'renamed-portal', env)).toBe(
      DEFAULT_STALE_AFTER_SECONDS
    );
    // ...and the old name stops being treated as the portal.
    expect(staleAfterSecondsFor('cartrack', 'urent', env)).toBe(FAST_STALE_AFTER_SECONDS);
  });

  it('is lenient for an unrecognised provider rather than alarming', () => {
    // A false "stale" is the failure being removed here; a late flag is not.
    expect(staleAfterSecondsFor('brand-new-provider', 'acct')).toBe(DEFAULT_STALE_AFTER_SECONDS);
  });

  it('falls back when either half is missing, instead of building a half key', () => {
    expect(staleAfterSecondsFor(null, 'velocity')).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('cartrack', null)).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('cartrack', '')).toBe(DEFAULT_STALE_AFTER_SECONDS);
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
      expect(staleAfterSecondsFor(p, a)).toBeGreaterThanOrEqual(FAST_STALE_AFTER_SECONDS);
    }
  });
});
