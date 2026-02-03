/**
 * Fleet Portal Module
 *
 * Exports for plate-based portal authentication system.
 *
 * NOTE: Server utilities are NOT exported here to prevent client-side bundling.
 * For server utilities (API routes), import directly:
 *   import { verifyPortalSession } from '@/modules/fleet/portal/portalSessionUtils';
 */

// Types
export type {
  PortalSession,
  PortalVehicle,
  PortalDriver,
  PlateAuthResult,
  PortalContextValue,
} from './types';

// Hooks (client-safe)
export { usePortalSession } from './usePortalSession';

// Cookie name constant (doesn't require server code)
export const PORTAL_SESSION_COOKIE = 'ff_portal_session';
