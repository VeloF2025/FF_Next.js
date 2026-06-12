/**
 * Entra (Azure AD) OIDC login for the Cortex panel — Phase 6, DARK by default.
 *
 * Adds a real Entra interactive login (OAuth2 auth-code flow) that yields the
 * signed-in user's **ID token**, which `bridgeBearer` then forwards to the Cortex
 * bridge for real OIDC verification (RS256 + JWKS + iss/aud). This REPLACES the
 * HS256 shared-secret gateway JWT as the per-user identity source.
 *
 * GATED: the whole module is inert unless `ENTRA_SSO_ENABLED=true`. It is additive
 * and does NOT touch FibreFlow's existing GoTrue/JWT session login — Entra login is
 * an alternative path, dark until Hein adds a redirect URI + delegated scopes
 * (`openid profile email`) to the velocityfibre.co.za app registration and flips the
 * flag. Reuses that existing app reg: ENTRA_* envs fall back to the GRAPH_* envs.
 *
 * TRUST MODEL: the ID token is stored ONLY in a server-only httpOnly cookie and is
 * never read from a client-supplied header. State + nonce guard the auth-code flow
 * against CSRF / replay.
 *
 * NOTE (honesty / UNTESTED): the interactive browser flow cannot be end-to-end
 * verified until the app registration is configured in Azure. The pure helpers
 * (config, authorize-URL building, cookie parsing, flag gating) are unit-tested; the
 * live `fetch` token exchange and the route round-trip are UNTESTED pending that.
 */
import { randomBytes } from 'crypto';

/** Server-only cookie holding the forwarded Entra ID token (httpOnly). */
export const ENTRA_ID_TOKEN_COOKIE = 'ff_entra_id_token';
/** Short-lived cookies guarding the auth-code round trip. */
export const ENTRA_STATE_COOKIE = 'ff_entra_state';
export const ENTRA_NONCE_COOKIE = 'ff_entra_nonce';

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** The login path is inert unless explicitly enabled. */
export function entraSsoEnabled(): boolean {
  return (process.env.ENTRA_SSO_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/**
 * Read Entra config from env, reusing the existing Graph app registration when the
 * dedicated ENTRA_* vars are unset. Returns null when incomplete (caller 503s) so a
 * misconfigured deploy fails closed rather than building a broken authorize URL.
 */
export function getEntraConfig(): EntraConfig | null {
  const tenantId = process.env.ENTRA_TENANT_ID || process.env.GRAPH_TENANT_ID || '';
  const clientId = process.env.ENTRA_CLIENT_ID || process.env.GRAPH_CLIENT_ID || '';
  const clientSecret = process.env.ENTRA_CLIENT_SECRET || process.env.GRAPH_CLIENT_SECRET || '';
  const redirectUri = process.env.ENTRA_REDIRECT_URI || '';
  if (!tenantId || !clientId || !clientSecret || !redirectUri) return null;
  return { tenantId, clientId, clientSecret, redirectUri };
}

/** Cryptographically-random opaque value for state / nonce. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Build the Entra authorize URL for the auth-code flow. Requests an ID token
 * (`openid profile email`) for the configured app (single-tenant endpoint).
 */
export function buildAuthorizeUrl(cfg: EntraConfig, state: string, nonce: string): string {
  const base = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize`;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
  });
  return `${base}?${params.toString()}`;
}

/**
 * Exchange an auth-code for tokens at the Entra token endpoint and return the raw
 * ID token. Throws on any failure (caller maps to a 502/redirect-to-error) — never
 * returns a partial/empty token silently.
 *
 * UNTESTED end-to-end (live network); structured so the request shape is obvious.
 */
export async function exchangeCodeForIdToken(cfg: EntraConfig, code: string): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    scope: 'openid profile email',
  });
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`entraAuth: token exchange failed (${resp.status})`);
  }
  const json = (await resp.json()) as { id_token?: string };
  if (!json.id_token) {
    throw new Error('entraAuth: token response carried no id_token');
  }
  return json.id_token;
}

/**
 * Read the forwarded Entra ID token from a request's parsed cookies (server-side
 * only). Accepts Next's `req.cookies` object. Returns undefined when absent.
 */
export function readEntraIdToken(cookies: Partial<Record<string, string>> | undefined): string | undefined {
  const v = cookies?.[ENTRA_ID_TOKEN_COOKIE];
  return v && v.trim() ? v : undefined;
}
