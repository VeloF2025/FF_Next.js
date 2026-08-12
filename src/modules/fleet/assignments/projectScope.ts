import { query } from '@/lib/db-pool';
import { userHasPermission } from '@/lib/permissions';

interface ProjectScopeRow extends Record<string, unknown> {
  project_manager: string | null;
}

interface OversightGrantRow extends Record<string, unknown> {
  id: string;
}

async function canAccessAssignmentProject(
  userId: string,
  staffId: string | null,
  role: string,
  projectId: string,
  action: 'view' | 'edit',
): Promise<boolean> {
  if (!await userHasPermission(userId, 'fleet.assignments', action)) return false;

  const projects = await query<ProjectScopeRow>(`
    /* fleet-assignments:active-project-scope */
    SELECT project_manager
    FROM projects
    WHERE id = $1::uuid AND status = 'active'
    LIMIT 1`, [projectId]);
  const project = projects[0];
  if (!project) return false;
  if (role === 'super_admin' || role === 'admin') return true;

  const oversightGrants = await query<OversightGrantRow>(`
    /* fleet-assignments:oversight-grant */
    SELECT id
    FROM user_permission_overrides
    WHERE user_id = $1::uuid
      AND permission_key = 'fleet.assignments'
      AND override_type = 'grant'
      AND actions->>$2 = 'true'
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1`, [userId, action]);
  if (oversightGrants.length > 0) return true;
  return project.project_manager === userId || project.project_manager === staffId;
}

export function canViewAssignmentProject(
  userId: string,
  staffId: string | null,
  role: string,
  projectId: string,
): Promise<boolean> {
  return canAccessAssignmentProject(userId, staffId, role, projectId, 'view');
}

/**
 * Authorizes assignment changes after both RBAC and project ownership checks.
 * Role labels only provide all-project access for existing admins; managers
 * must own the active project unless a current explicit grant says otherwise.
 */
export async function canEditAssignmentProject(
  userId: string,
  staffId: string | null,
  role: string,
  projectId: string,
): Promise<boolean> {
  return canAccessAssignmentProject(userId, staffId, role, projectId, 'edit');
}
