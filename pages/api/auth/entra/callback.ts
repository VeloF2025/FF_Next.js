/**
 * Entra SSO — auth-code callback (Phase 6, DARK behind ENTRA_SSO_ENABLED).
 *
 * Validates the state cookie (CSRF), replays the PKCE verifier cookie on the token
 * exchange (RFC 7636, code-interception guard), checks the token's nonce against the
 * nonce cookie (replay), stores the ID token in a server-only httpOnly cookie
 * (`bridgeBearer` forwards it to the Cortex bridge), clears the round-trip cookies,
 * and redirects to /cortex. Inert (404) unless the flag is on.
 *
 * Fail closed: any missing/mismatched state, missing code, missing PKCE verifier,
 * exchange failure, aud/iss mismatch, nonce mismatch, or an already-expired token
 * redirects to an error and sets NO id-token cookie. Identity binding to the FF session is enforced at FORWARD time
 * (getForwardableEntraIdToken), so a token for a different principal is simply never
 * forwarded. UNTESTED end-to-end until the Azure app registration is configured.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { timingSafeEqual } from 'crypto';
import { serialize } from 'cookie';
import { decodeJwt } from 'jose';
import { createLogger } from '@/lib/logger';
import {
  ENTRA_ID_TOKEN_COOKIE,
  ENTRA_NONCE_COOKIE,
  ENTRA_STATE_COOKIE,
  ENTRA_VERIFIER_COOKIE,
  entraSsoEnabled,
  exchangeCodeForTokens,
  forwardAccessToken,
  getEntraConfig,
} from '@/lib/cortex/entraAuth';

const log = createLogger('auth:entra:callback');

/** Constant-time compare of two opaque secrets (state / nonce). Length-guarded. */
function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function clearRoundTripCookies(): string[] {
  // `secure` must match the attributes the cookie was SET with at login, otherwise a
  // TLS browser ignores the deletion for a Secure cookie (RFC 6265) and it lingers.
  const expire = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 0,
    path: '/',
  };
  return [
    serialize(ENTRA_STATE_COOKIE, '', expire),
    serialize(ENTRA_NONCE_COOKIE, '', expire),
    serialize(ENTRA_VERIFIER_COOKIE, '', expire),
  ];
}

function fail(res: NextApiResponse, reason: string): void {
  log.warn(`Entra callback rejected: ${reason}`);
  res.setHeader('Set-Cookie', clearRoundTripCookies());
  res.redirect(302, '/cortex?entra_error=1');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (!entraSsoEnabled()) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  if (req.method !== 'GET') {
    // The flow uses response_mode=query → the callback is a top-level GET redirect.
    res.setHeader('Allow', 'GET');
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }
  const cfg = getEntraConfig();
  if (!cfg) {
    log.error('Entra SSO enabled but app registration is unconfigured');
    res.status(503).json({ success: false, error: 'Entra SSO not configured' });
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const stateCookie = req.cookies[ENTRA_STATE_COOKIE];
  const nonceCookie = req.cookies[ENTRA_NONCE_COOKIE];
  // Trim once and use the trimmed value for BOTH the presence guard and the exchange,
  // so a cookie that somehow carries whitespace can't pass the guard yet send a wrong
  // verifier to Entra (invalid_grant). generateCodeVerifier() never produces whitespace.
  const verifier = req.cookies[ENTRA_VERIFIER_COOKIE]?.trim();

  // CSRF: the returned state must match the cookie set at login (constant-time).
  if (!safeEqual(state, stateCookie)) {
    fail(res, 'state mismatch');
    return;
  }
  if (!code) {
    fail(res, 'missing authorization code');
    return;
  }
  // PKCE: the verifier set at login MUST be present to complete the exchange. Its
  // absence means a callback that did not originate from our login (or a stale/cross-
  // deploy round trip) — fail closed rather than fall back to a non-PKCE exchange.
  if (!verifier) {
    fail(res, 'missing PKCE verifier');
    return;
  }

  let idToken: string;
  let accessToken: string | undefined;
  try {
    ({ idToken, accessToken } = await exchangeCodeForTokens(cfg, code, verifier));
  } catch (err) {
    log.error(`Entra token exchange failed: ${err instanceof Error ? err.message : String(err)}`);
    fail(res, 'token exchange failed');
    return;
  }

  // Defence in depth: the token is server-fetched over TLS and the bridge fully
  // re-verifies signature/iss/aud/exp, but FF independently checks the token is
  // targeted at THIS app (aud) and THIS tenant (iss) before persisting/forwarding,
  // and that the nonce matches (replay guard). decodeJwt does not verify the
  // signature — that is the bridge's job — so these are targeting checks only.
  try {
    const claims = decodeJwt(idToken);
    const issOk = typeof claims.iss === 'string'
      && claims.iss.startsWith(`https://login.microsoftonline.com/${cfg.tenantId}/`);
    const audOk = claims.aud === cfg.clientId;
    if (!issOk || !audOk) {
      fail(res, 'id_token aud/iss mismatch');
      return;
    }
    if (!safeEqual(typeof claims.nonce === 'string' ? claims.nonce : undefined, nonceCookie)) {
      fail(res, 'nonce mismatch');
      return;
    }
    // Freshness: decodeJwt does not check exp. Don't persist a token that is already
    // expired (delayed callback / clock skew) — the bridge would 401 every forward.
    if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) {
      fail(res, 'id_token expired');
      return;
    }
  } catch (err) {
    log.warn(`Entra id_token decode failed: ${err instanceof Error ? err.message : String(err)}`);
    fail(res, 'unparseable id_token');
    return;
  }

  // Phase 6h #102: choose which token to forward to the bridge. DARK by default — forward
  // the ID token (today). When CORTEX_FORWARD_TOKEN=access_token, forward the Entra ACCESS
  // token instead: its aud is the Cortex API and the bridge verifies sig + iss + aud + scp
  // (access_as_user) + email. FF does a defence-in-depth targeting check (iss = our tenant,
  // aud = our API, not expired) before forwarding; a missing/mistargeted access token fails
  // closed. The ID token still drove the nonce/identity/replay checks above regardless of
  // which token is forwarded (access tokens carry no nonce).
  let forwardToken = idToken;
  if (forwardAccessToken()) {
    if (!accessToken) {
      fail(res, 'access-token forwarding on but the exchange returned no access_token');
      return;
    }
    try {
      const ac = decodeJwt(accessToken);
      const issOk = typeof ac.iss === 'string'
        && ac.iss.startsWith(`https://login.microsoftonline.com/${cfg.tenantId}/`);
      // A v2 access token's aud is EITHER the App ID URI (api://<client>) or the bare
      // client-id GUID, per requestedAccessTokenVersion / scope registration — accept both,
      // never assume (the bridge pins the exact value via CORTEX_OIDC_AUDIENCE).
      const audOk = ac.aud === `api://${cfg.clientId}` || ac.aud === cfg.clientId;
      if (!issOk || !audOk) {
        fail(res, 'access_token aud/iss not targeted at the Cortex API');
        return;
      }
      if (typeof ac.exp === 'number' && ac.exp * 1000 <= Date.now()) {
        fail(res, 'access_token expired');
        return;
      }
    } catch (err) {
      log.warn(`Entra access_token decode failed: ${err instanceof Error ? err.message : String(err)}`);
      fail(res, 'unparseable access_token');
      return;
    }
    forwardToken = accessToken;
  }

  // Store the forwarded token server-side only; bridgeBearer forwards it to the bridge.
  // (Cookie name is historical — ff_entra_id_token — but in access-token mode it holds the
  // access token. getForwardableEntraIdToken binds it to the FF session email at forward
  // time and works on EITHER kind by keying on preferred_username|email|upn — which an ID
  // token carries by default, and an ACCESS token carries ONLY if those are configured as
  // access-token optional claims on the resource app reg. If none are present it returns
  // undefined → fail closed to HS256, never a cross-user forward.) Scope the path to
  // /api/cortex — the only routes that read it — so it is not transmitted on every request
  // (httpOnly already blocks JS access; this narrows the wire surface). The redirect target
  // /cortex still triggers the page's /api/cortex/* calls.
  const fwdCookie = serialize(ENTRA_ID_TOKEN_COOKIE, forwardToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600,
    path: '/api/cortex',
  });
  res.setHeader('Set-Cookie', [fwdCookie, ...clearRoundTripCookies()]);
  res.redirect(302, '/cortex');
}
