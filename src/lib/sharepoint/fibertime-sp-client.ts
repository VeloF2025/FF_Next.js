/**
 * Fibertime SharePoint REST API Client — cookie-based auth.
 *
 * Authentication is done interactively via scripts/fibertime-sp-login.ts,
 * which saves Playwright session cookies to FIBERTIME_SP_COOKIE_FILE.
 * This client loads those cookies and injects them as a Cookie header.
 *
 * Cookie file is refreshed manually (~every 30-90 days) when the session expires.
 * The API endpoint returns 401 when cookies are stale → FibertimeAuthExpiredError.
 */

import * as fs from 'fs';
import { createLogger } from '@/lib/logger';

const logger = createLogger('sharepoint:fibertime-sp-client');

const SP_BASE = 'https://isizweprojects.sharepoint.com/sites/FibertimeReports';

// ============================================================================
// ERRORS
// ============================================================================

export class FibertimeAuthExpiredError extends Error {
  constructor(message = 'Fibertime SharePoint session expired — run scripts/fibertime-sp-login.ts to refresh cookies') {
    super(message);
    this.name = 'FibertimeAuthExpiredError';
  }
}

// ============================================================================
// TYPES
// ============================================================================

export interface SpFileItem {
  /** Server-relative URL — used as the download identifier */
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
}

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

// ============================================================================
// COOKIE LOADING
// ============================================================================

/**
 * Reads the Playwright cookie file and builds a Cookie header string.
 * Only includes cookies relevant to isizweprojects.sharepoint.com.
 */
export function loadCookieHeader(): string {
  const cookieFile = process.env.FIBERTIME_SP_COOKIE_FILE;
  if (!cookieFile) {
    throw new Error(
      'Missing env var: FIBERTIME_SP_COOKIE_FILE — set it to the path of your Playwright cookie JSON file'
    );
  }

  if (!fs.existsSync(cookieFile)) {
    throw new FibertimeAuthExpiredError(
      `Fibertime cookie file not found at ${cookieFile} — run scripts/fibertime-sp-login.ts`
    );
  }

  let cookies: PlaywrightCookie[];
  try {
    cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf-8')) as PlaywrightCookie[];
  } catch {
    throw new Error(`Failed to parse cookie file at ${cookieFile} — file may be corrupt`);
  }

  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new FibertimeAuthExpiredError(`Cookie file at ${cookieFile} is empty — re-run scripts/fibertime-sp-login.ts`);
  }

  // Only use cookies that are not expired and match sharepoint.com or microsoftonline.com
  const now = Date.now() / 1000;
  const relevant = cookies.filter(c => {
    if (c.expires !== -1 && c.expires < now) return false;
    return (
      c.domain.includes('sharepoint.com') ||
      c.domain.includes('microsoftonline.com') ||
      c.domain.includes('microsoft.com') ||
      c.domain.includes('office.com')
    );
  });

  if (relevant.length === 0) {
    throw new FibertimeAuthExpiredError('All Fibertime SharePoint cookies have expired — re-run scripts/fibertime-sp-login.ts');
  }

  logger.info('Fibertime cookies loaded', { total: cookies.length, relevant: relevant.length });
  return relevant.map(c => `${c.name}=${c.value}`).join('; ');
}

// ============================================================================
// AUTHENTICATED FETCH
// ============================================================================

/**
 * Fetch with SharePoint session cookies injected.
 * Throws FibertimeAuthExpiredError on 401/403.
 */
async function spFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const cookieHeader = loadCookieHeader();

  const response = await fetch(url, {
    ...options,
    headers: {
      Cookie: cookieHeader,
      Accept: 'application/json;odata=nometadata',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new FibertimeAuthExpiredError();
  }

  return response;
}

// ============================================================================
// FILE LISTING
// ============================================================================

/**
 * Lists files in a SharePoint folder.
 *
 * @param folderPath - Relative to "Shared Documents", e.g. "OES Report/Sites/LAW"
 * @returns Array of SpFileItem (empty array if folder not found / no files)
 */
export async function listFolderFiles(folderPath: string): Promise<SpFileItem[]> {
  const serverRelativeFolder = `/sites/FibertimeReports/Shared Documents/${folderPath}`;
  const encodedFolder = encodeURIComponent(serverRelativeFolder);
  const url =
    `${SP_BASE}/_api/web/GetFolderByServerRelativePath(decodedUrl='${encodedFolder}')/Files` +
    `?$select=Name,Length,TimeLastModified,ServerRelativeUrl`;

  const response = await spFetch(url);

  if (response.status === 404) {
    logger.warn('Fibertime folder not found', { folderPath });
    return [];
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list Fibertime folder "${folderPath}": ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    value: Array<{
      Name: string;
      Length: string;
      TimeLastModified: string;
      ServerRelativeUrl: string;
    }>;
  };

  return (data.value ?? []).map(f => ({
    id: f.ServerRelativeUrl,
    name: f.Name,
    size: parseInt(f.Length, 10),
    lastModifiedDateTime: f.TimeLastModified,
  }));
}

// ============================================================================
// FILE LISTING (ALT — uses GetFolderByServerRelativeUrl)
// ============================================================================

/**
 * Lists files using `GetFolderByServerRelativeUrl` instead of
 * `GetFolderByServerRelativePath`. Required for the Offline ONT Report folder
 * which returns 403 with the Path API variant.
 *
 * @param folderPath - Relative to "Shared Documents", e.g. "Offline ONT Report/Sites/LAW"
 * @returns Array of SpFileItem (empty array if folder not found / no files)
 */
export async function listFolderFilesAlt(folderPath: string): Promise<SpFileItem[]> {
  const serverRelativeFolder = `/sites/FibertimeReports/Shared Documents/${folderPath}`;
  const encodedFolder = encodeURIComponent(serverRelativeFolder);
  const url =
    `${SP_BASE}/_api/web/GetFolderByServerRelativeUrl('${encodedFolder}')/Files` +
    `?$select=Name,Length,TimeLastModified,ServerRelativeUrl`;

  const response = await spFetch(url);

  if (response.status === 404) {
    logger.warn('Fibertime folder not found (alt)', { folderPath });
    return [];
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list Fibertime folder (alt) "${folderPath}": ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    value: Array<{
      Name: string;
      Length: string;
      TimeLastModified: string;
      ServerRelativeUrl: string;
    }>;
  };

  return (data.value ?? []).map(f => ({
    id: f.ServerRelativeUrl,
    name: f.Name,
    size: parseInt(f.Length, 10),
    lastModifiedDateTime: f.TimeLastModified,
  }));
}

// ============================================================================
// FILE DOWNLOAD
// ============================================================================

/**
 * Downloads a SharePoint file as a Buffer.
 *
 * @param serverRelativeUrl - e.g. "/sites/FibertimeReports/Shared Documents/OES Report/Sites/LAW/oes_status_report_LAW_20260411.xlsx"
 */
export async function downloadFileBuffer(serverRelativeUrl: string): Promise<Buffer> {
  const encoded = encodeURIComponent(serverRelativeUrl);
  const url = `${SP_BASE}/_api/web/GetFileByServerRelativePath(decodedUrl='${encoded}')/$value`;

  const response = await spFetch(url, {
    headers: {
      // Override Accept for binary download
      Accept: '*/*',
      'Content-Type': '',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to download Fibertime file "${serverRelativeUrl}": ${response.status} ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
