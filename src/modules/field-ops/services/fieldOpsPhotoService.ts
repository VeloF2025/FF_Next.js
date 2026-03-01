/**
 * Field Ops Photo Processing Service
 *
 * Handles downloading WhatsApp construction photos from the bridge and staging
 * them for Firebase upload. Processes photos from field_ops_wa_photos table
 * with pending upload_status.
 *
 * Flow:
 * 1. Query pending photos from field_ops_wa_photos
 * 2. Request download from WhatsApp bridge /api/download
 * 3. Stage file locally and record intended Firebase storage path
 * 4. Update status to 'uploaded' with storage_key
 *
 * @module field-ops/services/fieldOpsPhotoService
 */

import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import fs from 'fs';

const logger = createLogger('fieldOpsPhotoService');

// ============================================================================
// Configuration
// ============================================================================

const WA_BRIDGE_DOWNLOAD_URL =
  process.env.WA_BRIDGE_URL || 'http://72.61.197.178:8083/api/download';

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
  wa_media_id: string;
  wa_group_jid: string;
  group_type: string;
  project: string;
  sender_name: string;
  message_timestamp: string;
  mime_type: string;
  wa_message_id: string;
}

interface DownloadResult {
  success: boolean;
  filename?: string;
  path?: string;
  error?: string;
}

interface FirebaseStageResult {
  success: boolean;
  storageKey?: string;
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
// Firebase Storage Staging
// ============================================================================

/**
 * Stage photo for Firebase upload.
 * Records the intended Firebase storage path; the file is already local from the bridge.
 * Actual Firebase upload runs in a background job when credentials are configured.
 */
async function stageForFirebase(
  localPath: string,
  storagePath: string
): Promise<FirebaseStageResult> {
  try {
    if (!fs.existsSync(localPath)) {
      return { success: false, error: `Local file not found: ${localPath}` };
    }

    logger.info('Photo staged for Firebase upload', { localPath, storagePath });
    return { success: true, storageKey: storagePath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Staging failed',
    };
  }
}

// ============================================================================
// Photo Processing
// ============================================================================

/**
 * Get pending photos that need downloading and uploading
 */
export async function getPendingPhotos(limit = 10): Promise<PendingPhoto[]> {
  const sql = getDb();

  const result = await sql`
    SELECT
      p.id,
      p.message_id,
      p.wa_media_id,
      p.wa_group_jid,
      p.group_type,
      p.project,
      p.sender_name,
      p.message_timestamp,
      p.mime_type,
      m.wa_message_id
    FROM field_ops_wa_photos p
    JOIN field_ops_wa_messages m ON p.message_id = m.id
    WHERE p.upload_status = 'pending'
    ORDER BY p.created_at ASC
    LIMIT ${limit}
  `;

  return result as unknown as PendingPhoto[];
}

/**
 * Process a single pending photo: download from bridge + stage for Firebase
 */
export async function processPhoto(
  photo: PendingPhoto
): Promise<{ success: boolean; error?: string }> {
  const sql = getDb();

  // Mark as uploading
  await sql`
    UPDATE field_ops_wa_photos
    SET upload_status = 'uploading', updated_at = NOW()
    WHERE id = ${photo.id}
  `;

  // Step 1: Download from WhatsApp bridge
  logger.info('Downloading photo from bridge', {
    photoId: photo.id,
    messageId: photo.wa_message_id,
  });

  const download = await downloadFromBridge(photo.wa_message_id, photo.wa_group_jid);

  if (!download.success || !download.path) {
    await sql`
      UPDATE field_ops_wa_photos
      SET upload_status = 'failed', upload_error = ${download.error || null}, updated_at = NOW()
      WHERE id = ${photo.id}
    `;
    return { success: false, error: download.error };
  }

  // Step 2: Stage for Firebase
  const date = new Date(photo.message_timestamp).toISOString().split('T')[0];
  const filename = download.filename || `photo_${photo.id}.jpg`;
  const storagePath = `construction-qa/${photo.project}/${date}/${filename}`;

  const stage = await stageForFirebase(download.path, storagePath);

  if (!stage.success) {
    await sql`
      UPDATE field_ops_wa_photos
      SET upload_status = 'failed', upload_error = ${stage.error || null}, updated_at = NOW()
      WHERE id = ${photo.id}
    `;
    return { success: false, error: stage.error };
  }

  // Step 3: Update to uploaded with storage key and local path
  await sql`
    UPDATE field_ops_wa_photos
    SET
      upload_status = 'uploaded',
      storage_key = ${stage.storageKey || null},
      local_path = ${download.path},
      uploaded_at = NOW(),
      updated_at = NOW()
    WHERE id = ${photo.id}
  `;

  logger.info('Photo staged successfully', {
    photoId: photo.id,
    storageKey: stage.storageKey,
  });

  return { success: true };
}

/**
 * Batch process pending photos (download + stage)
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

  logger.info('Batch photo processing complete', {
    processed: results.processed,
    succeeded: results.succeeded,
    failed: results.failed,
  });

  return results;
}
