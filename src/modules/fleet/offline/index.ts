/**
 * Fleet Offline Module
 * Exports all offline-related functionality
 */

export { offlineStorage, STORES } from './offlineStorage';
export type {
  PendingFuelTransaction,
  PendingCheckIn,
  PendingPhoto,
  SyncQueueItem,
} from './offlineStorage';

export { useOnlineStatus, checkServerReachable } from './useOnlineStatus';
export { useServiceWorker } from './useServiceWorker';
export { OfflineBanner, OfflineIndicator } from './OfflineBanner';

// GPS capture
export {
  captureGPS,
  isGeolocationAvailable,
  watchGPS,
  stopWatchingGPS,
  formatCoordinates,
  calculateDistance,
} from './gpsCapture';
export type { GPSCoordinates, GPSCaptureResult } from './gpsCapture';

// Offline submission handlers
export {
  saveOfflineFuelTransaction,
  saveOfflineCheckIn,
  getPendingSummary,
} from './offlineSubmit';
export type {
  OfflineFuelSubmission,
  OfflineCheckInSubmission,
  OfflineSubmitResult,
} from './offlineSubmit';

// Sync engine
export {
  syncOfflineData,
  hasPendingSync,
  getSyncStatus,
  retryFailedItems,
} from './syncEngine';
export type { SyncProgress, SyncResult } from './syncEngine';

// Sync hook
export { useOfflineSync } from './useOfflineSync';
