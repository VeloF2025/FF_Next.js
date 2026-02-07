/**
 * Permissions API
 * GET /api/admin/permissions - List all permissions
 */

import type { NextApiResponse } from 'next';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { getPermissions, getPermissionTree } from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
  }

  try {
    const { type, tree } = req.query;

    if (tree === 'true') {
      // Return hierarchical tree
      const permissions = await getPermissionTree();

      // Group by parent for tree structure
      const modules = permissions.filter(p => p.type === 'module');
      const tree = modules.map(module => ({
        ...module,
        children: permissions
          .filter(p => p.parentKey === module.key)
          .map(page => ({
            ...page,
            children: permissions.filter(t => t.parentKey === page.key),
          })),
      }));

      return apiResponse.success(res, { tree });
    }

    // Return flat list (optionally filtered by type)
    const permissions = await getPermissions(type as string | undefined);

    // Group by category for easier frontend consumption
    const grouped: Record<string, typeof permissions> = {};
    for (const perm of permissions) {
      const category = perm.type;
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(perm);
    }

    return apiResponse.success(res, {
      permissions,
      grouped,
      total: permissions.length,
    });
  } catch (error) {
    log.error('Error fetching permissions', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
