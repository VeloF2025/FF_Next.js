/**
 * Auth Library
 * Central export for all authentication utilities
 */

// Types
export * from './types';

// JWT utilities
export { signToken, verifyToken, decodeToken, isTokenExpired, getTokenExpiryTime } from './jwt';

// Password utilities
export {
  hashPassword,
  verifyPassword,
  checkPasswordStrength,
  generateRandomPassword,
} from './password';

// Session management
export {
  createSession,
  validateSession,
  getSession,
  deleteSession,
  deleteAllUserSessions,
  getUserSessions,
  cleanupExpiredSessions,
  extendSession,
} from './session';

// Middleware
export {
  withAuth,
  withRole,
  withPermission,
  withRoleAndPermission,
  withOptionalAuth,
  hasRole,
  hasPermission,
  AUTH_COOKIE_NAME,
  type AuthenticatedNextApiRequest,
} from './middleware';
