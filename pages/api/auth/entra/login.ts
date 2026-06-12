/**
 * Entra SSO — login initiator (Phase 6, DARK behind ENTRA_SSO_ENABLED).
 *
 * Starts the OAuth2 auth-code flow: sets short-lived httpOnly state + nonce + PKCE
 * verifier cookies (CSRF / replay / code-interception guards) and redirects the
 * browser to Entra's authorize endpoint (carrying the PKCE S256 challenge).
 * Inert (404) unless the flag is on; 503 if the app registration is unconfigured.
 *
 * Additive: does NOT touch FibreFlow's existing GoTrue/JWT login. UNTESTED end-to-end
 * until the Azure app registration has a redirect URI + delegated scopes.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import { createLogger } from '@/lib/logger';
import {
  ENTRA_NONCE_COOKIE,
  ENTRA_STATE_COOKIE,
  ENTRA_VERIFIER_COOKIE,
  buildAuthorizeUrl,
  computeCodeChallenge,
  entraSsoEnabled,
  generateCodeVerifier,
  getEntraConfig,
  randomToken,
} from '@/lib/cortex/entraAuth';

const log = createLogger('auth:entra:login');

export default function handler(req: NextApiRequest, res: NextApiResponse): void {
  if (!entraSsoEnabled()) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  if (req.method !== 'GET') {
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

  const state = randomToken();
  const nonce = randomToken();
  // PKCE (RFC 7636, S256): the verifier is stored server-side only (httpOnly cookie)
  // and replayed on the token exchange; only its SHA256 challenge travels to Entra.
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600, // 10 minutes — only needs to outlive the round trip
    path: '/',
  };
  res.setHeader('Set-Cookie', [
    serialize(ENTRA_STATE_COOKIE, state, cookieOpts),
    serialize(ENTRA_NONCE_COOKIE, nonce, cookieOpts),
    serialize(ENTRA_VERIFIER_COOKIE, codeVerifier, cookieOpts),
  ]);
  res.redirect(302, buildAuthorizeUrl(cfg, state, nonce, codeChallenge));
}
