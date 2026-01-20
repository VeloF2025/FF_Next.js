/**
 * SharePoint DR Sync API
 *
 * Single DR sync operations:
 * - POST: Sync a single DR (create folder and/or sync photos)
 * - GET: Check sync status for a DR
 *
 * Status: NEW
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  isSharePointDrSyncEnabled,
  getSharePointDrConfig,
  getAccessToken,
  createDrFolderHierarchy,
  syncDrPhotos,
  fullDrSync,
  getSyncStatus,
  getOrCreateSyncRecord,
  getDrFolderInfoFromDb,
  updateSyncRecordFolder,
  updateSyncRecordPhotos,
} from '@/lib/sharepointDrSyncService';
import type {
  SharePointSyncRequest,
  SharePointSyncStatusResponse,
} from '@/modules/activate/types/sharepoint.types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    return handleGetStatus(req, res);
  }

  if (req.method === 'POST') {
    return handleSync(req, res);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

/**
 * GET - Check sync status for a DR
 */
async function handleGetStatus(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { dropNumber } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return apiResponse.badRequest(res, 'dropNumber query parameter is required');
    }

    const status = await getSyncStatus(dropNumber);

    if (!status) {
      // DR not in sync table yet - check if it exists in drops table
      const folderInfo = await getDrFolderInfoFromDb(dropNumber);
      if (!folderInfo) {
        return apiResponse.notFound(res, 'DR', dropNumber);
      }

      // Return default status
      const defaultStatus: SharePointSyncStatusResponse = {
        dropNumber,
        status: 'pending_folder',
        folderCreated: false,
        folderPath: null,
        folderId: null,
        photosSynced: false,
        photosCount: 0,
        photosTotal: 0,
        lastSyncAt: null,
        error: null,
      };

      return apiResponse.success(res, defaultStatus);
    }

    return apiResponse.success(res, status);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('SharePointSync', 'Failed to get sync status', { error: errorMessage });
    return apiResponse.internalError(res, error);
  }
}

/**
 * POST - Sync a single DR
 */
async function handleSync(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Check if feature is enabled
    if (!isSharePointDrSyncEnabled()) {
      return apiResponse.badRequest(res, 'SharePoint DR sync is not enabled');
    }

    const config = getSharePointDrConfig();
    if (!config) {
      return apiResponse.badRequest(res, 'SharePoint is not configured');
    }

    const body = req.body as SharePointSyncRequest;
    const { dropNumber, action } = body;

    if (!dropNumber) {
      return apiResponse.badRequest(res, 'dropNumber is required');
    }

    if (!action || !['create_folder', 'sync_photos', 'full'].includes(action)) {
      return apiResponse.badRequest(res, 'action must be one of: create_folder, sync_photos, full');
    }

    log.info('SharePointSync', `Starting ${action} for ${dropNumber}`);

    // Get or create sync record
    const syncRecord = await getOrCreateSyncRecord(dropNumber, 'manual');
    if (!syncRecord) {
      return apiResponse.notFound(res, 'DR', dropNumber);
    }

    if (action === 'full') {
      // Full sync - folder + photos
      const result = await fullDrSync(dropNumber, 'manual');
      return apiResponse.success(res, {
        dropNumber,
        action: 'full',
        folderResult: result.folderResult,
        photoResult: result.photoResult,
      });
    }

    if (action === 'create_folder') {
      // Just create folder
      const folderInfo = await getDrFolderInfoFromDb(dropNumber);
      if (!folderInfo) {
        return apiResponse.notFound(res, 'DR folder info', dropNumber);
      }

      const accessToken = await getAccessToken(config);
      const folderResult = await createDrFolderHierarchy(accessToken, config, folderInfo);

      if (folderResult.success && folderResult.folderId && folderResult.parentFolderIds) {
        await updateSyncRecordFolder(
          dropNumber,
          folderResult.folderId,
          folderResult.folderPath || '',
          folderResult.parentFolderIds
        );
      }

      return apiResponse.success(res, {
        dropNumber,
        action: 'create_folder',
        result: folderResult,
      });
    }

    if (action === 'sync_photos') {
      // Just sync photos (folder must exist)
      if (!syncRecord.folder_created || !syncRecord.folder_id) {
        return apiResponse.badRequest(res, 'Folder must be created before syncing photos');
      }

      const photoResult = await syncDrPhotos(dropNumber, syncRecord.folder_id);

      await updateSyncRecordPhotos(
        dropNumber,
        photoResult.photosUploaded,
        photoResult.photosUploaded + photoResult.photosFailed,
        photoResult.error
      );

      return apiResponse.success(res, {
        dropNumber,
        action: 'sync_photos',
        result: photoResult,
      });
    }

    return apiResponse.badRequest(res, 'Invalid action');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('SharePointSync', 'Sync failed', { error: errorMessage });
    return apiResponse.internalError(res, error);
  }
}
