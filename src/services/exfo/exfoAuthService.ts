/**
 * EXFO Exchange Authentication Service
 *
 * Authenticates with EXFO Exchange via Firebase Identity Toolkit.
 * Server-side only — uses email/password to obtain JWT Bearer tokens.
 * Tokens are cached in memory and refreshed before expiry.
 */

import { createLogger } from '@/lib/logger';
import type { ExfoAuthTokens } from './types';

const logger = createLogger('exfoAuth');

// Firebase Identity Toolkit endpoint
const FIREBASE_API_KEY = 'AIzaSyD1OuV9WUd524L9ybECyLwADBjnV8NQr6s';
const FIREBASE_SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
const FIREBASE_REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
// Real EXFO Exchange tenant ID — "FIXME-fdjb0" is the actual value, not a placeholder
const TENANT_ID = 'FIXME-fdjb0';

// Token refresh buffer (5 minutes before expiry)
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// In-memory token cache
let cachedTokens: ExfoAuthTokens | null = null;

/**
 * Get a valid JWT token for EXFO Exchange API calls.
 * Handles caching and automatic refresh.
 */
export async function getExfoToken(): Promise<string> {
  // Check if cached token is still valid
  if (cachedTokens && Date.now() < cachedTokens.expiresAt - REFRESH_BUFFER_MS) {
    return cachedTokens.idToken;
  }

  // Try refresh if we have a refresh token
  if (cachedTokens?.refreshToken) {
    try {
      const refreshed = await refreshToken(cachedTokens.refreshToken);
      cachedTokens = refreshed;
      logger.info('EXFO token refreshed successfully');
      return refreshed.idToken;
    } catch (err) {
      logger.warn('EXFO token refresh failed, re-authenticating', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Full sign-in
  const tokens = await signIn();
  cachedTokens = tokens;
  return tokens.idToken;
}

/**
 * Sign in with email/password via Firebase Identity Toolkit
 */
async function signIn(): Promise<ExfoAuthTokens> {
  const email = process.env.EXFO_EMAIL;
  const password = process.env.EXFO_PASSWORD;

  if (!email || !password) {
    throw new Error('EXFO_EMAIL and EXFO_PASSWORD environment variables required');
  }

  logger.info('Authenticating with EXFO Exchange');

  const response = await fetch(FIREBASE_SIGN_IN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
      tenantId: TENANT_ID,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData?.error?.message || response.statusText;
    logger.error('EXFO auth failed', { status: response.status, error: errorMsg });
    throw new Error(`EXFO authentication failed: ${errorMsg}`);
  }

  const data = await response.json();
  const expiresIn = parseInt(data.expiresIn, 10) || 3600;

  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresIn: data.expiresIn,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

/**
 * Refresh an expired token using the refresh token
 */
async function refreshToken(refreshTokenValue: string): Promise<ExfoAuthTokens> {
  const response = await fetch(FIREBASE_REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenValue,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = await response.json();
  const expiresIn = parseInt(data.expires_in, 10) || 3600;

  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresIn: String(expiresIn),
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

/**
 * Clear cached tokens (useful for testing or forced re-auth)
 */
export function clearExfoTokenCache(): void {
  cachedTokens = null;
  logger.info('EXFO token cache cleared');
}
