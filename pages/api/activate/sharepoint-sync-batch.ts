/**
 * SharePoint DR Batch Sync API
 *
 * Batch operations for cron jobs and OES import verification:
 * - POST: Batch sync operations
 *
 * Actions:
 * - verify_folders: Ensure folders exist for specified DRs
 * - sync_photos: Sync photos for DRs with folders
 * - full: Full sync (folders + photos) for specified DRs
 *
 * Status: NEW
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  isSharePointDrSyncEnabled,
  getSharePointDrConfig,
  getAccessToken,
  createDrFolderHierarchy,
  syncDrPhotos,
  getOrCreateSyncRecord,
  getDrFolderInfoFromDb,
  updateSyncRecordFolder,
  updateSyncRecordPhotos,
  getDrsPendingPhotoSync,
} from '@/lib/sharepointDrSyncService';
import type {
  SharePointBatchSyncRequest,
  SharePointBatchSyncResponse,
} from '@/modules/activate/types/sharepoint.types';

// Maximum DRs to process in a single batch
const MAX_BATCH_SIZE = 100;

// Rate limit delay between DRs (ms)
const DR_RATE_LIMIT = 500;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    // Check if feature is enabled
    if (!isSharePointDrSyncEnabled()) {
      return apiResponse.badRequest(res, 'SharePoint DR sync is not enabled');
    }

    const config = getSharePointDrConfig();
    if (!config) {
      return apiResponse.badRequest(res, 'SharePoint is not configured');
    }

    const body = req.body as SharePointBatchSyncRequest;
    const { action, dropNumbers, project, date } = body;

    if (!action || !['verify_folders', 'sync_photos', 'full'].includes(action)) {
      return apiResponse.badRequest(res, 'action must be one of: verify_folders, sync_photos, full');
    }

    log.info('SharePointBatchSync', `Starting batch ${action}`, {
      dropNumbersCount: dropNumbers?.length,
      project,
      date,
    });

    // Get list of DRs to process
    let drsToProcess: string[] = [];

    if (dropNumbers && dropNumbers.length > 0) {
      // Use provided list
      drsToProcess = dropNumbers.slice(0, MAX_BATCH_SIZE);
    } else if (action === 'sync_photos') {
      // Get DRs pending photo sync
      drsToProcess = await getDrsPendingPhotoSync(MAX_BATCH_SIZE);
    } else {
      // Query DRs from database based on filters
      drsToProcess = await queryDrsToProcess(project, date, MAX_BATCH_SIZE);
    }

    if (drsToProcess.length === 0) {
      return apiResponse.success(res, {
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
        message: 'No DRs to process',
      } as SharePointBatchSyncResponse);
    }

    // Process DRs based on action
    const result = await processBatch(drsToProcess, action, config);

    log.info('SharePointBatchSync', `Batch ${action} complete`, {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
    });

    return apiResponse.success(res, result);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('SharePointBatchSync', 'Batch sync failed', { error: errorMessage });
    return apiResponse.internalError(res, error);
  }
}

/**
 * Query DRs to process based on filters
 */
async function queryDrsToProcess(
  project?: string,
  date?: string,
  limit: number = MAX_BATCH_SIZE
): Promise<string[]> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not configured');
  }

  const sql = neon(databaseUrl);

  // Build query based on filters
  let result;

  if (project && date) {
    result = await sql`
      SELECT DISTINCT d.drop_number
      FROM drops d
      LEFT JOIN projects p ON d.project_id = p.id
      LEFT JOIN sharepoint_dr_sync s ON d.drop_number = s.drop_number
      WHERE p.project_name = ${project}
        AND d.created_at::date = ${date}::date
        AND (s.folder_created IS NULL OR s.folder_created = false)
      LIMIT ${limit}
    `;
  } else if (project) {
    result = await sql`
      SELECT DISTINCT d.drop_number
      FROM drops d
      LEFT JOIN projects p ON d.project_id = p.id
      LEFT JOIN sharepoint_dr_sync s ON d.drop_number = s.drop_number
      WHERE p.project_name = ${project}
        AND (s.folder_created IS NULL OR s.folder_created = false)
      LIMIT ${limit}
    `;
  } else if (date) {
    result = await sql`
      SELECT DISTINCT d.drop_number
      FROM drops d
      LEFT JOIN sharepoint_dr_sync s ON d.drop_number = s.drop_number
      WHERE d.created_at::date = ${date}::date
        AND (s.folder_created IS NULL OR s.folder_created = false)
      LIMIT ${limit}
    `;
  } else {
    // Get all DRs without folders (oldest first)
    result = await sql`
      SELECT DISTINCT d.drop_number
      FROM drops d
      LEFT JOIN sharepoint_dr_sync s ON d.drop_number = s.drop_number
      WHERE s.folder_created IS NULL OR s.folder_created = false
      ORDER BY d.created_at ASC
      LIMIT ${limit}
    `;
  }

  return result.map(r => r.drop_number as string);
}

/**
 * Process batch of DRs
 */
async function processBatch(
  dropNumbers: string[],
  action: string,
  config: ReturnType<typeof getSharePointDrConfig>
): Promise<SharePointBatchSyncResponse> {
  if (!config) {
    return {
      success: false,
      processed: 0,
      succeeded: 0,
      failed: dropNumbers.length,
      errors: dropNumbers.map(dn => ({ dropNumber: dn, error: 'SharePoint not configured' })),
    };
  }

  const errors: Array<{ dropNumber: string; error: string }> = [];
  let succeeded = 0;
  let failed = 0;

  // Get access token once for the batch
  const accessToken = await getAccessToken(config);

  for (const dropNumber of dropNumbers) {
    try {
      // Rate limit between DRs
      if (succeeded + failed > 0) {
        await new Promise(resolve => setTimeout(resolve, DR_RATE_LIMIT));
      }

      if (action === 'verify_folders') {
        await processVerifyFolder(dropNumber, accessToken, config);
      } else if (action === 'sync_photos') {
        await processSyncPhotos(dropNumber);
      } else if (action === 'full') {
        await processFullSync(dropNumber, accessToken, config);
      }

      succeeded++;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ dropNumber, error: errorMessage });
      failed++;
      log.warn('SharePointBatchSync', `Failed to process ${dropNumber}`, { error: errorMessage });
    }
  }

  return {
    success: failed === 0,
    processed: dropNumbers.length,
    succeeded,
    failed,
    errors,
  };
}

/**
 * Verify/create folder for a single DR
 */
async function processVerifyFolder(
  dropNumber: string,
  accessToken: string,
  config: NonNullable<ReturnType<typeof getSharePointDrConfig>>
): Promise<void> {
  // Get or create sync record
  const syncRecord = await getOrCreateSyncRecord(dropNumber, 'batch');
  if (!syncRecord) {
    throw new Error('DR not found in drops table');
  }

  // Skip if folder already created
  if (syncRecord.folder_created && syncRecord.folder_id) {
    return;
  }

  // Get folder info
  const folderInfo = await getDrFolderInfoFromDb(dropNumber);
  if (!folderInfo) {
    throw new Error('DR folder info not found');
  }

  // Create folder hierarchy
  const result = await createDrFolderHierarchy(accessToken, config, folderInfo);

  if (!result.success) {
    throw new Error(result.error || 'Folder creation failed');
  }

  if (result.folderId && result.parentFolderIds) {
    await updateSyncRecordFolder(
      dropNumber,
      result.folderId,
      result.folderPath || '',
      result.parentFolderIds
    );
  }
}

/**
 * Sync photos for a single DR
 */
async function processSyncPhotos(dropNumber: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not configured');
  }

  const sql = neon(databaseUrl);

  // Get sync record
  const result = await sql`
    SELECT * FROM sharepoint_dr_sync WHERE drop_number = ${dropNumber}
  `;

  if (result.length === 0) {
    throw new Error('Sync record not found');
  }

  const syncRecord = result[0] as Record<string, unknown>;
  if (!syncRecord) {
    throw new Error('Sync record not found');
  }

  if (!syncRecord.folder_created || !syncRecord.folder_id) {
    throw new Error('Folder must be created before syncing photos');
  }

  // Sync photos
  const photoResult = await syncDrPhotos(dropNumber, String(syncRecord.folder_id));

  // Update record
  await updateSyncRecordPhotos(
    dropNumber,
    photoResult.photosUploaded,
    photoResult.photosUploaded + photoResult.photosFailed,
    photoResult.error
  );

  if (!photoResult.success) {
    throw new Error(photoResult.error || 'Photo sync failed');
  }
}

/**
 * Full sync (folder + photos) for a single DR
 */
async function processFullSync(
  dropNumber: string,
  accessToken: string,
  config: NonNullable<ReturnType<typeof getSharePointDrConfig>>
): Promise<void> {
  // First verify/create folder
  await processVerifyFolder(dropNumber, accessToken, config);

  // Then sync photos
  await processSyncPhotos(dropNumber);
}
