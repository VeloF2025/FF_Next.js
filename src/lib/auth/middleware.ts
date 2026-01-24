/**
 * Auth Middleware
 * Protect API routes with JWT authentication and RBAC
 */

import type { NextApiRequest, NextApiResponse, NextApiHandler } from 'next';
import { neon } from '@neondatabase/serverless';
import { verifyToken } from './jwt';
import { validateSession } from './session';
import type { AuthUser, AuthRole, JWTPayload } from './types';
import { ROLE_HIERARCHY } from './types';

const sql = neon(process.env.DATABASE_URL!);

// Cookie name for JWT token
export const AUTH_COOKIE_NAME = 'ff_auth_token';

// Extend NextApiRequest to include user
export interface AuthenticatedNextApiRequest extends NextApiRequest {
  user: AuthUser;
  sessionId: string;
}

// Handler type that accepts both NextApiRequest and AuthenticatedNextApiRequest
// This allows handlers wrapped in withErrorHandler (which use NextApiRequest) to work with withAuth
// Using 'any' return type for flexibility with different response patterns
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthenticatedHandler = (req: NextApiRequest, res: NextApiResponse<any>) => any;

/**
 * Extract token from request (cookie or Authorization header)
 */
function extractToken(req: NextApiRequest): string | null {
  // First try cookie
  const cookieToken = req.cookies[AUTH_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  // Then try Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

/**
 * Get user from database by ID
 */
async function getUserById(userId: string): Promise<AuthUser | null> {
  const result = await sql`
    SELECT
      id, email, first_name, last_name, role, permissions,
      is_active, profile_picture, department
    FROM users
    WHERE id = ${userId}
  `;

  if (result.length === 0) return null;

  const row = result[0];
  const firstName = row.first_name || '';
  const lastName = row.last_name || '';
  return {
    id: row.id,
    userId: row.id, // Alias for backwards compatibility
    email: row.email,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim() || row.email, // Full name or email as fallback
    role: row.role as AuthRole,
    permissions: row.permissions || [],
    isActive: row.is_active,
    profilePicture: row.profile_picture,
    department: row.department,
  };
}

/**
 * Main authentication middleware
 * Verifies JWT token and attaches user to request
 */
export function withAuth(handler: AuthenticatedHandler): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      // Extract token
      const token = extractToken(req);
      if (!token) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      // Verify JWT
      const payload = await verifyToken(token);
      if (!payload) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
        });
      }

      // Validate session still exists in database
      const sessionValid = await validateSession(payload.sessionId, token);
      if (!sessionValid) {
        return res.status(401).json({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has been revoked' },
        });
      }

      // Get fresh user data from database
      const user = await getUserById(payload.sub);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User no longer exists' },
        });
      }

      // Check if user is still active
      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          error: { code: 'USER_DISABLED', message: 'Account has been disabled' },
        });
      }

      // Attach user and session to request
      (req as AuthenticatedNextApiRequest).user = user;
      (req as AuthenticatedNextApiRequest).sessionId = payload.sessionId;

      // Call the actual handler
      return handler(req as AuthenticatedNextApiRequest, res);
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'AUTH_ERROR', message: 'Authentication error' },
      });
    }
  };
}

/**
 * Role-based access control middleware
 * Must be used after withAuth
 */
export function withRole(requiredRole: AuthRole) {
  return (handler: AuthenticatedHandler): AuthenticatedHandler => {
    return async (req: AuthenticatedNextApiRequest, res: NextApiResponse) => {
      const userRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
      const requiredRoleLevel = ROLE_HIERARCHY[requiredRole] || 0;

      if (userRoleLevel < requiredRoleLevel) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `This action requires ${requiredRole} role or higher`,
          },
        });
      }

      return handler(req, res);
    };
  };
}

/**
 * Permission-based access control middleware
 * Must be used after withAuth
 */
export function withPermission(requiredPermission: string) {
  return (handler: AuthenticatedHandler): AuthenticatedHandler => {
    return async (req: AuthenticatedNextApiRequest, res: NextApiResponse) => {
      const hasPermission =
        req.user.permissions.includes('all') ||
        req.user.permissions.includes(requiredPermission);

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Missing required permission: ${requiredPermission}`,
          },
        });
      }

      return handler(req, res);
    };
  };
}

/**
 * Combined role and permission check
 */
export function withRoleAndPermission(
  requiredRole: AuthRole,
  requiredPermission: string
) {
  return (handler: AuthenticatedHandler): AuthenticatedHandler => {
    return withRole(requiredRole)(withPermission(requiredPermission)(handler));
  };
}

/**
 * Optional auth - attaches user if authenticated, but doesn't require it
 */
export function withOptionalAuth(
  handler: (
    req: NextApiRequest & { user?: AuthUser; sessionId?: string },
    res: NextApiResponse
  ) => Promise<void> | void
): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      const token = extractToken(req);
      if (token) {
        const payload = await verifyToken(token);
        if (payload) {
          const sessionValid = await validateSession(payload.sessionId, token);
          if (sessionValid) {
            const user = await getUserById(payload.sub);
            if (user?.isActive) {
              (req as any).user = user;
              (req as any).sessionId = payload.sessionId;
            }
          }
        }
      }

      return handler(req as any, res);
    } catch (error) {
      // On error, just proceed without user
      return handler(req as any, res);
    }
  };
}

/**
 * Helper to check if user has a specific role or higher
 */
export function hasRole(user: AuthUser, requiredRole: AuthRole): boolean {
  const userLevel = ROLE_HIERARCHY[user.role] || 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
  return userLevel >= requiredLevel;
}

/**
 * Helper to check if user has a specific permission
 */
export function hasPermission(user: AuthUser, permission: string): boolean {
  return user.permissions.includes('all') || user.permissions.includes(permission);
}
