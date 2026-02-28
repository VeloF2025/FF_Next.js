// 🟢 WORKING: Microsoft Graph API OAuth2 client-credentials auth with token caching
import { log } from '@/lib/logger';

/** Required environment configuration for Microsoft Graph API */
interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** In-memory token cache entry */
interface TokenCache {
  token: string;
  expiresAt: number;
}

/** Module-level token cache — survives across requests within the same Node.js process */
let tokenCache: TokenCache | null = null;

/**
 * Reads and validates Graph API credentials from environment variables.
 * Throws if any required variable is missing.
 */
export function getGraphConfig(): GraphConfig {
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Missing Graph API configuration: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET required'
    );
  }

  return { tenantId, clientId, clientSecret };
}

/**
 * Returns a valid Graph API access token, using the cached token when possible.
 * Automatically refreshes 5 minutes before expiry.
 */
export async function getGraphAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5-minute buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 300_000) {
    return tokenCache.token;
  }

  const config = getGraphConfig();
  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph OAuth failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    tokenCache = {
      token: data.access_token as string,
      expiresAt: Date.now() + (data.expires_in as number) * 1000,
    };

    log.info('Graph access token acquired', { expiresIn: data.expires_in }, 'GraphAuth');
    return tokenCache.token;
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Graph OAuth token request timed out after 30s');
    }
    throw error;
  }
}

/**
 * Authenticated fetch wrapper for Microsoft Graph API endpoints.
 * Automatically injects the Bearer token and retries once on 401.
 *
 * @param url - Full Graph API URL
 * @param options - Standard fetch RequestInit options (headers will be merged)
 */
export async function graphFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getGraphAccessToken();

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Retry once on 401 — token may have expired between cache check and use
  if (response.status === 401) {
    tokenCache = null;
    const freshToken = await getGraphAccessToken();
    return fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${freshToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  }

  return response;
}
