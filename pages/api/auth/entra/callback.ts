/**
 * Entra SSO — auth-code callback (Phase 6, DARK behind ENTRA_SSO_ENABLED).
 *
 * Validates the state cookie (CSRF), exchanges the code for an ID token, checks the
 * token's nonce against the nonce cookie (replay), stores the ID token in a server-
 * only httpOnly cookie (`bridgeBearer` forwards it to the Cortex bridge), clears the
 * round-trip cookies, and redirects to /cortex. Inert (404) unless the flag is on.
 *
 * Fail closed: any missing/mismatched state, missing code, exchange failure, or nonce
 * mismatch redirects to an error and sets NO id-token cookie. UNTESTED end-to-end
 * until the Azure app registration is configured.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import { decodeJwt } from 'jose';
import { createLogger } from '@/lib/logger';
import {
  ENTRA_ID_TOKEN_COOKIE,
  ENTRA_NONCE_COOKIE,
  ENTRA_STATE_COOKIE,
  entraSsoEnabled,
  exchangeCodeForIdToken,
  getEntraConfig,
} from '@/lib/cortex/entraAuth';

const log = createLogger('auth:entra:callback');

function clearRoundTripCookies(): string[] {
  const expire = { httpOnly: true, sameSite: 'lax' as const, maxAge: 0, path: '/' };
  return [serialize(ENTRA_STATE_COOKIE, '', expire), serialize(ENTRA_NONCE_COOKIE, '', expire)];
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

  // CSRF: the returned state must match the cookie set at login.
  if (!state || !stateCookie || state !== stateCookie) {
    fail(res, 'state mismatch');
    return;
  }
  if (!code) {
    fail(res, 'missing authorization code');
    return;
  }

  let idToken: string;
  try {
    idToken = await exchangeCodeForIdToken(cfg, code);
  } catch (err) {
    log.error(`Entra token exchange failed: ${err instanceof Error ? err.message : String(err)}`);
    fail(res, 'token exchange failed');
    return;
  }

  // Replay guard: the ID token's nonce must match the nonce cookie.
  try {
    const claims = decodeJwt(idToken);
    if (!nonceCookie || claims.nonce !== nonceCookie) {
      fail(res, 'nonce mismatch');
      return;
    }
  } catch {
    fail(res, 'unparseable id_token');
    return;
  }

  // Store the ID token server-side only; bridgeBearer forwards it to the bridge.
  const idCookie = serialize(ENTRA_ID_TOKEN_COOKIE, idToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600,
    path: '/',
  });
  res.setHeader('Set-Cookie', [idCookie, ...clearRoundTripCookies()]);
  res.redirect(302, '/cortex');
}
