/**
 * H&S endpoint authorization (goal §4.8)
 *
 * Uses the existing three-tier RBAC — NOT a new H&S-specific role system.
 * Wraps a handler so that:
 *   - an unauthenticated request is rejected by withAuth (401), and
 *   - the caller must hold the `projects.health-safety` permission at the level
 *     the request needs: 'view' for GET, 'edit' for any mutation.
 * super_admin bypasses the permission check (handled inside withPermission).
 *
 * This is method-aware so a single wrap covers the module's method-multiplexed
 * handlers without splitting each into per-method routes.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission } from '@/lib/auth';

const HS_PERMISSION = 'projects.health-safety';

type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown | Promise<unknown>;

export function withHsPermission(handler: Handler): Handler {
  return withAuth(async (req: NextApiRequest, res: NextApiResponse) => {
    const action = req.method === 'GET' || req.method === 'HEAD' ? 'view' : 'edit';
    // req.user is populated by the surrounding withAuth; withPermission reads it.
    return withPermission(HS_PERMISSION, action)(handler as never)(req, res);
  }) as Handler;
}
