/**
 * Fleet Portal Module
 *
 * Exports for plate-based portal authentication system.
 */

// Types
export type {
  PortalSession,
  PortalVehicle,
  PortalDriver,
  PlateAuthResult,
  PortalContextValue,
} from './types';

// Hooks
export { usePortalSession } from './usePortalSession';

// Server utilities
export {
  PORTAL_SESSION_COOKIE,
  getPortalSessionFromCookie,
  verifyPortalSession,
  logPortalActivity,
  revokePortalSession,
  getActiveSessionsForVehicle,
} from './portalSessionUtils';
