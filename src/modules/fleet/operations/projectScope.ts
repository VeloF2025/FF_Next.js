import { query } from '@/lib/db-pool';
import { userHasPermission } from '@/lib/permissions';

interface ProjectRow extends Record<string, unknown> { project_manager: string | null }
interface GrantRow extends Record<string, unknown> { id: string }
interface ProjectOptionRow extends Record<string, unknown> { id: string; project_name: string }

export interface OperationalProjectOption { id: string; label: string }

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

async function activeGrant(userId: string, permissionKey: string, action: 'view' | 'edit'): Promise<boolean> {
  const rows = await query<GrantRow>(`/* fleet-operations:oversight-grant */
    SELECT id FROM user_permission_overrides
    WHERE user_id = $1::uuid AND permission_key = $2
      AND override_type = 'grant' AND actions->>$3 = 'true'
      AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`, [userId, permissionKey, action]);
  return rows.length > 0;
}

export async function hasOperationalOversight(
  userId: string,
  role: string,
  permissionKey = 'fleet.operations-status',
  action: 'view' | 'edit' = 'view',
): Promise<boolean> {
  if (!await userHasPermission(userId, permissionKey, action)) return false;
  return ADMIN_ROLES.has(role) || activeGrant(userId, permissionKey, action);
}

export async function canAccessOperationalProject(
  userId: string,
  staffId: string | null,
  role: string,
  projectId: string,
): Promise<boolean> {
  if (!await userHasPermission(userId, 'fleet.operations-status', 'view')) return false;
  const rows = await query<ProjectRow>(`/* fleet-operations:active-project-scope */
    SELECT project_manager FROM projects
    WHERE id = $1::uuid AND LOWER(status) = 'active' LIMIT 1`, [projectId]);
  const project = rows[0];
  if (!project) return false;
  if (ADMIN_ROLES.has(role)) return true;
  if (await activeGrant(userId, 'fleet.operations-status', 'view')) return true;
  return project.project_manager === userId || project.project_manager === staffId;
}

export async function listOperationalProjectOptions(
  userId: string,
  staffId: string | null,
  role: string,
): Promise<OperationalProjectOption[]> {
  if (!await userHasPermission(userId, 'fleet.operations-status', 'view')) return [];
  const unrestricted = ADMIN_ROLES.has(role)
    || await activeGrant(userId, 'fleet.operations-status', 'view');
  const rows = await query<ProjectOptionRow>(`/* fleet-operations:project-options */
    SELECT id, project_name FROM projects
    WHERE LOWER(status) = 'active'
      AND ($1::boolean OR project_manager = $2::uuid
        OR ($3::uuid IS NOT NULL AND project_manager = $3::uuid))
    ORDER BY project_name ASC`, [unrestricted, userId, staffId]);
  return rows.map((row) => ({ id: row.id, label: row.project_name }));
}
