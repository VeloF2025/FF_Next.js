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
import { isAuthFailure, isSameFailureKind } from '../authFailure';

describe('isAuthFailure — Netstar and generic vocabulary', () => {
  it('recognises the shared portal-session and HTTP wordings', () => {
    expect(isAuthFailure('[portal-session] still logged out after re-auth: /Main')).toBe(true);
    expect(isAuthFailure('netstar login failed: HTTP 200 but no auth cookie')).toBe(true);
    expect(isAuthFailure('Cartrack vehicles: HTTP 401 (page 1)')).toBe(true);
    expect(isAuthFailure('Cartrack vehicles: HTTP 403 (page 1)')).toBe(true);
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
