/**
 * Fibertime SharePoint Graph Client — delegated-auth via OAuth2 refresh token.
 * Uses /common endpoint to support cross-tenant guest access for
 * reporting@velocityfibre.co.za on isizweprojects.sharepoint.com/sites/FibertimeReports.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('graph:fibertime-sharepoint');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const TOKEN_SCOPES =
  'https://graph.microsoft.com/Files.Read.All https://graph.microsoft.com/Sites.Read.All offline_access';

// ============================================================================
// TYPES
// ============================================================================

export interface DriveItem {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
  '@microsoft.graph.downloadUrl'?: string;
}

export interface FibertimeGraphConfig {
  clientId: string;
  tenantId: string;
  refreshToken: string;
}

// ============================================================================
// TOKEN CACHE (module-level, survives across requests in same Node.js process)
// ============================================================================

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/** Module-level cache for site and drive IDs to avoid repeated round-trips */
let cachedSiteId: string | null = null;
let cachedDriveId: string | null = null;

// ============================================================================
// CONFIG
// ============================================================================

/**
 * Read and validate Fibertime SharePoint credentials from environment.
 * Throws a descriptive error if required vars are missing.
 */
export function getFibertimeConfig(): FibertimeGraphConfig {
  const clientId = process.env.FIBERTIME_SP_CLIENT_ID;
  const refreshToken = process.env.FIBERTIME_SP_REFRESH_TOKEN;
  const tenantId = process.env.GRAPH_TENANT_ID;

  if (!clientId) {
    throw new Error(
      'Missing env var: FIBERTIME_SP_CLIENT_ID (Azure AD public client app ID for device code flow)'
    );
  }
  if (!refreshToken) {
    throw new Error(
      'Missing env var: FIBERTIME_SP_REFRESH_TOKEN (run scripts/fibertime-device-auth.ts to obtain)'
    );
  }
  if (!tenantId) {
    throw new Error('Missing env var: GRAPH_TENANT_ID (velocityfibre.co.za tenant ID)');
  }

  return { clientId, tenantId, refreshToken };
}

// ============================================================================
// TOKEN ACQUISITION
// ============================================================================

/**
 * Returns a valid Graph access token. Caches and refreshes 5 min before expiry.
 * Persists rotated refresh tokens in module cache; FIBERTIME_SP_REFRESH_TOKEN
 * is only read on first call or after a process restart.
 */
export async function getFibertimeAccessToken(): Promise<string> {
  // Return cached token if still valid (5-minute buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 300_000) {
    return tokenCache.accessToken;
  }

  const config = getFibertimeConfig();
  const currentRefreshToken = tokenCache?.refreshToken ?? config.refreshToken;

  const params = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
    scope: TOKEN_SCOPES,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fibertime OAuth refresh failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    tokenCache = {
      accessToken: data.access_token,
      // Persist rotated refresh token if the server issues a new one
      refreshToken: data.refresh_token ?? currentRefreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    logger.info('Fibertime access token acquired', { expiresIn: data.expires_in });
    return tokenCache.accessToken;
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Fibertime OAuth token request timed out after 30s');
    }
    throw error;
  }
}

// ============================================================================
// AUTHENTICATED FETCH
// ============================================================================

/** Authenticated fetch — injects Bearer token, retries once on 401. */
export async function fibertimeFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getFibertimeAccessToken();

  const withAuth = (t: string): RequestInit => ({
    ...options,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const response = await fetch(url, withAuth(token));

  if (response.status === 401) {
    // Force refresh and retry once
    tokenCache = null;
    const freshToken = await getFibertimeAccessToken();
    return fetch(url, withAuth(freshToken));
  }

  return response;
}

// ============================================================================
// SITE & DRIVE RESOLUTION
// ============================================================================

/** Resolves + caches the site ID for isizweprojects.sharepoint.com/sites/FibertimeReports. */
export async function getSiteId(): Promise<string> {
  if (cachedSiteId) return cachedSiteId;

  const url = `${GRAPH_BASE}/sites/isizweprojects.sharepoint.com:/sites/FibertimeReports`;
  const response = await fibertimeFetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to resolve Fibertime site ID: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as { id: string };
  cachedSiteId = data.id;
  logger.info('Fibertime site ID resolved', { siteId: cachedSiteId });
  return cachedSiteId;
}

/** Resolves + caches the "Documents" drive ID within the Fibertime site. */
export async function getDriveId(siteId: string): Promise<string> {
  if (cachedDriveId) return cachedDriveId;

  const url = `${GRAPH_BASE}/sites/${siteId}/drives`;
  const response = await fibertimeFetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list Fibertime drives: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as { value: Array<{ id: string; name: string }> };
  const drive = data.value.find(
    d => d.name === 'Documents' || d.name.toLowerCase() === 'documents'
  );

  if (!drive) {
    const names = data.value.map(d => d.name).join(', ');
    throw new Error(`"Documents" drive not found in Fibertime site. Available drives: ${names}`);
  }

  cachedDriveId = drive.id;
  logger.info('Fibertime drive ID resolved', { driveId: cachedDriveId, driveName: drive.name });
  return cachedDriveId;
}

// ============================================================================
// FILE LISTING & DOWNLOAD
// ============================================================================

/**
 * Lists files in a SharePoint folder by path (relative to drive root).
 * Uses $select to fetch only required fields for efficiency.
 *
 * @param folderPath - e.g. "OES Report/Sites/LAW"
 * @returns Array of DriveItem objects (empty array if folder not found)
 */
export async function listFolderFiles(folderPath: string): Promise<DriveItem[]> {
  const siteId = await getSiteId();
  const driveId = await getDriveId(siteId);

  const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/');
  const url =
    `${GRAPH_BASE}/sites/${siteId}/drives/${driveId}/root:/${encodedPath}:/children` +
    `?$select=id,name,size,lastModifiedDateTime`;

  const response = await fibertimeFetch(url);

  if (response.status === 404) {
    logger.warn('Fibertime folder not found', { folderPath });
    return [];
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to list folder "${folderPath}": ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as { value: DriveItem[] };
  return data.value ?? [];
}

/**
 * Downloads a drive item as a Buffer, following the redirect issued by Graph.
 *
 * @param itemId - Drive item ID from listFolderFiles
 * @returns Buffer with file contents
 */
export async function downloadFileBuffer(itemId: string): Promise<Buffer> {
  const siteId = await getSiteId();
  const driveId = await getDriveId(siteId);

  const url = `${GRAPH_BASE}/sites/${siteId}/drives/${driveId}/items/${itemId}/content`;
  const response = await fibertimeFetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to download file ${itemId}: ${response.status} ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
