/**
 * Chat Access Check API
 * 
 * GET /api/chat/access?userId=xxx
 * 
 * Uses the existing RBAC permission system (access_permissions + role_permissions + user_permission_overrides).
 * Permission key: communications.chat-data-lookups (view action)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { userHasPermission } from '@/lib/permissions';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = req.query;

  if (!userId) {
    return res.status(200).json({ dataAccess: false });
  }

  try {
    const hasAccess = await userHasPermission(
      String(userId),
      'communications.chat-data-lookups',
      'view'
    );

    return res.status(200).json({ dataAccess: hasAccess });
  } catch (err) {
    console.error('Chat access check error:', err);
    return res.status(200).json({ dataAccess: false });
  }
}
