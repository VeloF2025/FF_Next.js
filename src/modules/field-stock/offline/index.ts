/**
 * Field Stock Offline Module
 * Provides IndexedDB-backed operation queuing, online/offline detection,
 * and a UI banner for the field stock portal's offline-first experience.
 */

export { offlineStorage } from './offlineStorage';
export type { PendingOperation } from './offlineStorage';
export { useOnlineStatus } from './useOnlineStatus';
export { OfflineBanner } from './OfflineBanner';
