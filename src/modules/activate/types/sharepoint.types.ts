/**
 * SharePoint DR Sync Types
 *
 * Types for syncing DR photos to SharePoint with folder hierarchy:
 * Projects/{Project}/{Zone}/{PON}/{Pole}/{DR}/photos
 *
 * Status: NEW
 * NLNH Confidence: HIGH
 */

/**
 * Source of sync trigger
 */
export type SharePointSyncSource = 'whatsapp' | 'oes_import' | 'manual' | 'batch';

/**
 * Sync status for a DR
 */
export type SharePointSyncStatus =
  | 'pending_folder'    // Folder not yet created
  | 'folder_created'    // Folder created, photos not synced
  | 'syncing'           // Currently syncing photos
  | 'synced'            // Fully synced
  | 'error';            // Error occurred

/**
 * DR info needed for folder creation
 */
export interface DrFolderInfo {
  dropNumber: string;
  project: string;
  zoneNo: number | null;
  ponNo: number | null;
  poleNumber: string | null;
}

/**
 * Database record for sharepoint_dr_sync table
 */
export interface SharePointDrSyncRecord {
  id: string;
  drop_number: string;
  project: string | null;
  zone_no: number | null;
  pon_no: number | null;
  pole_number: string | null;

  // Folder tracking
  folder_created: boolean;
  folder_created_at: string | null;
  folder_id: string | null;
  folder_path: string | null;

  // Parent folder IDs
  project_folder_id: string | null;
  zone_folder_id: string | null;
  pon_folder_id: string | null;
  pole_folder_id: string | null;

  // Photo sync tracking
  photos_synced: boolean;
  photos_synced_at: string | null;
  photos_count: number;
  photos_total: number;

  // Error handling
  last_sync_attempt_at: string | null;
  sync_error: string | null;
  sync_retry_count: number;

  // Metadata
  source: SharePointSyncSource | null;
  created_at: string;
  updated_at: string;
}

/**
 * Result of folder creation operation
 */
export interface FolderCreationResult {
  success: boolean;
  dropNumber: string;
  folderId?: string;
  folderPath?: string;
  parentFolderIds?: {
    project: string;
    zone: string;
    pon: string;
    pole: string;
  };
  error?: string;
}

/**
 * Result of photo upload operation
 */
export interface PhotoUploadResult {
  success: boolean;
  filename: string;
  sharePointId?: string;
  size?: number;
  error?: string;
}

/**
 * Result of full DR photo sync
 */
export interface DrPhotoSyncResult {
  success: boolean;
  dropNumber: string;
  photosUploaded: number;
  photosFailed: number;
  photos: PhotoUploadResult[];
  error?: string;
}

/**
 * SharePoint sync status response
 */
export interface SharePointSyncStatusResponse {
  dropNumber: string;
  status: SharePointSyncStatus;
  folderCreated: boolean;
  folderPath: string | null;
  folderId: string | null;
  photosSynced: boolean;
  photosCount: number;
  photosTotal: number;
  lastSyncAt: string | null;
  error: string | null;
}

/**
 * Request body for single DR sync
 */
export interface SharePointSyncRequest {
  dropNumber: string;
  action: 'create_folder' | 'sync_photos' | 'full';
}

/**
 * Request body for batch sync
 */
export interface SharePointBatchSyncRequest {
  action: 'verify_folders' | 'sync_photos' | 'full';
  dropNumbers?: string[];
  project?: string;
  date?: string;  // YYYY-MM-DD for filtering by date
}

/**
 * Response for batch sync
 */
export interface SharePointBatchSyncResponse {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ dropNumber: string; error: string }>;
}

/**
 * SharePoint folder info from Graph API
 */
export interface SharePointFolderInfo {
  id: string;
  name: string;
  webUrl: string;
  parentReference?: {
    driveId: string;
    id: string;
    path: string;
  };
}

/**
 * Microsoft Graph API error response
 */
export interface GraphApiError {
  error: {
    code: string;
    message: string;
    innerError?: {
      'request-id': string;
      date: string;
    };
  };
}
