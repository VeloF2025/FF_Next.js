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
import { createHash, randomBytes } from 'crypto';
import { decodeJwt } from 'jose';
import { createLogger } from '@/lib/logger';

const log = createLogger('cortex:entra');

/** Server-only cookie holding the forwarded Entra ID token (httpOnly). */
export const ENTRA_ID_TOKEN_COOKIE = 'ff_entra_id_token';
/** Short-lived cookies guarding the auth-code round trip. */
export const ENTRA_STATE_COOKIE = 'ff_entra_state';
export const ENTRA_NONCE_COOKIE = 'ff_entra_nonce';
/**
 * Short-lived cookie holding the PKCE `code_verifier` (RFC 7636). Set at login,
 * replayed on the token exchange so a stolen/intercepted auth code cannot be
 * redeemed without it. httpOnly + server-only, same lifecycle as state/nonce.
 */
export const ENTRA_VERIFIER_COOKIE = 'ff_entra_verifier';

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
 * Generate a PKCE `code_verifier` (RFC 7636 §4.1): a high-entropy random string of
 * 43–128 chars from the unreserved set `[A-Za-z0-9-._~]`. base64url of 32 random
 * bytes yields a 43-char value drawn from `[A-Za-z0-9_-]` — within both the length
 * and charset rules.
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Compute the PKCE `code_challenge` for the S256 method (RFC 7636 §4.2):
 * `BASE64URL(SHA256(ASCII(code_verifier)))`. The challenge is sent on `/authorize`;
 * the verifier is replayed (only) on the token exchange, so the authorization server
 * binds the issued code to the holder of the verifier.
 */
export function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Build the Entra authorize URL for the auth-code flow. Requests an ID token
 * (`openid profile email`) for the configured app (single-tenant endpoint) and binds
 * the request with a PKCE S256 challenge (RFC 7636) — defence-in-depth on top of the
 * confidential-client secret. Entra accepts PKCE for confidential clients, so this is
 * purely additive.
 */
export function buildAuthorizeUrl(
  cfg: EntraConfig,
  state: string,
  nonce: string,
  codeChallenge: string,
): string {
  const base = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize`;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
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
export async function exchangeCodeForIdToken(
  cfg: EntraConfig,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    scope: 'openid profile email',
    // PKCE (RFC 7636): the server recomputes SHA256(code_verifier) and matches it
    // against the code_challenge sent at /authorize before issuing tokens.
    code_verifier: codeVerifier,
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

/** The id-token identity claims we accept as the signed-in subject, in order. */
const ENTRA_IDENTITY_CLAIMS = ['preferred_username', 'email', 'upn'] as const;

/**
 * Resolve the Entra ID token to forward to the bridge for `reviewerEmail`, BOUND to the
 * FibreFlow session identity. The bridge keys its ACL on the forwarded bearer, so a token
 * minted for a different Entra principal than the FF session must NEVER be forwarded —
 * otherwise Cortex would scope to the wrong user. Returns the token only when:
 *   - the cookie is present and non-blank, AND
 *   - an identity claim (`preferred_username` | `email` | `upn`) equals `reviewerEmail`
 *     (case-insensitive), AND
 *   - it is not expired (`exp`, when present).
 * Returns undefined otherwise → the caller falls back to the HS256 gateway JWT keyed on
 * `reviewerEmail` (fail closed). Never throws: an unparseable token is treated as absent.
 *
 * The signature is NOT verified here (the bridge does real OIDC RS256/JWKS verification);
 * this is an identity-binding + freshness gate only, defence-in-depth on top of that.
 */
export function getForwardableEntraIdToken(
  cookies: Partial<Record<string, string>> | undefined,
  reviewerEmail: string | undefined,
): string | undefined {
  const token = readEntraIdToken(cookies);
  const want = reviewerEmail?.trim().toLowerCase();
  if (!token || !want) return undefined;

  let claims: ReturnType<typeof decodeJwt>;
  try {
    claims = decodeJwt(token);
  } catch (err) {
    // Unparseable cookie value (corrupted / tampered) → treat as no token (HS256
    // fallback). Worth a warn: a well-behaved login never produces a malformed cookie.
    log.warn(`Discarding unparseable Entra ID-token cookie: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }

  const subject = ENTRA_IDENTITY_CLAIMS
    .map((k) => claims[k])
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0)
    ?.trim()
    .toLowerCase();
  if (!subject || subject !== want) return undefined; // identity mismatch → fail closed

  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) return undefined; // expired

  return token;
}
