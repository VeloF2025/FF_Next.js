/**
 * isAuthFailure decides the alert channel, and the branches are far apart:
 * `auth` raises immediately over WhatsApp because it will never self-heal,
 * while `transient` stays silent until TRANSIENT_THRESHOLD consecutive
 * failures. At a 2-hourly cadence, misclassifying a dead password as transient
 * is hours of silence and no WhatsApp.
 *
 * Because it classifies by MESSAGE TEXT, it is coupled to the exact wording
 * each provider throws. These tests use the real strings the providers build,
 * so a reworded error surfaces here rather than in production as an alert that
 * never arrived.
 */
import { describe, expect, it } from 'vitest';
import { isAuthFailure, isEviction, isSameFailureKind } from '../authFailure';

describe('isAuthFailure — Netstar and generic vocabulary', () => {
  it('recognises the shared HTTP wordings', () => {
    expect(isAuthFailure('netstar login failed: HTTP 200 but no auth cookie')).toBe(true);
    expect(isAuthFailure('Cartrack vehicles: HTTP 401 (page 1)')).toBe(true);
    expect(isAuthFailure('Cartrack vehicles: HTTP 403 (page 1)')).toBe(true);
  });

  // Was asserted true here. "still logged out after re-auth" is Netstar's
  // single-session eviction, not a credentials problem — a human opening the
  // same portal throws this job out and it self-heals when they leave. Task 3
  // moved it to isEviction() precisely so it stops sharing isAuthFailure's
  // immediate-WhatsApp channel; see isEviction's docstring in authFailure.ts.
  it('routes the portal-session wording through isEviction instead', () => {
    const msg = '[portal-session] still logged out after re-auth: /Main';
    expect(isAuthFailure(msg)).toBe(false);
    expect(isEviction(msg)).toBe(true);
  });
});

describe('isAuthFailure — Ituran vocabulary', () => {
  // These three strings are constructed verbatim in ituran/client.ts and
  // ituran/session.ts. Each is a permanent, human-needs-to-act condition.
  it('classifies a token the portal keeps refusing as auth', () => {
    expect(
      isAuthFailure('[ituran/auth] still rejected after re-mint: PassEnc rejected (ErrorStr=LoginError!)')
    ).toBe(true);
  });

  it('classifies a login that returned no session as auth', () => {
    expect(
      isAuthFailure(
        'login did not yield a session (token=false, waap_id=true); page said: Incorrect user name or password'
      )
    ).toBe(true);
  });

  it('classifies a WAF that never let us reach the form as auth', () => {
    // Not strictly a credentials fault, but equally will not fix itself on the
    // next tick and equally needs a human.
    expect(
      isAuthFailure(
        'bot challenge did not clear — login form never appeared (check that the full chromium channel is installed, not the headless shell)'
      )
    ).toBe(true);
  });
});

describe('isAuthFailure — genuinely transient conditions stay transient', () => {
  it('does not misclassify network and server faults as auth', () => {
    expect(isAuthFailure('[ituran/network] ECONNRESET')).toBe(false);
    expect(isAuthFailure('[ituran/http] grid: HTTP 500')).toBe(false);
    expect(isAuthFailure('[ituran/http] grid: HTTP 502')).toBe(false);
    expect(isAuthFailure('The operation was aborted due to timeout')).toBe(false);
  });

  it('does not treat a contract change as an auth problem', () => {
    // A shape error needs a developer, but retrying credentials will not help
    // and it must not page someone as a lockout would.
    expect(isAuthFailure('[ituran/shape] grid: expected rows_data object, got undefined')).toBe(false);
  });

  it('does not match a 401 appearing inside an unrelated number', () => {
    expect(isAuthFailure('ingested 4011 positions')).toBe(false);
  });
});

describe('isAuthFailure — Cartrack portal vocabulary', () => {
  // Constructed verbatim in cartrack/portalClient.ts. The first is urgent
  // beyond the usual: that endpoint counts failures toward an account lockout.
  it('classifies a rejected portal credential as auth', () => {
    expect(
      isAuthFailure('[cartrack-portal/auth] login failed: status=WRONG_CREDENTIALS, attempts_remaining=19')
    ).toBe(true);
  });

  it('classifies a session that will not re-establish as auth', () => {
    expect(isAuthFailure('[cartrack-portal/auth] still unauthenticated after re-login')).toBe(true);
  });

  it('classifies a cookie-less successful login as auth', () => {
    expect(isAuthFailure('[cartrack-portal/auth] login succeeded but issued no session cookies')).toBe(true);
  });

  it('leaves the portal transport errors transient', () => {
    expect(isAuthFailure('[cartrack-portal/network] ECONNRESET')).toBe(false);
    expect(isAuthFailure('[cartrack-portal/http] vehiclelist: HTTP 500')).toBe(false);
    expect(isAuthFailure('[cartrack-portal/shape] vehiclelist: expected result.ct_fleet_get_vehiclelist array, got undefined')).toBe(false);
  });
});

describe('eviction is distinguished from bad credentials', () => {
  it('classifies a lost session as eviction, not auth', () => {
    const msg = '[portal-session] still logged out after re-auth: /Main/VehicleRepo/GetVehicleTreeDataPaging';
    expect(isEviction(msg)).toBe(true);
    expect(isAuthFailure(msg)).toBe(false);
  });

  it('still treats a rejected login as auth', () => {
    expect(isAuthFailure('login failed')).toBe(true);
    expect(isEviction('login failed')).toBe(false);
  });

  it('still treats 401/403 as auth', () => {
    expect(isAuthFailure('HTTP 401 Unauthorized')).toBe(true);
    expect(isAuthFailure('HTTP 403 Forbidden')).toBe(true);
  });

  it('keeps the other providers auth vocabulary intact', () => {
    for (const m of [
      'still rejected after re-mint',
      'login did not yield a session',
      'bot challenge did not clear',
      'still unauthenticated after re-login',
      'issued no session cookies',
    ]) {
      expect(isAuthFailure(m)).toBe(true);
    }
  });
});

describe('isSameFailureKind — the counter counts one kind of streak', () => {
  it('treats two auth failures as the same streak', () => {
    expect(isSameFailureKind(
      '[cartrack-portal/auth] login failed: status=WRONG_CREDENTIALS',
      '[ituran/auth] still rejected after re-mint: PassEnc rejected')).toBe(true);
  });

  it('treats two non-auth failures as the same streak', () => {
    expect(isSameFailureKind('[cartrack-portal/network] ECONNRESET', 'portal feed is stale: 9h old'))
      .toBe(true);
  });

  it('breaks the streak when a gap run is followed by an auth failure', () => {
    // The bug this closes: the gap branch increments the SAME counter. A long
    // gap streak could carry its count past the breaker's hard-stop ceiling, so
    // one single auth failure would skip open AND half-open and demand manual
    // SQL to clear.
    expect(isSameFailureKind(
      '[cartrack-portal/auth] login failed: status=WRONG_CREDENTIALS',
      'portal feed is stale: newest fix on the whole account is 9h old')).toBe(false);
  });

  it('breaks the streak in the other direction too', () => {
    expect(isSameFailureKind(
      '[cartrack-portal/network] ECONNRESET',
      '[cartrack-portal/auth] login failed: status=WRONG_CREDENTIALS')).toBe(false);
  });

  it('handles a null prior error as non-auth', () => {
    expect(isSameFailureKind('[cartrack-portal/network] ECONNRESET', null)).toBe(true);
    expect(isSameFailureKind('[cartrack-portal/auth] login failed', null)).toBe(false);
  });
});

describe('isSameFailureKind — eviction keeps its own streak', () => {
  const evicted = '[portal-session] still logged out after re-auth: /Main/VehicleRepo/GetVehicleTreeDataPaging';
  const auth = '[cartrack-portal/auth] login failed: status=WRONG_CREDENTIALS';
  const transient = '[cartrack-portal/network] ECONNRESET';

  it('does not merge an eviction streak into an auth streak', () => {
    // Pre-fix, isAuthFailure(evicted) was also true, so the old two-way
    // `isAuthFailure(a) === isAuthFailure(b)` formula called these the same
    // kind and let an eviction streak feed the auth breaker's counter.
    expect(isSameFailureKind(evicted, auth)).toBe(false);
    expect(isSameFailureKind(auth, evicted)).toBe(false);
  });

  it('does not merge an eviction streak into a transient streak', () => {
    // The exact bug isSameFailureKind's docstring warns about: once eviction
    // leaves isAuthFailure, a two-way `isAuthFailure(a) === isAuthFailure(b)`
    // comparison calls an eviction and an ordinary transient failure the SAME
    // kind, because both are `false`. Note this assertion also holds against
    // the pre-fix code (which routed eviction through isAuthFailure instead of
    // dropping it to `false`), so on its own it does not discriminate against
    // HEAD — it guards specifically against a half-applied fix that updates
    // isAuthFailure without making isSameFailureKind three-way. The
    // evicted-vs-auth pair above is what fails against HEAD.
    expect(isSameFailureKind(evicted, transient)).toBe(false);
    expect(isSameFailureKind(transient, evicted)).toBe(false);
  });

  it('treats two evictions as the same streak', () => {
    expect(isSameFailureKind(evicted, evicted)).toBe(true);
  });
});
