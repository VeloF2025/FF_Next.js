/**
 * Permission and project-scope resolution for Fleet incident review,
 * mirroring `fleet/operations/projectScope.ts`'s idiom for the
 * `fleet.incidents`/`fleet.incidents-settings` permissions (design §14).
 *
 * `projectScope.ts` itself is not reused directly — its
 * `canAccessOperationalProject` hardcodes the `fleet.operations-status`
 * permission key, and this module needs the same shape against different
 * keys — but `hasOperationalOversight`'s pattern (base permission AND
 * (admin role OR an active per-user grant override)) is duplicated here
 * verbatim so a generic `manager` role — which the migration grants base
 * `fleet.incidents`/`fleet.incidents-edit` access to — never gains
 * cross-project or projectless reach without an explicit admin role or
 * override grant.
 */
import { query, queryOne } from '@/lib/db-pool';
import { userHasPermission } from '@/lib/permissions';

export const FLEET_INCIDENTS_PERMISSION = 'fleet.incidents';
export const FLEET_INCIDENTS_SETTINGS_PERMISSION = 'fleet.incidents-settings';

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

interface GrantRow extends Record<string, unknown> { id: string }

async function activeGrant(userId: string, permissionKey: string, action: 'view' | 'edit'): Promise<boolean> {
  const rows = await query<GrantRow>(`/* fleet-incidents:oversight-grant */
    SELECT id FROM user_permission_overrides
    WHERE user_id = $1::uuid AND permission_key = $2
      AND override_type = 'grant' AND actions->>$3 = 'true'
      AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`, [userId, permissionKey, action]);
  return rows.length > 0;
}

/** True when this user's `fleet.incidents` access is unrestricted (admin role, or an explicit oversight grant) rather than limited to owned projects. */
export async function hasIncidentOversight(userId: string, role: string, action: 'view' | 'edit' = 'view'): Promise<boolean> {
  if (!await userHasPermission(userId, FLEET_INCIDENTS_PERMISSION, action)) return false;
  return ADMIN_ROLES.has(role) || activeGrant(userId, FLEET_INCIDENTS_PERMISSION, action);
}

/** Same shape for the separate `fleet.incidents-settings` permission (rules/oversight membership). */
export async function hasIncidentSettingsAccess(userId: string, role: string, action: 'view' | 'edit' = 'edit'): Promise<boolean> {
  if (!await userHasPermission(userId, FLEET_INCIDENTS_SETTINGS_PERMISSION, action)) return false;
  return ADMIN_ROLES.has(role) || activeGrant(userId, FLEET_INCIDENTS_SETTINGS_PERMISSION, action);
}

export interface IncidentScopeFilter {
  /** True for admin/oversight — sees cross-project and projectless incidents. False confines the viewer to projects they manage. */
  unrestricted: boolean;
  pmUserId: string;
  pmStaffId: string | null;
}

/** Resolves the viewer's `fleet.incidents` scope, or null when they lack the base permission entirely. */
export async function resolveIncidentScope(
  userId: string, staffId: string | null, role: string, action: 'view' | 'edit' = 'view',
): Promise<IncidentScopeFilter | null> {
  if (!await userHasPermission(userId, FLEET_INCIDENTS_PERMISSION, action)) return null;
  const unrestricted = ADMIN_ROLES.has(role) || await activeGrant(userId, FLEET_INCIDENTS_PERMISSION, action);
  return { unrestricted, pmUserId: userId, pmStaffId: staffId };
}

interface ProjectRow extends Record<string, unknown> { project_manager: string | null }

/** A restricted scope never sees a projectless incident (design §14: "Incidents with no project require oversight access"). */
export async function isProjectOwnedByScope(scope: IncidentScopeFilter, projectId: string | null): Promise<boolean> {
  if (scope.unrestricted) return true;
  if (!projectId) return false;
  const rows = await query<ProjectRow>(`SELECT project_manager FROM projects WHERE id = $1::uuid LIMIT 1`, [projectId]);
  const project = rows[0];
  if (!project) return false;
  return project.project_manager === scope.pmUserId || (scope.pmStaffId !== null && project.project_manager === scope.pmStaffId);
}

interface ActiveUserRow extends Record<string, unknown> { id: string }

/** Oversight-membership POST must resolve an active FibreFlow user before insert (design §7, this task's brief). */
export async function isActiveFibreFlowUser(userId: string): Promise<boolean> {
  const row = await queryOne<ActiveUserRow>(`SELECT id FROM users WHERE id = $1::uuid AND is_active = true LIMIT 1`, [userId]);
  return row !== null;
}
