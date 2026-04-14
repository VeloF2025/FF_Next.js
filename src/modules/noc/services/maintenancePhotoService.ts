/**
 * Maintenance Photo Processing Service
 *
 * Handles downloading WhatsApp photos from the bridge and uploading to SharePoint.
 * Processes photos from the maintenance_wa_photos table that have pending status.
 *
 * Flow:
 * 1. Query pending photos from maintenance_wa_photos
 * 2. Request download from WhatsApp bridge /api/download
 * 3. Upload to SharePoint under Maintenance/{Project}/{DR}/
 * 4. Update status to 'uploaded' with SharePoint URL
 *
 * @module maintenance/services/maintenancePhotoService
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import fs from 'fs';

const logger = createLogger('maintenancePhotoService');

// ============================================================================
// Configuration
// ============================================================================

// Bridge URL for downloading media (on Velocity server)
const WA_BRIDGE_DOWNLOAD_URL =
  process.env.WA_BRIDGE_URL || 'http://72.61.197.178:8083/api/download';

// SharePoint configuration - reuse existing settings
const SHAREPOINT_TENANT_ID = process.env.SHAREPOINT_TENANT_ID;
const SHAREPOINT_CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID;
const SHAREPOINT_CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET;
const SHAREPOINT_SITE_ID = process.env.SHAREPOINT_SITE_ID;
const SHAREPOINT_DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID;

// Maintenance photos folder path in SharePoint
const MAINTENANCE_FOLDER_PATH = 'Maintenance';

// ============================================================================
// Database Connection
// ============================================================================

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

// ============================================================================
// Types
// ============================================================================

interface PendingPhoto {
  id: string;
  message_id: string;
  drop_number: string;
  project: string;
  wa_media_id: string;
  mime_type: string;
  photo_index: number;
}

interface DownloadResult {
  success: boolean;
  filename?: string;
  path?: string;
  error?: string;
}

interface SharePointUploadResult {
  success: boolean;
  sharepoint_url?: string;
  error?: string;
}

// ============================================================================
// WhatsApp Bridge Media Download
// ============================================================================

/**
 * Download media from WhatsApp bridge
 */
async function downloadFromBridge(
  messageId: string,
  chatJid: string
): Promise<DownloadResult> {
  try {
    const response = await fetch(WA_BRIDGE_DOWNLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_id: messageId,
        chat_jid: chatJid,
      }),
    });

    const result = await response.json();

    if (result.success && result.path) {
      return {
        success: true,
        filename: result.filename,
        path: result.path,
      };
    }

    return {
      success: false,
      error: result.message || 'Unknown download error',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Download failed',
    };
  }
}

// ============================================================================
// SharePoint Upload
// ============================================================================

/**
 * Get SharePoint access token using client credentials
 */
async function getSharePointAccessToken(): Promise<string | null> {
  if (!SHAREPOINT_TENANT_ID || !SHAREPOINT_CLIENT_ID || !SHAREPOINT_CLIENT_SECRET) {
    logger.warn('SharePoint credentials not configured');
    return null;
  }

  try {
    const tokenUrl = `https://login.microsoftonline.com/${SHAREPOINT_TENANT_ID}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      client_id: SHAREPOINT_CLIENT_ID,
      client_secret: SHAREPOINT_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const result = await response.json();
    return result.access_token || null;
  } catch (error) {
    logger.error('Failed to get SharePoint access token', { error });
    return null;
  }
}

/**
 * Upload file to SharePoint
 */
async function uploadToSharePoint(
  localPath: string,
  remotePath: string,
  filename: string
): Promise<SharePointUploadResult> {
  const accessToken = await getSharePointAccessToken();
  if (!accessToken) {
    return { success: false, error: 'No SharePoint access token' };
  }

  if (!SHAREPOINT_SITE_ID || !SHAREPOINT_DRIVE_ID) {
    return { success: false, error: 'SharePoint site/drive not configured' };
  }

  try {
    // Read local file
    const fileBuffer = fs.readFileSync(localPath);

    // Construct SharePoint path
    const fullPath = `${remotePath}/${filename}`;
    const encodedPath = encodeURIComponent(fullPath).replace(/%2F/g, '/');

    // Upload to SharePoint using Graph API
    const uploadUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_SITE_ID}/drives/${SHAREPOINT_DRIVE_ID}/root:/${encodedPath}:/content`;

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: fileBuffer,
    });

    if (response.ok) {
      const result = await response.json();
      return {
        success: true,
        sharepoint_url: result.webUrl,
      };
    }

    const errorText = await response.text();
    return {
      success: false,
      error: `SharePoint upload failed: ${response.status} - ${errorText}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SharePoint upload failed',
    };
  }
}

// ============================================================================
// Photo Processing
// ============================================================================

/**
 * Get pending photos that need processing
 */
export async function getPendingPhotos(limit = 10): Promise<PendingPhoto[]> {
  const sql = getDb();

  const result = await sql`
    SELECT
      p.id,
      p.message_id,
      p.drop_number,
      p.project,
      p.wa_media_id,
      p.mime_type,
      p.photo_index,
      m.wa_message_id,
      m.wa_group_jid
    FROM maintenance_wa_photos p
    JOIN maintenance_wa_messages m ON p.message_id = m.id
    WHERE p.upload_status = 'pending'
    ORDER BY p.created_at ASC
    LIMIT ${limit}
  `;

  return result as unknown as PendingPhoto[];
}

/**
 * Update photo status after processing
 */
async function updatePhotoStatus(
  photoId: string,
  status: 'uploading' | 'uploaded' | 'failed',
  sharepointUrl?: string,
  error?: string
): Promise<void> {
  const sql = getDb();

  await sql`
    UPDATE maintenance_wa_photos
    SET
      upload_status = ${status},
      sharepoint_url = COALESCE(${sharepointUrl || null}, sharepoint_url),
      upload_error = ${error || null},
      uploaded_at = CASE WHEN ${status} = 'uploaded' THEN NOW() ELSE uploaded_at END,
      updated_at = NOW()
    WHERE id = ${photoId}
  `;
}

/**
 * Process a single pending photo
 */
export async function processPhoto(photo: PendingPhoto): Promise<{
  success: boolean;
  sharepoint_url?: string;
  error?: string;
}> {
  const sql = getDb();

  // Get the original WA message ID and group JID
  const messageResult = await sql`
    SELECT wa_message_id, wa_group_jid FROM maintenance_wa_messages WHERE id = ${photo.message_id}
  `;

  if (messageResult.length === 0) {
    return { success: false, error: 'Message not found' };
  }

  const messageRow = messageResult[0] as { wa_message_id: string; wa_group_jid: string };
  const waMessageId = messageRow.wa_message_id;
  const waGroupJid = messageRow.wa_group_jid;

  // Mark as uploading
  await updatePhotoStatus(photo.id, 'uploading');

  // Step 1: Download from WhatsApp bridge
  logger.info('Downloading photo from bridge', { photoId: photo.id, messageId: waMessageId });

  const downloadResult = await downloadFromBridge(waMessageId, waGroupJid);

  if (!downloadResult.success || !downloadResult.path) {
    await updatePhotoStatus(photo.id, 'failed', undefined, downloadResult.error);
    return { success: false, error: downloadResult.error };
  }

  // Step 2: Upload to SharePoint
  const remotePath = `${MAINTENANCE_FOLDER_PATH}/${photo.project}/${photo.drop_number}`;
  const filename = downloadResult.filename || `photo_${photo.photo_index}.jpg`;

  logger.info('Uploading photo to SharePoint', { photoId: photo.id, remotePath, filename });

  const uploadResult = await uploadToSharePoint(
    downloadResult.path,
    remotePath,
    filename
  );

  if (!uploadResult.success) {
    await updatePhotoStatus(photo.id, 'failed', undefined, uploadResult.error);
    return { success: false, error: uploadResult.error };
  }

  // Step 3: Update status to uploaded
  await updatePhotoStatus(photo.id, 'uploaded', uploadResult.sharepoint_url);

  // Clean up local file
  try {
    if (downloadResult.path && fs.existsSync(downloadResult.path)) {
      fs.unlinkSync(downloadResult.path);
    }
  } catch (cleanupError) {
    logger.warn('Failed to clean up local file', { error: cleanupError });
  }

  logger.info('Photo uploaded successfully', { photoId: photo.id, sharepointUrl: uploadResult.sharepoint_url });

  return { success: true, sharepoint_url: uploadResult.sharepoint_url };
}

/**
 * Process all pending photos (batch)
 */
export async function processPendingPhotos(limit = 10): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}> {
  const pendingPhotos = await getPendingPhotos(limit);

  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const photo of pendingPhotos) {
    results.processed++;

    try {
      const result = await processPhoto(photo);

      if (result.success) {
        results.succeeded++;
      } else {
        results.failed++;
        results.errors.push(`Photo ${photo.id}: ${result.error}`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(
        `Photo ${photo.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return results;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get photo processing statistics
 */
export async function getPhotoStats(): Promise<{
  pending: number;
  uploading: number;
  uploaded: number;
  failed: number;
  by_project: Record<string, { pending: number; uploaded: number; failed: number }>;
}> {
  const sql = getDb();

  const statsResult = await sql`
    SELECT
      upload_status,
      project,
      COUNT(*) as count
    FROM maintenance_wa_photos
    GROUP BY upload_status, project
  `;

  const stats = {
    pending: 0,
    uploading: 0,
    uploaded: 0,
    failed: 0,
    by_project: {} as Record<string, { pending: number; uploaded: number; failed: number }>,
  };

  for (const row of statsResult) {
    const status = row.upload_status as string;
    const project = row.project as string;
    const count = parseInt(row.count as string, 10);

    // Update totals
    if (status === 'pending') stats.pending += count;
    else if (status === 'uploading') stats.uploading += count;
    else if (status === 'uploaded') stats.uploaded += count;
    else if (status === 'failed') stats.failed += count;

    // Update by project
    if (!stats.by_project[project]) {
      stats.by_project[project] = { pending: 0, uploaded: 0, failed: 0 };
    }

    if (status === 'pending') stats.by_project[project].pending += count;
    else if (status === 'uploaded') stats.by_project[project].uploaded += count;
    else if (status === 'failed') stats.by_project[project].failed += count;
  }

  return stats;
}
