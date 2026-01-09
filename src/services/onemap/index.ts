/**
 * OneMap GIS Integration Services
 *
 * Provides access to 1Map API for Fibertime installation data.
 */

export {
  OneMapClient,
  createOneMapClient,
  SITE_PROJECT_MAP,
  type OneMapRecord,
  type OneMapSearchResult,
  type OneMapClientConfig,
} from './oneMapClient';

export {
  syncAllSites,
  syncSite,
  getSyncStatus,
  type SyncOptions,
  type SyncResult,
  type SyncSummary,
} from './oneMapSyncService';
