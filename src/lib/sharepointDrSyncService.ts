/**
 * SharePoint DR Sync Service
 *
 * Core service for syncing DR photos to SharePoint with folder hierarchy:
 * Projects/{Project}/{Zone}/{PON}/{Pole}/{DR}/photos
 *
 * SharePoint Path: \blitzfibre.com\Velocity_Manco - Documents\Velocity_Quality_Assurance\Regional Home Drops\Projects
 *
 * Status: NEW
 * NLNH Confidence: HIGH
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type {
  DrFolderInfo,
  FolderCreationResult,
  PhotoUploadResult,
  DrPhotoSyncResult,
  SharePointDrSyncRecord,
  SharePointSyncStatus,
  SharePointSyncStatusResponse,
  SharePointFolderInfo,
} from '@/modules/activate/types/sharepoint.types';

// Microsoft Graph API base URL
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

// Rate limiting delay between API calls (ms)
const RATE_LIMIT_DELAY = 100;

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * SharePoint configuration interface
 */
interface SharePointDrConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  driveId: string;
  rootFolderId: string; // ID of "Projects" folder
}

/**
 * Get database connection
 */
function getDbConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

/**
 * Get SharePoint configuration from environment variables
 */
export function getSharePointDrConfig(): SharePointDrConfig | null {
  const tenantId = process.env.SHAREPOINT_TENANT_ID;
  const clientId = process.env.SHAREPOINT_CLIENT_ID;
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET;
  const siteId = process.env.SHAREPOINT_SITE_ID;
  const driveId = process.env.SHAREPOINT_DRIVE_ID;
  const rootFolderId = process.env.SHAREPOINT_DR_ROOT_FOLDER_ID;

  if (!tenantId || !clientId || !clientSecret || !siteId || !driveId || !rootFolderId) {
    return null;
  }

  return { tenantId, clientId, clientSecret, siteId, driveId, rootFolderId };
}

/**
 * Check if SharePoint DR sync is enabled
 */
export function isSharePointDrSyncEnabled(): boolean {
  return process.env.SHAREPOINT_DR_SYNC_ENABLED === 'true';
}

/**
 * Get OAuth access token for Microsoft Graph API
 */
export async function getAccessToken(config: SharePointDrConfig): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

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
      throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.access_token;
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('OAuth token request timed out after 30 seconds');
    }
    throw error;
  }
}

/**
 * Retry wrapper with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = RETRY_CONFIG.maxRetries,
  baseDelay: number = RETRY_CONFIG.baseDelayMs
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) break;

      const delay = Math.min(baseDelay * Math.pow(2, attempt), RETRY_CONFIG.maxDelayMs);
      log.debug(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, undefined, 'SharePointDrSync');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Rate limiting helper
 */
async function rateLimit(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
}

/**
 * Check if a folder exists in SharePoint
 */
export async function checkFolderExists(
  accessToken: string,
  config: SharePointDrConfig,
  parentFolderId: string,
  folderName: string
): Promise<SharePointFolderInfo | null> {
  const url = `${GRAPH_API_BASE}/drives/${config.driveId}/items/${parentFolderId}/children?$filter=name eq '${encodeURIComponent(folderName)}'`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    const errorText = await response.text();
    throw new Error(`Failed to check folder: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const folder = data.value?.[0];

  if (!folder) return null;

  return {
    id: folder.id,
    name: folder.name,
    webUrl: folder.webUrl,
    parentReference: folder.parentReference,
  };
}

/**
 * Create a folder in SharePoint
 */
export async function createFolder(
  accessToken: string,
  config: SharePointDrConfig,
  parentFolderId: string,
  folderName: string
): Promise<SharePointFolderInfo> {
  const url = `${GRAPH_API_BASE}/drives/${config.driveId}/items/${parentFolderId}/children`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail', // Don't overwrite
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Check if folder already exists (409 Conflict)
    if (response.status === 409) {
      // Folder exists, try to get it
      const existing = await checkFolderExists(accessToken, config, parentFolderId, folderName);
      if (existing) return existing;
    }
    throw new Error(`Failed to create folder '${folderName}': ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    name: data.name,
    webUrl: data.webUrl,
    parentReference: data.parentReference,
  };
}

/**
 * Ensure a folder exists, creating it if necessary
 */
async function ensureFolder(
  accessToken: string,
  config: SharePointDrConfig,
  parentFolderId: string,
  folderName: string
): Promise<SharePointFolderInfo> {
  // Check if folder exists
  const existing = await checkFolderExists(accessToken, config, parentFolderId, folderName);
  if (existing) return existing;

  // Create folder
  await rateLimit();
  return createFolder(accessToken, config, parentFolderId, folderName);
}

/**
 * Build folder name for each level
 */
function buildFolderNames(info: DrFolderInfo): {
  project: string;
  zone: string;
  pon: string;
  pole: string;
  dr: string;
} {
  return {
    project: info.project || 'Unknown_Project',
    zone: info.zoneNo ? `Zone_${String(info.zoneNo).padStart(2, '0')}` : 'Zone_Unknown',
    pon: info.ponNo ? `PON_${String(info.ponNo).padStart(3, '0')}` : 'PON_Unknown',
    pole: info.poleNumber || 'Pole_Unknown',
    dr: info.dropNumber,
  };
}

/**
 * Create full folder hierarchy for a DR
 */
export async function createDrFolderHierarchy(
  accessToken: string,
  config: SharePointDrConfig,
  info: DrFolderInfo
): Promise<FolderCreationResult> {
  try {
    const folderNames = buildFolderNames(info);
    const parentFolderIds: { project: string; zone: string; pon: string; pole: string } = {
      project: '',
      zone: '',
      pon: '',
      pole: '',
    };

    // Create/ensure each level of hierarchy
    // 1. Project folder
    const projectFolder = await retryWithBackoff(() =>
      ensureFolder(accessToken, config, config.rootFolderId, folderNames.project)
    );
    parentFolderIds.project = projectFolder.id;

    // 2. Zone folder
    await rateLimit();
    const zoneFolder = await retryWithBackoff(() =>
      ensureFolder(accessToken, config, projectFolder.id, folderNames.zone)
    );
    parentFolderIds.zone = zoneFolder.id;

    // 3. PON folder
    await rateLimit();
    const ponFolder = await retryWithBackoff(() =>
      ensureFolder(accessToken, config, zoneFolder.id, folderNames.pon)
    );
    parentFolderIds.pon = ponFolder.id;

    // 4. Pole folder
    await rateLimit();
    const poleFolder = await retryWithBackoff(() =>
      ensureFolder(accessToken, config, ponFolder.id, folderNames.pole)
    );
    parentFolderIds.pole = poleFolder.id;

    // 5. DR folder
    await rateLimit();
    const drFolder = await retryWithBackoff(() =>
      ensureFolder(accessToken, config, poleFolder.id, folderNames.dr)
    );

    const folderPath = `/${folderNames.project}/${folderNames.zone}/${folderNames.pon}/${folderNames.pole}/${folderNames.dr}`;

    log.info(`Created folder hierarchy for ${info.dropNumber}`, {
      folderPath,
      folderId: drFolder.id,
    }, 'SharePointDrSync');

    return {
      success: true,
      dropNumber: info.dropNumber,
      folderId: drFolder.id,
      folderPath,
      parentFolderIds,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to create folder hierarchy for ${info.dropNumber}`, { error: errorMessage }, 'SharePointDrSync');
    return {
      success: false,
      dropNumber: info.dropNumber,
      error: errorMessage,
    };
  }
}

/**
 * Upload a photo to SharePoint DR folder
 */
export async function uploadPhoto(
  accessToken: string,
  config: SharePointDrConfig,
  drFolderId: string,
  filename: string,
  buffer: Buffer
): Promise<PhotoUploadResult> {
  try {
    // For files < 4MB, use simple upload
    // For larger files, would need to use upload session (not implemented yet)
    const url = `${GRAPH_API_BASE}/drives/${config.driveId}/items/${drFolderId}:/${filename}:/content`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      // Node.js Buffer is compatible with fetch body in Node 18+
      body: buffer as unknown as BodyInit,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return {
      success: true,
      filename,
      sharePointId: data.id,
      size: data.size,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      filename,
      error: errorMessage,
    };
  }
}

/**
 * Sync all photos for a DR to SharePoint
 */
export async function syncDrPhotos(
  dropNumber: string,
  drFolderId: string
): Promise<DrPhotoSyncResult> {
  const config = getSharePointDrConfig();
  if (!config) {
    return { success: false, dropNumber, photosUploaded: 0, photosFailed: 0, photos: [], error: 'SharePoint not configured' };
  }

  try {
    const accessToken = await getAccessToken(config);

    // Fetch photos from OneMap via internal API
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005';
    const fetchResponse = await fetch(`${baseUrl}/api/activate/fetch-photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dropNumber, force: false }),
    });

    if (!fetchResponse.ok) {
      throw new Error(`Failed to fetch photos: ${fetchResponse.status}`);
    }

    const fetchData = await fetchResponse.json();
    const photos = fetchData.data?.photos || [];

    if (photos.length === 0) {
      return { success: true, dropNumber, photosUploaded: 0, photosFailed: 0, photos: [] };
    }

    const results: PhotoUploadResult[] = [];
    let uploaded = 0;
    let failed = 0;

    for (const photo of photos) {
      // Download photo from proxy
      const photoUrl = `${baseUrl}${photo.url}`;
      const photoResponse = await fetch(photoUrl);

      if (!photoResponse.ok) {
        results.push({ success: false, filename: photo.filename, error: `Download failed: ${photoResponse.status}` });
        failed++;
        continue;
      }

      const buffer = Buffer.from(await photoResponse.arrayBuffer());

      // Upload to SharePoint
      await rateLimit();
      const uploadResult = await retryWithBackoff(() =>
        uploadPhoto(accessToken, config, drFolderId, photo.filename, buffer)
      );

      results.push(uploadResult);
      if (uploadResult.success) {
        uploaded++;
      } else {
        failed++;
      }
    }

    log.info(`Photo sync complete for ${dropNumber}`, { uploaded, failed, total: photos.length }, 'SharePointDrSync');

    return {
      success: failed === 0,
      dropNumber,
      photosUploaded: uploaded,
      photosFailed: failed,
      photos: results,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Photo sync failed for ${dropNumber}`, { error: errorMessage }, 'SharePointDrSync');
    return {
      success: false,
      dropNumber,
      photosUploaded: 0,
      photosFailed: 0,
      photos: [],
      error: errorMessage,
    };
  }
}

/**
 * Get DR folder info from drops table
 */
export async function getDrFolderInfoFromDb(dropNumber: string): Promise<DrFolderInfo | null> {
  const sql = getDbConnection();

  const result = await sql`
    SELECT
      d.drop_number,
      p.project_name as project,
      d.zone_no,
      d.pon_no,
      d.pole_number
    FROM drops d
    LEFT JOIN projects p ON d.project_id = p.id
    WHERE d.drop_number = ${dropNumber}
    LIMIT 1
  `;

  if (result.length === 0) return null;

  const row = result[0] as Record<string, unknown>;
  if (!row) return null;

  return {
    dropNumber: String(row.drop_number || ''),
    project: String(row.project || 'Unknown'),
    zoneNo: row.zone_no != null ? Number(row.zone_no) : null,
    ponNo: row.pon_no != null ? Number(row.pon_no) : null,
    poleNumber: row.pole_number != null ? String(row.pole_number) : null,
  };
}

/**
 * Get or create SharePoint sync record for a DR
 */
export async function getOrCreateSyncRecord(
  dropNumber: string,
  source: string
): Promise<SharePointDrSyncRecord | null> {
  const sql = getDbConnection();

  // Check if record exists
  const existing = await sql`
    SELECT * FROM sharepoint_dr_sync WHERE drop_number = ${dropNumber}
  `;

  if (existing.length > 0) {
    return existing[0] as SharePointDrSyncRecord;
  }

  // Get folder info from drops table
  const folderInfo = await getDrFolderInfoFromDb(dropNumber);
  if (!folderInfo) {
    log.warn(`DR ${dropNumber} not found in drops table`, undefined, 'SharePointDrSync');
    return null;
  }

  // Create new record
  const inserted = await sql`
    INSERT INTO sharepoint_dr_sync (
      drop_number, project, zone_no, pon_no, pole_number, source
    ) VALUES (
      ${dropNumber}, ${folderInfo.project}, ${folderInfo.zoneNo}, ${folderInfo.ponNo}, ${folderInfo.poleNumber}, ${source}
    )
    RETURNING *
  `;

  return inserted[0] as SharePointDrSyncRecord;
}

/**
 * Update sync record after folder creation
 */
export async function updateSyncRecordFolder(
  dropNumber: string,
  folderId: string,
  folderPath: string,
  parentFolderIds: { project: string; zone: string; pon: string; pole: string }
): Promise<void> {
  const sql = getDbConnection();

  await sql`
    UPDATE sharepoint_dr_sync
    SET
      folder_created = true,
      folder_created_at = NOW(),
      folder_id = ${folderId},
      folder_path = ${folderPath},
      project_folder_id = ${parentFolderIds.project},
      zone_folder_id = ${parentFolderIds.zone},
      pon_folder_id = ${parentFolderIds.pon},
      pole_folder_id = ${parentFolderIds.pole},
      updated_at = NOW()
    WHERE drop_number = ${dropNumber}
  `;
}

/**
 * Update sync record after photo sync
 */
export async function updateSyncRecordPhotos(
  dropNumber: string,
  photosCount: number,
  photosTotal: number,
  error?: string
): Promise<void> {
  const sql = getDbConnection();

  await sql`
    UPDATE sharepoint_dr_sync
    SET
      photos_synced = ${!error},
      photos_synced_at = ${error ? null : new Date().toISOString()},
      photos_count = ${photosCount},
      photos_total = ${photosTotal},
      last_sync_attempt_at = NOW(),
      sync_error = ${error || null},
      sync_retry_count = CASE WHEN ${!!error} THEN sync_retry_count + 1 ELSE 0 END,
      updated_at = NOW()
    WHERE drop_number = ${dropNumber}
  `;
}

/**
 * Get sync status for a DR
 */
export async function getSyncStatus(dropNumber: string): Promise<SharePointSyncStatusResponse | null> {
  const sql = getDbConnection();

  const result = await sql`
    SELECT * FROM sharepoint_dr_sync WHERE drop_number = ${dropNumber}
  `;

  if (result.length === 0) return null;

  const record = result[0] as SharePointDrSyncRecord;

  let status: SharePointSyncStatus;
  if (record.sync_error) {
    status = 'error';
  } else if (record.photos_synced) {
    status = 'synced';
  } else if (record.folder_created) {
    status = 'folder_created';
  } else {
    status = 'pending_folder';
  }

  return {
    dropNumber: record.drop_number,
    status,
    folderCreated: record.folder_created,
    folderPath: record.folder_path,
    folderId: record.folder_id,
    photosSynced: record.photos_synced,
    photosCount: record.photos_count,
    photosTotal: record.photos_total,
    lastSyncAt: record.photos_synced_at || record.folder_created_at,
    error: record.sync_error,
  };
}

/**
 * Full sync for a DR - create folder and sync photos
 */
export async function fullDrSync(
  dropNumber: string,
  source: string = 'manual'
): Promise<{ folderResult: FolderCreationResult; photoResult?: DrPhotoSyncResult }> {
  const config = getSharePointDrConfig();
  if (!config) {
    return {
      folderResult: { success: false, dropNumber, error: 'SharePoint not configured' },
    };
  }

  // Get or create sync record
  const syncRecord = await getOrCreateSyncRecord(dropNumber, source);
  if (!syncRecord) {
    return {
      folderResult: { success: false, dropNumber, error: 'DR not found in drops table' },
    };
  }

  // Get folder info
  const folderInfo = await getDrFolderInfoFromDb(dropNumber);
  if (!folderInfo) {
    return {
      folderResult: { success: false, dropNumber, error: 'DR folder info not found' },
    };
  }

  // Create folder hierarchy if not exists
  let folderResult: FolderCreationResult;
  let folderId = syncRecord.folder_id;

  if (!syncRecord.folder_created || !folderId) {
    const accessToken = await getAccessToken(config);
    folderResult = await createDrFolderHierarchy(accessToken, config, folderInfo);

    if (folderResult.success && folderResult.folderId && folderResult.parentFolderIds) {
      await updateSyncRecordFolder(
        dropNumber,
        folderResult.folderId,
        folderResult.folderPath || '',
        folderResult.parentFolderIds
      );
      folderId = folderResult.folderId;
    }
  } else {
    folderResult = {
      success: true,
      dropNumber,
      folderId: syncRecord.folder_id || undefined,
      folderPath: syncRecord.folder_path || undefined,
    };
  }

  // If folder creation failed, don't try to sync photos
  if (!folderResult.success || !folderId) {
    return { folderResult };
  }

  // Sync photos
  const photoResult = await syncDrPhotos(dropNumber, folderId);

  // Update sync record
  await updateSyncRecordPhotos(
    dropNumber,
    photoResult.photosUploaded,
    photoResult.photosUploaded + photoResult.photosFailed,
    photoResult.error
  );

  return { folderResult, photoResult };
}

/**
 * Get DRs pending photo sync (folder created but photos not synced)
 */
export async function getDrsPendingPhotoSync(limit: number = 50): Promise<string[]> {
  const sql = getDbConnection();

  const result = await sql`
    SELECT drop_number
    FROM sharepoint_dr_sync
    WHERE folder_created = true
      AND photos_synced = false
      AND (sync_retry_count < 3 OR sync_retry_count IS NULL)
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  return result.map(r => r.drop_number as string);
}
