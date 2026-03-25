/**
 * SharePoint Excel utility — reads ranges from the Shareholder Model workbook
 * via Microsoft Graph API using SHAREPOINT_* credentials (separate app from GRAPH_*).
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('graph:sharepoint-excel');

interface TokenCache {
  token: string;
  expiresAt: number;
}

/** Module-level token cache — survives across requests within the same Node.js process */
let spTokenCache: TokenCache | null = null;
let graphTokenCache: TokenCache | null = null;

/**
 * Acquires a Graph API access token using the SHAREPOINT_* app credentials.
 * Caches the token and refreshes 5 minutes before expiry.
 */
export async function getSharePointToken(): Promise<string> {
  if (spTokenCache && spTokenCache.expiresAt > Date.now() + 300_000) {
    return spTokenCache.token;
  }

  const tenantId = process.env.SHAREPOINT_TENANT_ID;
  const clientId = process.env.SHAREPOINT_CLIENT_ID;
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Missing SharePoint credentials: SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET required'
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SharePoint OAuth failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  spTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  logger.info('SharePoint access token acquired', { expiresIn: data.expires_in });
  return spTokenCache.token;
}

/**
 * Acquires a Graph API access token using GRAPH_* credentials (fallback from SHAREPOINT_*).
 * Used for SP Tracker Sync. Caches token and refreshes 5 minutes before expiry.
 */
export async function getGraphToken(): Promise<string> {
  if (graphTokenCache && graphTokenCache.expiresAt > Date.now() + 300_000) {
    return graphTokenCache.token;
  }

  const tenantId = process.env.SHAREPOINT_TENANT_ID || process.env.GRAPH_TENANT_ID;
  const clientId = process.env.SHAREPOINT_CLIENT_ID || process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET || process.env.GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Missing Graph credentials: requires GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET'
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Graph OAuth failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  graphTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  logger.info('Graph access token acquired', { expiresIn: data.expires_in });
  return graphTokenCache.token;
}

/**
 * Fetches a worksheet's used range (or a specific address range) from the
 * Shareholder Model Excel file.
 *
 * @param worksheet - Worksheet name, e.g. "Financial Summary"
 * @param range - Optional A1-notation range, e.g. "A1:Z100". Defaults to usedRange.
 * @returns Object with `values` — a 2D array of cell values (row × column).
 */
export async function getWorksheetRange(
  worksheet: string,
  range?: string
): Promise<{ values: unknown[][] }> {
  const driveId = process.env.SHAREHOLDER_MODEL_DRIVE_ID;
  const itemId = process.env.SHAREHOLDER_MODEL_ITEM_ID;

  if (!driveId || !itemId) {
    throw new Error(
      'Missing SHAREHOLDER_MODEL_DRIVE_ID or SHAREHOLDER_MODEL_ITEM_ID'
    );
  }

  const token = await getSharePointToken();
  const encodedSheet = encodeURIComponent(worksheet);
  const url = range
    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/${encodedSheet}/range(address='${encodeURIComponent(range)}')`
    : `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/${encodedSheet}/usedRange`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Graph Excel fetch failed for sheet "${worksheet}": ${response.status} ${errorText}`
    );
  }

  const data = await response.json() as { values: unknown[][] };
  logger.info('Worksheet range fetched', {
    worksheet,
    rows: data.values?.length ?? 0,
  });

  return { values: data.values ?? [] };
}
