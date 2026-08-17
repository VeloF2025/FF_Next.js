import { describe, it, expect } from 'vitest';

import { staleAfterSecondsFor, DEFAULT_STALE_AFTER_SECONDS } from '../staleness';

describe('staleAfterSecondsFor derives from configured cadence', () => {
  it('is twice the configured interval — one missed tick is tolerated', () => {
    expect(staleAfterSecondsFor('netstar', 'europcar', 120)).toBe(2 * 120 * 60);
    expect(staleAfterSecondsFor('netstar', 'europcar', 10)).toBe(2 * 10 * 60);
  });

  it('falls back leniently when no interval is configured', () => {
    // A false "stale" is the failure this module exists to remove.
    expect(staleAfterSecondsFor('netstar', 'europcar', null)).toBe(DEFAULT_STALE_AFTER_SECONDS);
  });

  it('falls back leniently when the interval is undefined, not just null', () => {
    // A row whose position has no matching watermark carries `undefined`
    // here, not `null` — a strict `=== null` guard would let it fall through
    // to `undefined * 2 * 60`, i.e. NaN, and silently stop flagging anything
    // as stale rather than falling back leniently.
    expect(staleAfterSecondsFor('netstar', 'europcar', undefined as unknown as null)).toBe(
      DEFAULT_STALE_AFTER_SECONDS
    );
  });

  it('still varies by ACCOUNT, because Cartrack runs a fast and a slow feed', () => {
    // No branch on provider or account name is needed for this to hold any
    // more: the threshold comes entirely from each account's own configured
    // interval in fleet_tracking_watermarks.
    const portal = staleAfterSecondsFor('cartrack', 'urent', 120);
    const rest = staleAfterSecondsFor('cartrack', 'velocity', 2);
    expect(portal).toBeGreaterThan(rest);
  });

  it('is lenient for an unrecognised provider, same as any other with no interval', () => {
    expect(staleAfterSecondsFor('brand-new-provider', 'acct', null)).toBe(
      DEFAULT_STALE_AFTER_SECONDS
    );
  });

  it('falls back when either half of the key is missing, instead of building a half key', () => {
    expect(staleAfterSecondsFor(null, 'velocity', 120)).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('cartrack', null, 120)).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor('cartrack', '', 120)).toBe(DEFAULT_STALE_AFTER_SECONDS);
    expect(staleAfterSecondsFor(null, null, 120)).toBe(DEFAULT_STALE_AFTER_SECONDS);
  });
});
