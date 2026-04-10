/**
 * Permission Service
 * Database-driven RBAC with module/page/tab/action hierarchy
 */

import { neon } from '@/lib/db-neon';

const sql = neon(process.env.DATABASE_URL!);

// Types
export type PermissionType = 'module' | 'page' | 'tab' | 'action';

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

export interface Permission {
  id: string;
  type: PermissionType;
  key: string;
  parentKey: string | null;
  label: string;
  description: string | null;
  route: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface PermissionActions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface RolePermission {
  role: string;
  permissionKey: string;
  actions: PermissionActions;
}

export interface RolePermissionWithLabel extends RolePermission {
  key: string;
  label: string;
  type?: string;
}

export interface UserPermissionOverride {
  userId: string;
  permissionKey: string;
  overrideType: 'grant' | 'revoke';
  actions: PermissionActions;
  grantedBy: string | null;
  grantedAt: Date;
  expiresAt: Date | null;
  reason: string | null;
}

export interface EffectivePermission {
  permissionKey: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

// =====================================================
// Permission Queries
// =====================================================

/**
 * Get all permissions (optionally filtered by type)
 */
export async function getPermissions(type?: PermissionType): Promise<Permission[]> {
  const result = type
    ? await sql`
        SELECT id, type, key, parent_key, label, description, route, sort_order, is_active
        FROM access_permissions
        WHERE is_active = true AND type = ${type}
        ORDER BY sort_order
      `
    : await sql`
        SELECT id, type, key, parent_key, label, description, route, sort_order, is_active
        FROM access_permissions
        WHERE is_active = true
        ORDER BY
          CASE type
            WHEN 'module' THEN 1
            WHEN 'page' THEN 2
            WHEN 'tab' THEN 3
            WHEN 'action' THEN 4
          END,
          sort_order
      `;

  return result.map(row => ({
    id: row.id,
    type: row.type as PermissionType,
    key: row.key,
    parentKey: row.parent_key,
    label: row.label,
    description: row.description,
    route: row.route,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }));
}

/**
 * Get permission tree (hierarchical structure)
 */
export async function getPermissionTree(): Promise<Permission[]> {
  return getPermissions();
}

/**
 * Get permissions for a specific module (and its children)
 */
export async function getModulePermissions(moduleKey: string): Promise<Permission[]> {
  const result = await sql`
    SELECT id, type, key, parent_key, label, description, route, sort_order, is_active
    FROM access_permissions
    WHERE is_active = true
      AND (key = ${moduleKey} OR key LIKE ${moduleKey + '.%'})
    ORDER BY
      CASE type
        WHEN 'module' THEN 1
        WHEN 'page' THEN 2
        WHEN 'tab' THEN 3
        WHEN 'action' THEN 4
      END,
      sort_order
  `;

  return result.map(row => ({
    id: row.id,
    type: row.type as PermissionType,
    key: row.key,
    parentKey: row.parent_key,
    label: row.label,
    description: row.description,
    route: row.route,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }));
}

// =====================================================
// Role Queries
// =====================================================

/**
 * Get all unique roles
 */
export async function getRoles(): Promise<string[]> {
  const result = await sql`
    SELECT DISTINCT role FROM role_permissions ORDER BY role
  `;
  return result.map(row => row.role);
}

/**
 * Get permissions for a specific role
 */
export async function getRolePermissions(role: string): Promise<RolePermissionWithLabel[]> {
  const result = await sql`
    SELECT rp.role, rp.permission_key, rp.actions, ap.label, ap.type
    FROM role_permissions rp
    JOIN access_permissions ap ON rp.permission_key = ap.key
    WHERE rp.role = ${role} AND ap.is_active = true
    ORDER BY ap.sort_order
  `;

  return result.map(row => ({
    role: row.role,
    permissionKey: row.permission_key,
    key: row.permission_key,
    label: row.label || row.permission_key,
    type: row.type,
    actions: row.actions as PermissionActions,
  }));
}

/**
 * Update role permission
 */
export async function updateRolePermission(
  role: string,
  permissionKey: string,
  actions: Partial<PermissionActions>
): Promise<void> {
  const currentActions = await sql`
    SELECT actions FROM role_permissions
    WHERE role = ${role} AND permission_key = ${permissionKey}
  `;

  const merged = {
    view: false,
    create: false,
    edit: false,
    delete: false,
    ...(currentActions[0]?.actions || {}),
    ...actions,
  };

  await sql`
    INSERT INTO role_permissions (role, permission_key, actions)
    VALUES (${role}, ${permissionKey}, ${JSON.stringify(merged)}::jsonb)
    ON CONFLICT (role, permission_key)
    DO UPDATE SET actions = ${JSON.stringify(merged)}::jsonb, updated_at = NOW()
  `;
}

// =====================================================
// User Permission Queries
// =====================================================

/**
 * Check if user has a specific permission action.
 * Cascades: if any ancestor permission (module → page → tab) denies
 * view access, all children are also denied.
 */
export async function userHasPermission(
  userId: string,
  permissionKey: string,
  action: PermissionAction = 'view'
): Promise<boolean> {
  const userResult = await sql`
    SELECT role, permissions FROM users WHERE id = ${userId}
  `;

  if (userResult.length === 0) return false;

  const user = userResult[0]!;

  // Only super_admin role bypasses RBAC entirely
  if (user.role === 'super_admin') {
    return true;
  }

  // Cascade check: if any ancestor module/page is blocked, deny access.
  const ancestors = await sql`
    WITH RECURSIVE ancestors AS (
      SELECT parent_key FROM access_permissions WHERE key = ${permissionKey} AND parent_key IS NOT NULL
      UNION ALL
      SELECT ap.parent_key FROM access_permissions ap
      JOIN ancestors a ON ap.key = a.parent_key
      WHERE ap.parent_key IS NOT NULL
    )
    SELECT parent_key AS key FROM ancestors
  `;

  for (const ancestor of ancestors) {
    const blocked = await isPermissionBlocked(userId, user.role as string, ancestor.key as string, 'view');
    if (blocked) return false;
  }

  return !await isPermissionBlocked(userId, user.role as string, permissionKey, action);
}

/**
 * Check if a single permission key is blocked for a user (no cascade).
 * Returns true if the permission is NOT granted.
 */
async function isPermissionBlocked(
  userId: string,
  userRole: string,
  permissionKey: string,
  action: PermissionAction
): Promise<boolean> {
  // Check for user override first (overrides take priority over role)
  const overrideResult = await sql`
    SELECT override_type, actions FROM user_permission_overrides
    WHERE user_id = ${userId}
      AND permission_key = ${permissionKey}
      AND (expires_at IS NULL OR expires_at > NOW())
  `;

  if (overrideResult.length > 0) {
    const override = overrideResult[0]!;
    const actions = override.actions as Record<string, boolean>;
    if (override.override_type === 'grant') {
      return actions[action] !== true;
    }
    if (override.override_type === 'revoke' && actions[action]) {
      return true;
    }
  }

  // Get role-based permission
  const rolePermResult = await sql`
    SELECT actions FROM role_permissions
    WHERE role = ${userRole} AND permission_key = ${permissionKey}
  `;

  if (rolePermResult.length > 0) {
    const roleActions = rolePermResult[0]!.actions as Record<string, boolean>;
    return roleActions[action] !== true;
  }

  // No permission entry = blocked
  return true;
}

/**
 * Get user's effective permissions
 */
export async function getUserEffectivePermissions(userId: string): Promise<EffectivePermission[]> {
  const userResult = await sql`
    SELECT role, permissions FROM users WHERE id = ${userId}
  `;

  if (userResult.length === 0) return [];

  const user = userResult[0]!;
  const userRole = user.role as string;

  // Only super_admin role bypasses RBAC entirely
  if (userRole === 'super_admin') {
    const allPerms = await sql`
      SELECT key FROM access_permissions WHERE is_active = true
    `;
    return allPerms.map(p => ({
      permissionKey: p.key as string,
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
    }));
  }

  // Get role permissions + overrides
  const result = await sql`
    SELECT
      ap.key as permission_key,
      COALESCE(
        CASE
          WHEN upo.override_type = 'grant' THEN (upo.actions->>'view')::boolean
          WHEN upo.override_type = 'revoke' AND (upo.actions->>'view')::boolean THEN FALSE
          ELSE (rp.actions->>'view')::boolean
        END,
        FALSE
      ) as can_view,
      COALESCE(
        CASE
          WHEN upo.override_type = 'grant' THEN (upo.actions->>'create')::boolean
          WHEN upo.override_type = 'revoke' AND (upo.actions->>'create')::boolean THEN FALSE
          ELSE (rp.actions->>'create')::boolean
        END,
        FALSE
      ) as can_create,
      COALESCE(
        CASE
          WHEN upo.override_type = 'grant' THEN (upo.actions->>'edit')::boolean
          WHEN upo.override_type = 'revoke' AND (upo.actions->>'edit')::boolean THEN FALSE
          ELSE (rp.actions->>'edit')::boolean
        END,
        FALSE
      ) as can_edit,
      COALESCE(
        CASE
          WHEN upo.override_type = 'grant' THEN (upo.actions->>'delete')::boolean
          WHEN upo.override_type = 'revoke' AND (upo.actions->>'delete')::boolean THEN FALSE
          ELSE (rp.actions->>'delete')::boolean
        END,
        FALSE
      ) as can_delete
    FROM access_permissions ap
    LEFT JOIN role_permissions rp ON rp.permission_key = ap.key AND rp.role = ${userRole}
    LEFT JOIN user_permission_overrides upo ON upo.permission_key = ap.key
      AND upo.user_id = ${userId}
      AND (upo.expires_at IS NULL OR upo.expires_at > NOW())
    WHERE ap.is_active = true
  `;

  // Build initial permission map
  const permMap = new Map<string, EffectivePermission>();
  for (const row of result) {
    permMap.set(row.permission_key, {
      permissionKey: row.permission_key,
      canView: row.can_view,
      canCreate: row.can_create,
      canEdit: row.can_edit,
      canDelete: row.can_delete,
    });
  }

  // Cascade: if a parent module/page has view=false, all children must also be false.
  // Get parent_key mappings for cascade.
  const parentRows = await sql`
    SELECT key, parent_key FROM access_permissions WHERE is_active = true AND parent_key IS NOT NULL
  `;
  const parentMap = new Map<string, string>();
  for (const row of parentRows) {
    parentMap.set(row.key, row.parent_key);
  }

  // For each permission, walk up the parent chain — if any ancestor has view=false, block this one
  for (const [key, perm] of permMap) {
    if (!perm.canView) continue; // already blocked, skip
    let parentKey = parentMap.get(key);
    while (parentKey) {
      const parentPerm = permMap.get(parentKey);
      if (parentPerm && !parentPerm.canView) {
        perm.canView = false;
        perm.canCreate = false;
        perm.canEdit = false;
        perm.canDelete = false;
        break;
      }
      parentKey = parentMap.get(parentKey);
    }
  }

  return Array.from(permMap.values());
}

/**
 * Get user's permission overrides
 */
export async function getUserPermissionOverrides(userId: string): Promise<UserPermissionOverride[]> {
  const result = await sql`
    SELECT user_id, permission_key, override_type, actions, granted_by, granted_at, expires_at, reason
    FROM user_permission_overrides
    WHERE user_id = ${userId}
      AND (expires_at IS NULL OR expires_at > NOW())
  `;

  return result.map(row => ({
    userId: row.user_id,
    permissionKey: row.permission_key,
    overrideType: row.override_type as 'grant' | 'revoke',
    actions: row.actions as PermissionActions,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    reason: row.reason,
  }));
}

/**
 * Grant permission override to user
 */
export async function grantUserPermission(
  userId: string,
  permissionKey: string,
  actions: Partial<PermissionActions>,
  grantedBy: string,
  reason?: string,
  expiresAt?: Date
): Promise<void> {
  const fullActions = {
    view: false,
    create: false,
    edit: false,
    delete: false,
    ...actions,
  };

  await sql`
    INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions, granted_by, reason, expires_at)
    VALUES (${userId}, ${permissionKey}, 'grant', ${JSON.stringify(fullActions)}::jsonb, ${grantedBy}, ${reason || null}, ${expiresAt || null})
    ON CONFLICT (user_id, permission_key)
    DO UPDATE SET
      override_type = 'grant',
      actions = ${JSON.stringify(fullActions)}::jsonb,
      granted_by = ${grantedBy},
      granted_at = NOW(),
      reason = ${reason || null},
      expires_at = ${expiresAt || null}
  `;
}

/**
 * Revoke permission from user
 */
export async function revokeUserPermission(
  userId: string,
  permissionKey: string,
  actions: Partial<PermissionActions>,
  revokedBy: string,
  reason?: string
): Promise<void> {
  const fullActions = {
    view: false,
    create: false,
    edit: false,
    delete: false,
    ...actions,
  };

  await sql`
    INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions, granted_by, reason)
    VALUES (${userId}, ${permissionKey}, 'revoke', ${JSON.stringify(fullActions)}::jsonb, ${revokedBy}, ${reason || null})
    ON CONFLICT (user_id, permission_key)
    DO UPDATE SET
      override_type = 'revoke',
      actions = ${JSON.stringify(fullActions)}::jsonb,
      granted_by = ${revokedBy},
      granted_at = NOW(),
      reason = ${reason || null}
  `;
}

/**
 * Remove permission override from user (revert to role-based)
 */
export async function removeUserPermissionOverride(
  userId: string,
  permissionKey: string
): Promise<void> {
  await sql`
    DELETE FROM user_permission_overrides
    WHERE user_id = ${userId} AND permission_key = ${permissionKey}
  `;
}

// =====================================================
// Batch Operations
// =====================================================

/**
 * Batch update all permissions for a role (replace all)
 * Deletes existing role_permissions and inserts new ones in a transaction
 */
export async function batchUpdateRolePermissions(
  role: string,
  permissions: Array<{ key: string; actions: PermissionActions }>
): Promise<number> {
  // Delete all existing permissions for this role
  await sql`DELETE FROM role_permissions WHERE role = ${role}`;

  // Filter to permissions that have at least one action enabled
  const activePerms = permissions.filter(
    (p) => p.actions.view || p.actions.create || p.actions.edit || p.actions.delete
  );

  // Batch insert using UNNEST — single query instead of N inserts
  if (activePerms.length > 0) {
    const keys = activePerms.map((p) => p.key);
    const actions = activePerms.map((p) => JSON.stringify(p.actions));
    const roles = activePerms.map(() => role);
    await sql`
      INSERT INTO role_permissions (role, permission_key, actions)
      SELECT r, k, a::jsonb
      FROM UNNEST(${roles}::text[], ${keys}::text[], ${actions}::text[]) AS t(r, k, a)
    `;
  }

  return activePerms.length;
}

/**
 * Batch set user permissions by computing overrides from desired state.
 * Compares desired effective permissions against role defaults.
 * If desired differs from role default, creates a 'grant' override
 * with the full desired actions (grant type replaces role defaults entirely).
 * If desired matches role default, no override is needed.
 */
export async function batchSetUserPermissions(
  userId: string,
  desiredPermissions: Array<{ key: string; actions: PermissionActions }>,
  grantedBy: string
): Promise<{ overridesCreated: number; overridesRemoved: number }> {
  // Get user's role
  const userResult = await sql`SELECT role FROM users WHERE id = ${userId}`;
  if (userResult.length === 0) throw new Error('User not found');
  const userRole = userResult[0]!.role;

  // Get role-based permissions
  const rolePerms = await getRolePermissions(userRole);
  const rolePermMap = new Map(
    rolePerms.map(rp => [rp.permissionKey, rp.actions])
  );

  // Count existing overrides before clearing
  const existingCount = await sql`
    SELECT COUNT(*)::int as count FROM user_permission_overrides WHERE user_id = ${userId}
  `;
  const removedCount = existingCount[0]?.count || 0;

  // Delete all existing overrides for this user
  await sql`DELETE FROM user_permission_overrides WHERE user_id = ${userId}`;

  // Collect only permissions that differ from the role default
  const overridePerms = desiredPermissions.filter((desired) => {
    const roleDefault = rolePermMap.get(desired.key) ?? {
      view: false, create: false, edit: false, delete: false,
    };
    return (
      desired.actions.view !== roleDefault.view ||
      desired.actions.create !== roleDefault.create ||
      desired.actions.edit !== roleDefault.edit ||
      desired.actions.delete !== roleDefault.delete
    );
  });

  // Batch insert overrides using UNNEST — single query instead of N inserts
  if (overridePerms.length > 0) {
    const userIds = overridePerms.map(() => userId);
    const keys = overridePerms.map((p) => p.key);
    const actionsArr = overridePerms.map((p) => JSON.stringify(p.actions));
    const grantedBys = overridePerms.map(() => grantedBy);
    await sql`
      INSERT INTO user_permission_overrides
        (user_id, permission_key, override_type, actions, granted_by, reason)
      SELECT u, k, 'grant', a::jsonb, g, 'Batch permission update'
      FROM UNNEST(
        ${userIds}::uuid[],
        ${keys}::text[],
        ${actionsArr}::text[],
        ${grantedBys}::uuid[]
      ) AS t(u, k, a, g)
    `;
  }

  return { overridesCreated: overridePerms.length, overridesRemoved: removedCount };
}

/**
 * Create a role from a user's effective permissions
 */
export async function createRoleFromUserPermissions(
  userId: string,
  roleName: string,
  displayName: string,
  description: string | null,
  createdBy: string
): Promise<{ roleId: string; permissionCount: number }> {
  // Get user's effective permissions
  const effectivePerms = await getUserEffectivePermissions(userId);

  // Create the role
  const newRole = await sql`
    INSERT INTO custom_roles (name, display_name, description, color, is_system, created_by)
    VALUES (${roleName}, ${displayName}, ${description}, '#6b7280', FALSE, ${createdBy})
    RETURNING id
  `;

  const roleId = newRole[0]!.id;

  // Filter to permissions that have at least one action enabled
  const activePermsForRole = effectivePerms.filter(
    (p) => p.canView || p.canCreate || p.canEdit || p.canDelete
  );

  // Batch insert using UNNEST — single query instead of N inserts
  if (activePermsForRole.length > 0) {
    const roleNames = activePermsForRole.map(() => roleName);
    const keys = activePermsForRole.map((p) => p.permissionKey);
    const actionsArr = activePermsForRole.map((p) =>
      JSON.stringify({ view: p.canView, create: p.canCreate, edit: p.canEdit, delete: p.canDelete })
    );
    await sql`
      INSERT INTO role_permissions (role, permission_key, actions)
      SELECT r, k, a::jsonb
      FROM UNNEST(${roleNames}::text[], ${keys}::text[], ${actionsArr}::text[]) AS t(r, k, a)
    `;
  }

  return { roleId, permissionCount: activePermsForRole.length };
}

/**
 * Update an existing role's permissions from a user's effective permissions
 */
export async function updateRoleFromUserPermissions(
  userId: string,
  targetRole: string
): Promise<{ permissionCount: number }> {
  // Get user's effective permissions
  const effectivePerms = await getUserEffectivePermissions(userId);

  // Delete existing permissions for this role
  await sql`DELETE FROM role_permissions WHERE role = ${targetRole}`;

  // Filter to permissions that have at least one action enabled
  const activePermsForTarget = effectivePerms.filter(
    (p) => p.canView || p.canCreate || p.canEdit || p.canDelete
  );

  // Batch insert using UNNEST — single query instead of N inserts
  if (activePermsForTarget.length > 0) {
    const targetRoles = activePermsForTarget.map(() => targetRole);
    const keys = activePermsForTarget.map((p) => p.permissionKey);
    const actionsArr = activePermsForTarget.map((p) =>
      JSON.stringify({ view: p.canView, create: p.canCreate, edit: p.canEdit, delete: p.canDelete })
    );
    await sql`
      INSERT INTO role_permissions (role, permission_key, actions)
      SELECT r, k, a::jsonb
      FROM UNNEST(${targetRoles}::text[], ${keys}::text[], ${actionsArr}::text[]) AS t(r, k, a)
    `;
  }

  return { permissionCount: activePermsForTarget.length };
}

// =====================================================
// Helper functions for common checks
// =====================================================

/**
 * Check if user can view a module
 */
export async function canViewModule(userId: string, moduleKey: string): Promise<boolean> {
  return userHasPermission(userId, moduleKey, 'view');
}

/**
 * Check if user can access a page
 */
export async function canAccessPage(userId: string, pageKey: string): Promise<boolean> {
  return userHasPermission(userId, pageKey, 'view');
}

/**
 * Get modules user can view
 */
export async function getAccessibleModules(userId: string): Promise<Permission[]> {
  const allModules = await getPermissions('module');
  const effectivePerms = await getUserEffectivePermissions(userId);

  const viewableKeys = new Set(
    effectivePerms.filter(p => p.canView).map(p => p.permissionKey)
  );

  return allModules.filter(m => viewableKeys.has(m.key));
}

/**
 * Get pages user can view for a module
 */
export async function getAccessiblePages(userId: string, moduleKey: string): Promise<Permission[]> {
  const modulePerms = await getModulePermissions(moduleKey);
  const pages = modulePerms.filter(p => p.type === 'page');
  const effectivePerms = await getUserEffectivePermissions(userId);

  const viewableKeys = new Set(
    effectivePerms.filter(p => p.canView).map(p => p.permissionKey)
  );

  return pages.filter(p => viewableKeys.has(p.key));
}
