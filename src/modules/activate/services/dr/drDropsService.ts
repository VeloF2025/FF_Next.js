/**
 * DR Drops Table Service
 *
 * Handles operations against the `drops` table during DR processing:
 * - Existence check and project validation
 * - Site-submitted flag
 * - SharePoint folder creation (fire-and-forget)
 */

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import {
  isSharePointDrSyncEnabled,
  getSharePointDrConfig,
  getAccessToken,
  createDrFolderHierarchy,
  getOrCreateSyncRecord,
  updateSyncRecordFolder,
} from '@/lib/sharepointDrSyncService';
import type { DrFolderInfo } from '@/modules/activate/types/sharepoint.types';
import type { DropsTableRecord } from './drProcessTypes';

/**
 * Check if a DR exists in the drops table.
 * Returns null when not found; the record (with project_name) when found.
 */
export async function checkDropsTable(dropNumber: string): Promise<DropsTableRecord | null> {
  const result = await pool.query<DropsTableRecord>(
    `SELECT d.id, d.drop_number, d.project_id, p.project_name
     FROM drops d
     LEFT JOIN projects p ON d.project_id = p.id
     WHERE d.drop_number = $1`,
    [dropNumber]
  );
  return result.rows.length > 0 ? (result.rows[0] ?? null) : null;
}

/**
 * Mark a DR as site-submitted in the drops table.
 */
export async function markSiteSubmitted(
  dropNumber: string,
  senderPhone: string | null,
  waProject: string
): Promise<void> {
  await pool.query(
    `UPDATE drops
     SET
       site_submitted = true,
       site_submitted_at = NOW(),
       site_submitted_by = $1,
       site_submitted_project = $2
     WHERE drop_number = $3`,
    [senderPhone, waProject, dropNumber]
  );
}

/**
 * Trigger SharePoint folder creation for a DR (fire-and-forget).
 * Errors are logged but never propagate to the caller.
 */
export function triggerSharePointFolderCreation(
  dropNumber: string,
  expectedProject: string | null
): void {
  if (!isSharePointDrSyncEnabled()) {
    return;
  }

  // Intentionally not awaited — must not block the main request
  (async () => {
    try {
      const config = getSharePointDrConfig();
      if (!config) {
        log.debug('SharePoint not configured, skipping folder creation', undefined, 'DrDropsService');
        return;
      }

      const syncRecord = await getOrCreateSyncRecord(dropNumber, 'whatsapp');
      if (!syncRecord) {
        log.warn(`Could not create sync record for ${dropNumber}`, undefined, 'SharePointSync');
        return;
      }

      if (syncRecord.folder_created && syncRecord.folder_id) {
        log.debug(`Folder already exists for ${dropNumber}`, undefined, 'SharePointSync');
        return;
      }

      const folderInfo: DrFolderInfo = {
        dropNumber,
        project: syncRecord.project || expectedProject || 'Unknown',
        zoneNo: syncRecord.zone_no,
        ponNo: syncRecord.pon_no,
        poleNumber: syncRecord.pole_number,
      };

      const accessToken = await getAccessToken(config);
      const result = await createDrFolderHierarchy(accessToken, config, folderInfo);

      if (result.success && result.folderId && result.parentFolderIds) {
        await updateSyncRecordFolder(
          dropNumber,
          result.folderId,
          result.folderPath || '',
          result.parentFolderIds
        );
        log.info(`Created folder for ${dropNumber}`, { folderPath: result.folderPath }, 'SharePointSync');
      } else {
        log.warn(`Failed to create folder for ${dropNumber}`, { error: result.error }, 'SharePointSync');
      }
    } catch (spError) {
      log.error(`Error creating folder for ${dropNumber}`, { error: spError }, 'SharePointSync');
    }
  })();
}
