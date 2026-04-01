/**
 * Module Access API
 * GET /api/admin/permissions/module-access
 * Returns all modules/pages/tabs with which roles and users have access
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { neon } from '@/lib/db-neon';

const sql = neon(process.env.DATABASE_URL!);

interface RoleAccess {
  role: string;
  actions: { view: boolean; create: boolean; edit: boolean; delete: boolean };
}

interface UserAccess {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  effectiveActions: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  hasOverride: boolean;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const permissionKey = req.query.key as string | undefined;

    // 1. Get all active permissions (tree structure)
    const permissions = await sql`
      SELECT id, type, key, parent_key, label, description, route, sort_order
      FROM access_permissions
      WHERE is_active = true
      ORDER BY
        CASE type WHEN 'module' THEN 1 WHEN 'page' THEN 2 WHEN 'tab' THEN 3 WHEN 'action' THEN 4 END,
        sort_order
    `;

    // 2. If a specific key is requested, get detailed access info
    if (permissionKey) {
      // Get role permissions for this key
      const rolePerms = await sql`
        SELECT role, actions
        FROM role_permissions
        WHERE permission_key = ${permissionKey}
        ORDER BY role
      `;

      // Get users with access (via role defaults + overrides)
      const usersWithAccess = await sql`
        SELECT
          u.id as user_id,
          u.email,
          COALESCE(u.first_name || ' ' || u.last_name, u.email) as full_name,
          u.role,
          COALESCE(rp.actions, '{"view":false,"create":false,"edit":false,"delete":false}'::jsonb) as role_actions,
          upo.override_type,
          upo.actions as override_actions
        FROM users u
        LEFT JOIN role_permissions rp ON rp.role = u.role AND rp.permission_key = ${permissionKey}
        LEFT JOIN user_permission_overrides upo ON upo.user_id = u.id
          AND upo.permission_key = ${permissionKey}
          AND (upo.expires_at IS NULL OR upo.expires_at > NOW())
        WHERE u.is_active = true
        ORDER BY u.role, u.first_name
      `;

      const roleAccess: RoleAccess[] = rolePerms.map(rp => ({
        role: rp.role,
        actions: rp.actions as RoleAccess['actions'],
      }));

      const userAccess: UserAccess[] = usersWithAccess.map(u => {
        // super_admin bypasses RBAC
        if (u.role === 'super_admin') {
          const overrideActions = u.override_actions as Record<string, boolean> | null;
          const hasOverride = !!u.override_type;
          // If super_admin has a grant override that blocks, respect it
          if (u.override_type === 'grant' && overrideActions) {
            return {
              userId: u.user_id,
              email: u.email,
              fullName: u.full_name,
              role: u.role,
              effectiveActions: overrideActions as UserAccess['effectiveActions'],
              hasOverride: true,
            };
          }
          return {
            userId: u.user_id,
            email: u.email,
            fullName: u.full_name,
            role: u.role,
            effectiveActions: { view: true, create: true, edit: true, delete: true },
            hasOverride,
          };
        }

        const roleActions = u.role_actions as Record<string, boolean>;
        const overrideActions = u.override_actions as Record<string, boolean> | null;

        let effectiveActions: UserAccess['effectiveActions'];
        if (u.override_type === 'grant' && overrideActions) {
          effectiveActions = overrideActions as UserAccess['effectiveActions'];
        } else if (u.override_type === 'revoke' && overrideActions) {
          effectiveActions = {
            view: overrideActions.view ? false : (roleActions.view ?? false),
            create: overrideActions.create ? false : (roleActions.create ?? false),
            edit: overrideActions.edit ? false : (roleActions.edit ?? false),
            delete: overrideActions.delete ? false : (roleActions.delete ?? false),
          };
        } else {
          effectiveActions = {
            view: roleActions.view ?? false,
            create: roleActions.create ?? false,
            edit: roleActions.edit ?? false,
            delete: roleActions.delete ?? false,
          };
        }

        return {
          userId: u.user_id,
          email: u.email,
          fullName: u.full_name,
          role: u.role,
          effectiveActions,
          hasOverride: !!u.override_type,
        };
      });

      // Filter to users who have at least view access
      const usersWithView = userAccess.filter(u => u.effectiveActions.view);
      const usersWithoutView = userAccess.filter(u => !u.effectiveActions.view);

      return apiResponse.success(res, {
        permissionKey,
        roleAccess,
        usersWithAccess: usersWithView,
        usersWithoutAccess: usersWithoutView,
        totalWithAccess: usersWithView.length,
        totalWithoutAccess: usersWithoutView.length,
      });
    }

    // 3. Default: return permission tree with access counts
    const roleCounts = await sql`
      SELECT permission_key, COUNT(DISTINCT role) as role_count
      FROM role_permissions
      WHERE (actions->>'view')::boolean = true
      GROUP BY permission_key
    `;

    const roleCountMap = new Map(roleCounts.map(r => [r.permission_key, Number(r.role_count)]));

    // Build tree
    const modules = permissions.filter((p: Record<string, unknown>) => p.type === 'module');
    const tree = modules.map((module: Record<string, unknown>) => ({
      key: module.key,
      label: module.label,
      type: module.type,
      route: module.route,
      roleCount: roleCountMap.get(module.key as string) || 0,
      children: permissions
        .filter((p: Record<string, unknown>) => p.parent_key === module.key)
        .map((page: Record<string, unknown>) => ({
          key: page.key,
          label: page.label,
          type: page.type,
          route: page.route,
          roleCount: roleCountMap.get(page.key as string) || 0,
          children: permissions
            .filter((t: Record<string, unknown>) => t.parent_key === page.key)
            .map((tab: Record<string, unknown>) => ({
              key: tab.key,
              label: tab.label,
              type: tab.type,
              route: tab.route,
              roleCount: roleCountMap.get(tab.key as string) || 0,
            })),
        })),
    }));

    return apiResponse.success(res, { tree });
  } catch (error) {
    log.error('Error fetching module access', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
