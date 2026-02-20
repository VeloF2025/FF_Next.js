/**
 * Chat Access Check API
 *
 * GET /api/chat/access
 *
 * Uses the existing RBAC permission system (access_permissions + role_permissions + user_permission_overrides).
 * Permission key: communications.chat-data-lookups (view action)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { userHasPermission } from '@/lib/permissions';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authReq = req as AuthenticatedNextApiRequest;
  const userId = authReq.user.id;

  try {
    const hasAccess = await userHasPermission(
      userId,
      'communications.chat-data-lookups',
      'view'
    );

    return res.status(200).json({ dataAccess: hasAccess });
  } catch (err) {
    log.error('Chat access check error', err instanceof Error ? { message: err.message } : { err }, 'ChatAccess');
    return res.status(200).json({ dataAccess: false });
  }
}

export default withAuth(handler);
